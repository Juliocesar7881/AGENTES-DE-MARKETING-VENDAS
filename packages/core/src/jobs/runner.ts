import { agents, and, eq, workspaces } from "@revenueos/database";
import { createLogger, serializeError, type JobRunner as RunnerKind, type JobType } from "@revenueos/shared";
import { checkBudget, notifyBudget } from "../domain/agent-runs";
import { db } from "../deps";
import { notify } from "../records";
import { isEmergencyStopped } from "../settings";
import { JOB_DEFINITIONS, type ConcurrencyClass } from "./definitions";
import { claimJobs, completeJob, extendLease, failJob, rescheduleJob, RescheduleSignal, type JobOrigin, type JobRow } from "./queue";

export interface HandlerContext {
  runnerId: string;
  signal: AbortSignal;
  log: ReturnType<typeof createLogger>;
  origin: JobOrigin;
  extendLease: (seconds: number) => Promise<void>;
}

export type JobHandler = (job: JobRow, ctx: HandlerContext) => Promise<Record<string, unknown> | void>;
export type FinalFailureHook = (job: JobRow, error: unknown) => Promise<void>;

const handlers = new Map<JobType, JobHandler>();
const finalFailureHooks = new Map<JobType, FinalFailureHook>();

export function registerHandler(type: JobType, handler: JobHandler, onFinalFailure?: FinalFailureHook): void {
  handlers.set(type, handler);
  if (onFinalFailure) finalFailureHooks.set(type, onFinalFailure);
}

export function hasHandler(type: JobType): boolean {
  return handlers.has(type);
}

export interface RunnerOptions {
  runnerId: string;
  runners: RunnerKind[];
  concurrency: Record<ConcurrencyClass, number>;
  /** Restrict to these job types (defaults to every type with a registered handler). */
  types?: JobType[];
  paused?: () => boolean;
}

const log = createLogger({ component: "job-runner" });

/**
 * Generic job runner used both by the cloud tick (runner ANY) and by the local
 * worker (LOCAL + ANY). Enforces, before running anything: global emergency
 * stop, paused workspaces/agents and AI budgets. Every outcome is persisted —
 * no job can silently disappear.
 */
export class JobRunner {
  private active = new Map<ConcurrencyClass, number>([
    ["render", 0],
    ["ai", 0],
    ["io", 0],
  ]);
  private running = new Set<Promise<void>>();
  private stopped = false;
  private abort = new AbortController();
  readonly current = new Map<string, { id: string; type: JobType; startedAt: string }>();

  constructor(private readonly opts: RunnerOptions) {}

  private capacity(cls: ConcurrencyClass): number {
    return Math.max(0, this.opts.concurrency[cls] - (this.active.get(cls) ?? 0));
  }

  private allowedTypes(cls: ConcurrencyClass, emergency: boolean): JobType[] {
    const types = (this.opts.types ?? [...handlers.keys()]).filter((t) => handlers.has(t));
    return types.filter((t) => {
      const def = JOB_DEFINITIONS[t];
      if (def.concurrency !== cls) return false;
      if (emergency && !def.emergencySafe) return false;
      return true;
    });
  }

  /** Claims and starts as many jobs as capacity allows. Returns the number started. */
  async tick(filter?: { workspaceIds?: string[] }): Promise<number> {
    if (this.stopped || this.opts.paused?.()) return 0;
    const emergency = await isEmergencyStopped();
    let started = 0;
    for (const cls of ["ai", "render", "io"] as ConcurrencyClass[]) {
      const cap = this.capacity(cls);
      if (cap <= 0) continue;
      const types = this.allowedTypes(cls, emergency);
      if (types.length === 0) continue;
      const claimed = await claimJobs({ runnerId: this.opts.runnerId, runners: this.opts.runners, types, limit: cap, workspaceIds: filter?.workspaceIds });
      for (const job of claimed) {
        started++;
        this.active.set(cls, (this.active.get(cls) ?? 0) + 1);
        const p = this.execute(job).finally(() => {
          this.active.set(cls, (this.active.get(cls) ?? 1) - 1);
          this.running.delete(p);
        });
        this.running.add(p);
      }
    }
    return started;
  }

