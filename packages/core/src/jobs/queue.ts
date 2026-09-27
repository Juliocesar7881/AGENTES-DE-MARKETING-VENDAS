import { and, eq, inArray, jobs, lt, sql, type DbExecutor } from "@revenueos/database";
import { AppError, redactString, serializeError, type JobRunner, type JobType } from "@revenueos/shared";
import { db, now } from "../deps";
import { JOB_DEFINITIONS, jobDefinition, retryDelaySec } from "./definitions";

export type JobRow = typeof jobs.$inferSelect;

export type JobOrigin = "AUTOMATION" | "HUMAN" | "SIMULATION" | "WEBHOOK";

export interface EnqueueInput {
  type: JobType;
  workspaceId: string | null;
  payload?: Record<string, unknown>;
  origin?: JobOrigin;
  runner?: JobRunner;
  priority?: number;
  scheduledAt?: Date;
  maxAttempts?: number;
  idempotencyKey?: string | null;
  eventId?: string | null;
  parentJobId?: string | null;
}

/** Inserts a job. With an idempotency key, duplicates are ignored and the existing id is returned. */
export async function enqueueJob(input: EnqueueInput, exec: DbExecutor = db()): Promise<string> {
  const def = jobDefinition(input.type);
  const values = {
    type: input.type,
    workspaceId: input.workspaceId,
    payload: { ...(input.payload ?? {}), origin: input.origin ?? (input.payload?.origin as JobOrigin | undefined) ?? "AUTOMATION" },
    runner: input.runner ?? def.runner,
    priority: input.priority ?? def.priority,
    scheduledAt: input.scheduledAt ?? now(),
    maxAttempts: input.maxAttempts ?? def.maxAttempts,
    idempotencyKey: input.idempotencyKey ?? null,
    eventId: input.eventId ?? null,
    parentJobId: input.parentJobId ?? null,
  };
  const inserted = await exec.insert(jobs).values(values).onConflictDoNothing({ target: jobs.idempotencyKey }).returning({ id: jobs.id });
  if (inserted[0]) return inserted[0].id;
  const existing = await exec.select({ id: jobs.id }).from(jobs).where(eq(jobs.idempotencyKey, input.idempotencyKey!)).limit(1);
  return existing[0]!.id;
}

/** Lease CASE expression built from trusted constants (no user input). */
const LEASE_CASE = sql.raw(
  `CASE type ${Object.values(JOB_DEFINITIONS)
    .map((d) => `WHEN '${d.type}' THEN ${d.leaseSec}`)
    .join(" ")} ELSE 300 END`,
);

/**
 * Atomically claims up to `limit` due jobs with FOR UPDATE SKIP LOCKED, so any
 * number of runners (cloud tick + local worker) can poll concurrently without
 * double-processing.
 */
