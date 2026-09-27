import "server-only";
import { cache } from "react";
import { approvalRequests, and, count, desc, eq, isNull, notifications, sql, workerInstances, withUser } from "@revenueos/database";
import { getGlobalSettings } from "@revenueos/core";
import { listWorkspaces, requireUser } from "./session";

export interface WorkerStatus {
  id: string;
  name: string;
  online: boolean;
  paused: boolean;
  lastHeartbeatAt: string;
  localUiUrl: string | null;
  currentJobs: { id: string; type: string; startedAt: string }[];
  stats: Record<string, unknown>;
  health: Record<string, unknown>;
  version: string;
  platform: string;
}

export const workerStatuses = cache(async (): Promise<WorkerStatus[]> => {
  const user = await requireUser();
  const [settings, rows] = await Promise.all([getGlobalSettings(), withUser(user.id, (tx) => tx.select().from(workerInstances).orderBy(desc(workerInstances.lastHeartbeatAt)).limit(10))]);
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    online: w.status !== "OFFLINE" && Date.now() - w.lastHeartbeatAt.getTime() < settings.workerOfflineAfterSec * 1000,
    paused: w.paused,
    lastHeartbeatAt: w.lastHeartbeatAt.toISOString(),
    localUiUrl: w.localUiUrl,
    currentJobs: w.currentJobs,
    stats: w.stats,
    health: w.health,
    version: w.version,
    platform: w.platform,
  }));
});

export const shellData = cache(async () => {
  const user = await requireUser();
  const [workspaces, settings, workers, counts] = await Promise.all([
    listWorkspaces(),
    getGlobalSettings(),
    workerStatuses(),
    withUser(user.id, async (tx) => {
      const [unread] = await tx.select({ n: count() }).from(notifications).where(isNull(notifications.readAt));
      const [approvals] = await tx.select({ n: count() }).from(approvalRequests).where(eq(approvalRequests.status, "PENDING"));
      return { unread: Number(unread?.n ?? 0), approvals: Number(approvals?.n ?? 0) };
    }),
  ]);
  const online = workers.find((w) => w.online) ?? null;
  // The demo account's "Stop all" pauses only its DEMO businesses (the global stop is admin-only).
  const demoStopped = user.isDemo && workspaces.length > 0 && workspaces.every((w) => w.status === "PAUSED");
  return {
    user,
    workspaces: workspaces.map((w) => ({ id: w.id, slug: w.slug, name: w.name, color: w.color, environment: w.environment, status: w.status, operatingMode: w.operatingMode })),
    emergencyStop: settings.emergencyStop || demoStopped,
    emergencyScope: settings.emergencyStop ? ("GLOBAL" as const) : demoStopped ? ("DEMO" as const) : null,
    worker: online ? { online: true, paused: online.paused, name: online.name, jobs: online.currentJobs.length } : { online: false, paused: false, name: workers[0]?.name ?? null, jobs: 0, lastSeen: workers[0]?.lastHeartbeatAt ?? null },
    unread: counts.unread,
    approvals: counts.approvals,
  };
});

export type ShellData = Awaited<ReturnType<typeof shellData>>;

export async function notificationFeed(limit = 30) {
  const user = await requireUser();
  return withUser(user.id, async (tx) => {
    const rows = await tx.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit);
    const [unread] = await tx.select({ n: count() }).from(notifications).where(isNull(notifications.readAt));
    return { items: rows, unread: Number(unread?.n ?? 0) };
  });
}

export async function markNotificationsRead(ids: string[] | "all") {
  const user = await requireUser();
  await withUser(user.id, (tx) =>
    ids === "all"
      ? tx.update(notifications).set({ readAt: new Date() }).where(isNull(notifications.readAt))
      : tx
          .update(notifications)
          .set({ readAt: new Date() })
          .where(and(isNull(notifications.readAt), sql`${notifications.id} = ANY(${ids}::uuid[])`)),
  );
}
