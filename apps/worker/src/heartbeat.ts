import { arch, hostname, platform, release } from "node:os";
import { db as coreDb } from "@revenueos/core";
import { and, count, eq, gte, inArray, lte, sql, videoRenders, workerInstances, jobs } from "@revenueos/database";
import { createLogger } from "@revenueos/shared";
import { WORKER_VERSION, type WorkerConfig } from "./config";
import type { WorkerHealth } from "./health";

const log = createLogger({ component: "heartbeat" });

export interface WorkerSnapshot {
  online: boolean;
  paused: boolean;
  pending: number;
  rendering: number;
  renderedToday: number;
  failedToday: number;
  currentJobs: { id: string; type: string; startedAt: string }[];
  lastHeartbeatAt: string | null;
  lastError: string | null;
}

export interface HeartbeatInput {
  cfg: WorkerConfig;
  paused: boolean;
  health: WorkerHealth | null;
  currentJobs: { id: string; type: string; startedAt: string }[];
  localUiUrl: string;
  startedAt: Date;
}

/** Remote pause/resume requested from the dashboard (stored in worker_instances.config.remotePause). */
export interface RemoteCommand {
  paused: boolean;
  at: string;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function pendingLocalJobs(): Promise<number> {
  const [r] = await coreDb()
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.runner, "LOCAL"), inArray(jobs.status, ["QUEUED", "RETRYING"]), lte(jobs.scheduledAt, new Date())));
  return Number(r?.n ?? 0);
}

export async function todayStats(workerId: string): Promise<{ renderedToday: number; failedToday: number }> {
  const rows = await coreDb()
    .select({ status: videoRenders.status, n: count() })
    .from(videoRenders)
    .where(and(eq(videoRenders.workerId, workerId), gte(videoRenders.createdAt, startOfToday())))
    .groupBy(videoRenders.status);
  return {
    renderedToday: Number(rows.find((r) => r.status === "COMPLETED")?.n ?? 0),
    failedToday: Number(rows.find((r) => r.status === "FAILED")?.n ?? 0),
  };
}

/**
 * Upserts this worker's row. The dashboard shows ONLINE/OFFLINE from
 * last_heartbeat_at; jobs stay QUEUED while no worker is online.
 * Returns a remote pause/resume command if the dashboard sent one.
 */
export async function sendHeartbeat(input: HeartbeatInput): Promise<RemoteCommand | null> {
  const { cfg } = input;
  const stats = await todayStats(cfg.workerId);
  const pending = await pendingLocalJobs();
  const values = {
    id: cfg.workerId,
    name: cfg.name,
    machine: hostname(),
    platform: `${platform()} ${release()} ${arch()}`,
    version: WORKER_VERSION,
    status: (input.paused ? "PAUSED" : "ONLINE") as "PAUSED" | "ONLINE",
    paused: input.paused,
    lastHeartbeatAt: new Date(),
    startedAt: input.startedAt,
    capabilities: { render: true, ai: true, screenshots: true, renderConcurrency: cfg.renderConcurrency, aiConcurrency: cfg.aiConcurrency },
    health: (input.health ?? {}) as unknown as Record<string, unknown>,
    currentJobs: input.currentJobs,
    stats: { ...stats, pending, renderDir: cfg.renderDir },
    localUiUrl: input.localUiUrl,
  };
  const [row] = await coreDb()
    .insert(workerInstances)
    .values(values)
    .onConflictDoUpdate({
      target: workerInstances.id,
      set: { ...values, config: sql`${workerInstances.config}` },
    })
    .returning({ config: workerInstances.config });
  const remote = (row?.config?.remotePause ?? null) as RemoteCommand | null;
  return remote && typeof remote.paused === "boolean" && typeof remote.at === "string" ? remote : null;
}

export async function markOffline(workerId: string): Promise<void> {
  try {
    await coreDb().update(workerInstances).set({ status: "OFFLINE", currentJobs: [] }).where(eq(workerInstances.id, workerId));
  } catch (e) {
    log.warn("could not mark worker offline", { error: e instanceof Error ? e.message : String(e) });
  }
}