  /** Runs until no due jobs remain (or limits are hit). Used by the cloud tick, tests and the demo simulation. */
  async drain(opts: { maxJobs?: number; timeoutMs?: number; workspaceIds?: string[] } = {}): Promise<number> {
    const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
    let total = 0;
    for (;;) {
      const n = await this.tick({ workspaceIds: opts.workspaceIds });
      total += n;
      // Stop only when a fresh claim finds nothing AND nothing is running: a job
      // that just finished may have enqueued the next step of the cycle.
      if (n === 0 && this.running.size === 0) break;
      if (Date.now() > deadline || (opts.maxJobs && total >= opts.maxJobs)) {
        await Promise.allSettled([...this.running]);
        break;
      }
      if (this.running.size > 0) await Promise.race(this.running);
    }
    return total;
  }

  async waitIdle(): Promise<void> {
    await Promise.allSettled([...this.running]);
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
  }

  get busy(): number {
    return this.running.size;
  }

  private async preflight(job: JobRow): Promise<{ delaySec: number; reason: string } | null> {
    const def = JOB_DEFINITIONS[job.type];
    const origin = (job.payload.origin as JobOrigin | undefined) ?? "AUTOMATION";
    if (def.outbound && !def.emergencySafe && (await isEmergencyStopped())) return { delaySec: 600, reason: "Global emergency stop is active." };
    if (!job.workspaceId) return null;
    const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, job.workspaceId)).limit(1);
    if (!ws) return null;
    if (ws.status !== "ACTIVE" && origin !== "HUMAN" && !def.emergencySafe && job.type !== "ATTRIBUTE_REVENUE") return { delaySec: 3600, reason: `Workspace is ${ws.status.toLowerCase()}.` };
    if (def.agent && origin !== "HUMAN") {
      const [agent] = await db().select({ paused: agents.paused }).from(agents).where(and(eq(agents.workspaceId, ws.id), eq(agents.role, def.agent))).limit(1);
      if (agent?.paused) return { delaySec: 1800, reason: `${def.agent} agent is paused.` };
    }
    if (def.nonEssentialAI && origin !== "HUMAN" && ws.environment === "LIVE") {
      const b = await checkBudget(ws);
      if (!b.allowed) {
        await notifyBudget(ws, b.reason ?? "Budget exceeded");
        return { delaySec: Math.max(300, Math.round(((b.resumeAt?.getTime() ?? Date.now() + 3600_000) - Date.now()) / 1000)), reason: b.reason ?? "AI budget exceeded" };
      }
    }
    return null;
  }

  private async execute(job: JobRow): Promise<void> {
    const handler = handlers.get(job.type);
    const jlog = log.child({ job: job.id, workspace: job.workspaceId, event: job.type, worker: this.opts.runnerId });
    this.current.set(job.id, { id: job.id, type: job.type, startedAt: new Date().toISOString() });
    try {
      if (!handler) throw new Error(`No handler registered for ${job.type} on ${this.opts.runnerId}`);
      const wait = await this.preflight(job);
      if (wait) {
        await rescheduleJob(job, wait.delaySec, wait.reason);
        jlog.info("job deferred", { reason: wait.reason, delaySec: wait.delaySec });
        return;
      }
      const started = Date.now();
      const result = await handler(job, {
        runnerId: this.opts.runnerId,
        signal: this.abort.signal,
        log: jlog,
        origin: (job.payload.origin as JobOrigin | undefined) ?? "AUTOMATION",
        extendLease: (s) => extendLease(job.id, s),
      });
      await completeJob(job.id, { ...(result ?? {}), durationMs: Date.now() - started });
      jlog.info("job completed", { durationMs: Date.now() - started });
    } catch (e) {
      if (e instanceof RescheduleSignal) {
        await rescheduleJob(job, e.delaySec, e.reason, e.refundAttempt);
        jlog.info("job rescheduled", { reason: e.reason, delaySec: e.delaySec });
        return;
      }
      const { final } = await failJob(job, e);
      const ser = serializeError(e);
      jlog.warn(final ? "job failed" : "job will retry", { error: ser.message, code: ser.code, attempt: job.attempts });
      if (final) {
        try {
          await finalFailureHooks.get(job.type)?.(job, e);
        } catch (hookErr) {
          jlog.error("final failure hook crashed", { error: String(hookErr) });
        }
        if (job.workspaceId) {
          await notify({
            workspaceId: job.workspaceId,
            type: "JOB_FAILED",
            severity: "ERROR",
            title: `${job.type.replace(/_/g, " ").toLowerCase()} failed`,
            body: ser.userMessage,
            link: null,
            dedupeKey: `job_failed:${job.id}`,
          });
        }
      }
    } finally {
      this.current.delete(job.id);
    }
  }
}
