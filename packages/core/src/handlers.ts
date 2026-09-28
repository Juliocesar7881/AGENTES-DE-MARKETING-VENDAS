import { contents, eq, leads, workspaces } from "@revenueos/database";
import { AppError, serializeError } from "@revenueos/shared";
import { setAgentStatus } from "./domain/agent-runs";
import { runCreative, runStrategyPlan, simulateRender } from "./domain/creative-pipeline";
import { scheduleContent } from "./domain/content";
import { learnFromSale } from "./domain/learning";
import { cleanupDeliveries, rollupAnalytics, runPerformanceReview, runTokenHealth, runWeeklyStrategy } from "./domain/maintenance";
import { syncPostMetrics } from "./domain/metrics";
import { attributePayment } from "./domain/payments";
import { onPublishFinalFailure, publishSocialPost } from "./domain/publishing";
import { runSalesReply } from "./domain/sales";
import { policy } from "./domain/workspaces";
import { db } from "./deps";
import { registerHandler } from "./jobs/runner";
import type { JobRow } from "./jobs/queue";
import { notify } from "./records";

async function wsOf(job: JobRow) {
  if (!job.workspaceId) throw new AppError({ code: "NO_WORKSPACE", userMessage: "Job has no workspace." });
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, job.workspaceId)).limit(1);
  if (!ws) throw new AppError({ code: "NOT_FOUND", userMessage: "Workspace not found.", retryable: false });
  return ws;
}

async function failContent(contentId: string | undefined, error: unknown): Promise<void> {
  if (!contentId) return;
  const ser = serializeError(error);
  const [c] = await db().update(contents).set({ status: "FAILED", failureReason: ser.userMessage, failureDetails: { code: ser.code, message: ser.message } }).where(eq(contents.id, contentId)).returning();
  if (c) {
    const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, c.workspaceId)).limit(1);
    await notify({ workspaceId: c.workspaceId, type: "JOB_FAILED", severity: "ERROR", title: `Content #${c.number} failed`, body: ser.userMessage, link: ws ? `/w/${ws.slug}/content/${c.id}` : null, dedupeKey: `content_failed:${c.id}:${ser.code}` });
  }
}

let registered = false;

/**
 * Registers every handler that can run anywhere (cloud or worker). LOCAL-only
 * handlers (render, delivery upload, local cleanup, asset processing,
 * screenshots, composition sandbox) are registered by the worker.
 */
