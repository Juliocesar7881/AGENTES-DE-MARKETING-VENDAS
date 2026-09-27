import { eq, events, type DbExecutor } from "@revenueos/database";
import { createLogger, type EventType, type JobType } from "@revenueos/shared";
import { db, now } from "./deps";
import { enqueueJob, type JobOrigin } from "./jobs/queue";

const log = createLogger({ component: "orchestrator" });

export interface EventInput {
  type: EventType;
  workspaceId: string | null;
  payload?: Record<string, unknown>;
  /** Makes the event (and therefore its routed jobs) idempotent. */
  idempotencyKey: string;
  source?: string;
}

interface RoutedJob {
  type: JobType;
  payload: Record<string, unknown>;
  priority?: number;
  delaySec?: number;
  origin?: JobOrigin;
}

/**
 * Event-driven orchestrator. Agents never call each other: each event maps to
 * the next job(s) of the revenue cycle. The route table below IS the cycle:
 *
 * CONTENT_NEEDED → Strategist → STRATEGY_CREATED → Creative → CONTENT_CREATED
 * → Render → RENDER_COMPLETED → Scheduler → (slot time) Publish → POST_PUBLISHED
 * → Metrics … MESSAGE_RECEIVED → Sales → CHECKOUT_CREATED … PAYMENT_APPROVED
 * → Attribution → REVENUE_ATTRIBUTED → Learning → next Strategy.
 */
export const ROUTES: Partial<Record<EventType, (payload: Record<string, unknown>) => RoutedJob[]>> = {
  CONTENT_NEEDED: (p) => [{ type: "STRATEGY_PLAN", payload: { count: p.count ?? 1, reason: p.reason ?? "buffer", focus: p.focus ?? null } }],
  STRATEGY_CREATED: (p) => ((p.contentIds as string[] | undefined) ?? []).map((contentId) => ({ type: "CREATIVE_GENERATE" as const, payload: { contentId } })),
  CONTENT_CREATED: (p) => [{ type: "RENDER_VIDEO", payload: { contentId: p.contentId } }],
  RENDER_REQUESTED: (p) => [{ type: "RENDER_VIDEO", payload: { contentId: p.contentId, force: true } }],
  RENDER_COMPLETED: (p) => [{ type: "SCHEDULE_CONTENT", payload: { contentId: p.contentId } }],
  CONTENT_READY: (p) => [{ type: "SCHEDULE_CONTENT", payload: { contentId: p.contentId } }],
  POST_PUBLISHED: (p) => [{ type: "SYNC_METRICS", payload: { socialPostId: p.socialPostId }, delaySec: 3600 }],
  MESSAGE_RECEIVED: (p) => [{ type: "SALES_REPLY", payload: { conversationId: p.conversationId, messageId: p.messageId, leadId: p.leadId } }],
  PAYMENT_APPROVED: (p) => [{ type: "ATTRIBUTE_REVENUE", payload: { paymentId: p.paymentId } }],
  PAYMENT_REFUNDED: (p) => [{ type: "ATTRIBUTE_REVENUE", payload: { paymentId: p.paymentId, refund: true } }],
  REVENUE_ATTRIBUTED: (p) => [{ type: "LEARNING_UPDATE", payload: { paymentId: p.paymentId, contentId: p.contentId ?? null } }],
  PERFORMANCE_REVIEW: () => [{ type: "PERFORMANCE_REVIEW", payload: {} }],
  WEEKLY_STRATEGY_DUE: () => [{ type: "WEEKLY_STRATEGY", payload: {} }],
};

/**
 * Transactional outbox: the event row and its routed jobs are written together.
 * Returns the event id, or null when this idempotency key was already handled.
 */
export async function emitEvent(input: EventInput, exec: DbExecutor = db(), origin: JobOrigin = "AUTOMATION"): Promise<string | null> {
  const inserted = await exec
    .insert(events)
    .values({
      type: input.type,
      workspaceId: input.workspaceId,
      payload: input.payload ?? {},
      idempotencyKey: input.idempotencyKey,
      source: input.source ?? "system",
    })
    .onConflictDoNothing({ target: events.idempotencyKey })
    .returning({ id: events.id });
  const eventId = inserted[0]?.id;
  if (!eventId) return null;
  const routed = ROUTES[input.type]?.(input.payload ?? {}) ?? [];
  let i = 0;
  for (const r of routed) {
    await enqueueJob(
      {
        type: r.type,
        workspaceId: input.workspaceId,
        payload: r.payload,
        origin: r.origin ?? origin,
        priority: r.priority,
        scheduledAt: r.delaySec ? new Date(now().getTime() + r.delaySec * 1000) : undefined,
        idempotencyKey: `${eventId}:${r.type}:${i++}`,
        eventId,
      },
      exec,
    );
  }
  if (routed.length) await exec.update(events).set({ dispatchedJobs: routed.length }).where(eq(events.id, eventId));
  log.debug("event emitted", { event: input.type, workspace: input.workspaceId, jobs: routed.length });
  return eventId;
}
