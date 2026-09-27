import { activities, auditLogs, notifications, type DbExecutor } from "@revenueos/database";
import { createLogger, type ActorType, type AgentRole, type NotificationType, type Severity } from "@revenueos/shared";
import { db } from "./deps";

const log = createLogger({ component: "records" });

/** Activity feed entry ("08:04 Creative created Content #72"). */
export async function recordActivity(
  a: {
    workspaceId: string;
    type: string;
    title: string;
    actorType?: ActorType;
    actorId?: string | null;
    agentRole?: AgentRole | null;
    leadId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    details?: Record<string, unknown>;
  },
  exec: DbExecutor = db(),
): Promise<void> {
  await exec.insert(activities).values({
    workspaceId: a.workspaceId,
    type: a.type,
    title: a.title,
    actorType: a.actorType ?? (a.agentRole ? "AGENT" : "SYSTEM"),
    actorId: a.actorId ?? a.agentRole ?? null,
    agentRole: a.agentRole ?? null,
    leadId: a.leadId ?? null,
    entityType: a.entityType ?? null,
    entityId: a.entityId ?? null,
    details: a.details ?? {},
  });
}

/** Audit trail for important actions (publications, messages, takeovers, checkouts, payments). */
export async function audit(
  a: {
    workspaceId: string | null;
    actorType: ActorType;
    actorId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    details?: Record<string, unknown>;
    ipHash?: string | null;
  },
  exec: DbExecutor = db(),
): Promise<void> {
  await exec.insert(auditLogs).values({
    workspaceId: a.workspaceId,
    actorType: a.actorType,
    actorId: a.actorId ?? null,
    action: a.action,
    entityType: a.entityType ?? null,
    entityId: a.entityId ?? null,
    details: a.details ?? {},
    ipHash: a.ipHash ?? null,
  });
}

/** In-app notification. `dedupeKey` prevents floods (e.g. one "worker offline" per hour). */
export async function notify(
  n: {
    workspaceId?: string | null;
    userId?: string | null;
    type: NotificationType;
    severity?: Severity;
    title: string;
    body?: string;
    link?: string | null;
    dedupeKey?: string | null;
  },
  exec: DbExecutor = db(),
): Promise<void> {
  try {
    await exec
      .insert(notifications)
      .values({
        workspaceId: n.workspaceId ?? null,
        userId: n.userId ?? null,
        type: n.type,
        severity: n.severity ?? "INFO",
        title: n.title,
        body: n.body ?? "",
        link: n.link ?? null,
        dedupeKey: n.dedupeKey ?? null,
      })
      .onConflictDoNothing();
  } catch (e) {
    log.warn("notification failed", { error: e instanceof Error ? e.message : String(e) });
  }
}