export async function claimJobs(opts: { runnerId: string; runners: JobRunner[]; types: JobType[]; limit: number; workspaceIds?: string[] }): Promise<JobRow[]> {
  if (opts.limit <= 0 || opts.types.length === 0) return [];
  const ts = now();
  const wsFilter = opts.workspaceIds?.length ? sql`AND workspace_id = ANY(${sql.raw(`ARRAY[${opts.workspaceIds.map((w) => `'${w.replace(/[^0-9a-f-]/gi, "")}'::uuid`).join(",")}]`)})` : sql``;
  const rows = await db().execute(sql`
    UPDATE jobs SET
      status = 'RUNNING',
      attempts = attempts + 1,
      locked_by = ${opts.runnerId},
      locked_at = ${ts},
      started_at = COALESCE(started_at, ${ts}),
      lease_expires_at = ${ts}::timestamptz + make_interval(secs => ${LEASE_CASE}),
      updated_at = ${ts}
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status IN ('QUEUED', 'RETRYING')
        AND scheduled_at <= ${ts}
        AND runner = ANY(${sql.raw(`ARRAY[${opts.runners.map((r) => `'${r}'`).join(",")}]`)})
        AND type = ANY(${sql.raw(`ARRAY[${opts.types.map((t) => `'${t}'`).join(",")}]`)})
        ${wsFilter}
      ORDER BY priority ASC, scheduled_at ASC
      LIMIT ${opts.limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  return (rows as unknown as Record<string, unknown>[]).map(rowToJob);
}

function rowToJob(r: Record<string, unknown>): JobRow {
  const date = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
  return {
    id: r.id as string,
    workspaceId: (r.workspace_id as string) ?? null,
    type: r.type as JobType,
    runner: r.runner as JobRunner,
    priority: Number(r.priority),
    payload: (r.payload as Record<string, unknown>) ?? {},
    status: r.status as JobRow["status"],
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    scheduledAt: date(r.scheduled_at)!,
    startedAt: date(r.started_at),
    completedAt: date(r.completed_at),
    lockedBy: (r.locked_by as string) ?? null,
    lockedAt: date(r.locked_at),
    leaseExpiresAt: date(r.lease_expires_at),
    lastError: (r.last_error as string) ?? null,
    errorDetails: (r.error_details as Record<string, unknown>) ?? null,
    result: (r.result as Record<string, unknown>) ?? null,
    idempotencyKey: (r.idempotency_key as string) ?? null,
    eventId: (r.event_id as string) ?? null,
    parentJobId: (r.parent_job_id as string) ?? null,
    createdAt: date(r.created_at)!,
    updatedAt: date(r.updated_at)!,
  };
}

export async function completeJob(id: string, result: Record<string, unknown> = {}): Promise<void> {
  await db()
    .update(jobs)
    .set({ status: "COMPLETED", completedAt: now(), result, lockedBy: null, leaseExpiresAt: null, lastError: null })
    .where(eq(jobs.id, id));
}

/** Thrown by handlers that need to wait (processing uploads, business hours, budgets). Not a failure. */
export class RescheduleSignal extends Error {
  constructor(
    readonly delaySec: number,
    readonly reason: string,
    /** Keep the attempt counter unchanged (waiting is not an attempt). */
    readonly refundAttempt = true,
  ) {
    super(reason);
    this.name = "RescheduleSignal";
  }
}

export async function rescheduleJob(job: JobRow, delaySec: number, reason: string, refundAttempt = true): Promise<void> {
  await db()
    .update(jobs)
    .set({
      status: "QUEUED",
      scheduledAt: new Date(now().getTime() + delaySec * 1000),
      attempts: refundAttempt ? Math.max(0, job.attempts - 1) : job.attempts,
      lastError: reason,
      lockedBy: null,
      leaseExpiresAt: null,
    })
    .where(eq(jobs.id, job.id));
}

/**
 * Records a failure. Retryable errors go back to RETRYING with exponential
 * backoff (respecting Retry-After); otherwise, or when attempts are exhausted,
 * the job is FAILED — never silently dropped.
 */
export async function failJob(job: JobRow, error: unknown): Promise<{ final: boolean }> {
  const ser = serializeError(error);
  const retryable = error instanceof AppError ? error.retryable : true;
  const final = !retryable || job.attempts >= job.maxAttempts;
  const delay = retryDelaySec(job.attempts, error instanceof AppError ? error.retryAfterSec : undefined);
  await db()
    .update(jobs)
    .set({
      status: final ? "FAILED" : "RETRYING",
      scheduledAt: final ? job.scheduledAt : new Date(now().getTime() + delay * 1000),
      completedAt: final ? now() : null,
      lastError: redactString(ser.userMessage),
      errorDetails: { code: ser.code, message: ser.message, details: ser.details ?? null, attempt: job.attempts },
      lockedBy: null,
      leaseExpiresAt: null,
    })
    .where(eq(jobs.id, job.id));
  return { final };
}

export async function extendLease(jobId: string, seconds: number): Promise<void> {
  await db()
    .update(jobs)
    .set({ leaseExpiresAt: new Date(now().getTime() + seconds * 1000) })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "RUNNING")));
}

/** Jobs whose runner died mid-flight (lease expired) become claimable again or fail if exhausted. */
export async function recoverStaleJobs(): Promise<number> {
  const ts = now();
  const stale = await db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "RUNNING"), lt(jobs.leaseExpiresAt, ts)))
    .limit(200);
  for (const j of stale) {
    const final = j.attempts >= j.maxAttempts;
    await db()
      .update(jobs)
      .set({
        status: final ? "FAILED" : "RETRYING",
        scheduledAt: ts,
        lastError: final ? "The runner stopped while processing this job and no attempts are left." : "Recovered after the runner stopped (lease expired). Retrying.",
        lockedBy: null,
        leaseExpiresAt: null,
        completedAt: final ? ts : null,
      })
      .where(and(eq(jobs.id, j.id), eq(jobs.status, "RUNNING")));
  }
  return stale.length;
}

export async function cancelJobs(where: { workspaceId?: string; types?: JobType[]; ids?: string[] }): Promise<number> {
  const conds = [inArray(jobs.status, ["QUEUED", "RETRYING"])];
  if (where.workspaceId) conds.push(eq(jobs.workspaceId, where.workspaceId));
  if (where.types?.length) conds.push(inArray(jobs.type, where.types));
  if (where.ids?.length) conds.push(inArray(jobs.id, where.ids));
  const res = await db()
    .update(jobs)
    .set({ status: "CANCELLED", completedAt: now(), lastError: "Cancelled by user" })
    .where(and(...conds))
    .returning({ id: jobs.id });
  return res.length;
}

export async function retryJob(id: string): Promise<void> {
  await db()
    .update(jobs)
    .set({ status: "QUEUED", scheduledAt: now(), attempts: 0, lastError: null, completedAt: null })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ["FAILED", "CANCELLED"])));
}