export function registerCoreHandlers(): void {
  if (registered) return;
  registered = true;

  registerHandler(
    "STRATEGY_PLAN",
    async (job, ctx) => {
      const ws = await wsOf(job);
      if (policy(ws, "createStrategies", ctx.origin) !== "ALLOW") return { skipped: "strategy creation not allowed in current mode" };
      const r = await runStrategyPlan(ws, { count: Number(job.payload.count ?? 1), jobId: job.id, origin: ctx.origin, focus: (job.payload.focus as string | null) ?? null, publishAsap: Boolean(job.payload.publishAsap) });
      return { contents: r.contentIds.length, planId: r.planId };
    },
    async (job, e) => {
      if (job.workspaceId) await setAgentStatus(job.workspaceId, "STRATEGIST", "ERROR", { error: serializeError(e).userMessage });
    },
  );

  registerHandler(
    "CREATIVE_GENERATE",
    async (job, ctx) => {
      const ws = await wsOf(job);
      if (policy(ws, "generateContent", ctx.origin) !== "ALLOW") return { skipped: "content generation not allowed in current mode" };
      const r = await runCreative(ws, String(job.payload.contentId), { jobId: job.id, origin: ctx.origin, feedback: (job.payload.feedback as string | null) ?? null });
      return r;
    },
    async (job, e) => {
      await failContent(job.payload.contentId as string | undefined, e);
      if (job.workspaceId) await setAgentStatus(job.workspaceId, "CREATIVE", "ERROR", { error: serializeError(e).userMessage });
    },
  );

  registerHandler("SCHEDULE_CONTENT", async (job, ctx) => {
    const r = await scheduleContent(String(job.payload.contentId), ctx.origin);
    return { ...r, scheduledFor: r.scheduledFor?.toISOString() ?? null };
  });

  registerHandler(
    "PUBLISH_POST",
    async (job, ctx) => publishSocialPost(String(job.payload.socialPostId), { jobId: job.id, workspaceId: job.workspaceId, origin: ctx.origin }),
    async (job, e) => onPublishFinalFailure(String(job.payload.socialPostId), e),
  );

  registerHandler("SYNC_METRICS", async (job) => syncPostMetrics(String(job.payload.socialPostId)));

  registerHandler(
    "SALES_REPLY",
    async (job, ctx) => runSalesReply({ conversationId: String(job.payload.conversationId), jobId: job.id, origin: ctx.origin, triggerMessageId: (job.payload.messageId as string) ?? null }),
    async (job, e) => {
      if (!job.workspaceId) return;
      await setAgentStatus(job.workspaceId, "SALES", "ERROR", { error: serializeError(e).userMessage });
      await notify({ workspaceId: job.workspaceId, type: "ACTION_REQUIRED", severity: "ERROR", title: "Sales Agent could not reply", body: `${serializeError(e).userMessage} Reply manually in the Inbox.`, link: null, dedupeKey: `sales_fail:${job.id}` });
    },
  );

  registerHandler("FOLLOW_UP", async (job, ctx) => {
    const [lead] = await db().select().from(leads).where(eq(leads.id, String(job.payload.leadId))).limit(1);
    if (!lead || lead.doNotContact) return { skipped: "lead unavailable or do-not-contact" };
    return runSalesReply({ conversationId: String(job.payload.conversationId), jobId: job.id, origin: ctx.origin, followUp: true });
  });

  registerHandler("PERFORMANCE_REVIEW", async (job) => runPerformanceReview(await wsOf(job), job.id));
  registerHandler("WEEKLY_STRATEGY", async (job) => runWeeklyStrategy(await wsOf(job), job.id));
  registerHandler("ATTRIBUTE_REVENUE", async (job) => attributePayment(String(job.payload.paymentId), Boolean(job.payload.refund)));
  registerHandler("LEARNING_UPDATE", async (job) => {
    const ws = await wsOf(job);
    const { attributionEvents } = await import("@revenueos/database");
    const [ev] = await db().select().from(attributionEvents).where(eq(attributionEvents.paymentId, String(job.payload.paymentId))).limit(1);
    await learnFromSale(ws.id, (job.payload.contentId as string | null) ?? ev?.contentId ?? null, ev?.amountCents ?? 0);
    return { learned: true };
  });
  registerHandler("TOKEN_HEALTH", async (job) => runTokenHealth(await wsOf(job)));
  registerHandler("CLEANUP_DELIVERY", async () => ({ removed: await cleanupDeliveries() }));
  registerHandler("ANALYTICS_ROLLUP", async (job) => {
    await rollupAnalytics(await wsOf(job));
    return { ok: true };
  });
  registerHandler("SIMULATE_DAY", async (job) => {
    const { simulateDay } = await import("./demo/simulate");
    return { ...(await simulateDay({ workspaceIds: (job.payload.workspaceIds as string[] | undefined) ?? (job.workspaceId ? [job.workspaceId] : []), contentsPerWorkspace: Number(job.payload.contentsPerWorkspace ?? 2), userId: (job.payload.userId as string | null) ?? null })) };
  });
}

/**
 * Fallback render handler for DEMO workspaces when no local worker exists
 * (e.g. serverless demo). Never used for LIVE workspaces.
 */
export async function simulatedRenderHandler(job: JobRow): Promise<Record<string, unknown>> {
  const ws = await wsOf(job);
  if (ws.environment !== "DEMO") throw new AppError({ code: "WORKER_REQUIRED", userMessage: "Rendering requires the local worker.", retryable: true, retryAfterSec: 600 });
  await simulateRender(String(job.payload.contentId));
  return { simulated: true };
}
