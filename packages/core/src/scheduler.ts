import { and, conversations, desc, eq, inArray, isNotNull, jobs, leads, lte, sql, workerInstances, workspaces } from "@revenueos/database";
import { createLogger, localDateString, localHour, localWeekday, startOfLocalDay } from "@revenueos/shared";
import { analyzeBuffer, ensureSlots, markMissedSlots, scheduleContent } from "./domain/content";
import { simulateRender } from "./domain/creative-pipeline";
import { contentsNeedingDelivery, expireStaleCheckoutsAndSessions } from "./domain/maintenance";
import { enqueueDueMetricSyncs } from "./domain/metrics";
import { applyRetention } from "./domain/privacy";
import { policy } from "./domain/workspaces";
import { db, now, runnerId } from "./deps";
import { emitEvent } from "./events";
import { enqueueJob, recoverStaleJobs } from "./jobs/queue";
import { notify } from "./records";
import { getGlobalSettings, getSetting, setSetting } from "./settings";

const log = createLogger({ component: "scheduler" });

/** Single-holder lease so the cloud cron and the worker never run the tick concurrently. */
async function acquireLease(holder: string, seconds: number): Promise<boolean> {
  const until = new Date(now().getTime() + seconds * 1000).toISOString();
  const rows = (await db().execute(sql`
    INSERT INTO system_settings (key, value, updated_at) VALUES ('scheduler_lease', ${JSON.stringify({ holder, until })}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE (system_settings.value->>'until')::timestamptz < ${now()}::timestamptz OR system_settings.value->>'holder' = ${holder}
    RETURNING key
  `)) as unknown as unknown[];
  return rows.length > 0;
}

export interface TickReport {
  ran: boolean;
  workspaces: number;
  contentRequested: number;
  scheduled: number;
  metricsQueued: number;
  followUps: number;
  deliveries: number;
  recovered: number;
  durationMs: number;
}

/**
 * The autonomous loop's clock (run every minute by Vercel/Supabase cron, the
 * worker, or the dev server). Each workspace is processed independently —
 * adding a 20th business needs no code change.
 */
export async function runSchedulerTick(opts: { holder?: string; force?: boolean } = {}): Promise<TickReport> {
  const started = Date.now();
  const report: TickReport = { ran: false, workspaces: 0, contentRequested: 0, scheduled: 0, metricsQueued: 0, followUps: 0, deliveries: 0, recovered: 0, durationMs: 0 };
  if (!(await acquireLease(opts.holder ?? runnerId(), 55)) && !opts.force) return report;
  report.ran = true;
  const settings = await getGlobalSettings();
  report.recovered = await recoverStaleJobs();
  await expireStaleCheckoutsAndSessions();
  const t = now();
  const hourKey = t.toISOString().slice(0, 13);

  const active = await db().select().from(workspaces).where(eq(workspaces.status, "ACTIVE"));
  report.workspaces = active.length;
  for (const ws of active) {
    try {
      await ensureSlots(ws, 3);
      await markMissedSlots(ws);
      const today = localDateString(t, ws.timezone);
      if (!settings.emergencyStop) {
        const b = await analyzeBuffer(ws, "AUTOMATION");
        report.contentRequested += b.requested;
        // Assign READY content to open slots (the scheduler fills slots; autopilot publishes them).
        if (policy(ws, "scheduleContent", "AUTOMATION") === "ALLOW") {
          const ready = await db().execute(sql`SELECT id FROM contents WHERE workspace_id = ${ws.id} AND status = 'READY' AND qa_status <> 'FAILED' ORDER BY created_at LIMIT 4`);
          for (const r of ready as unknown as { id: string }[]) {
            const res = await scheduleContent(r.id, "AUTOMATION");
            if (res.scheduled) report.scheduled++;
            else break;
          }
        }
        // Follow-ups due
        if (policy(ws, "followUp", "AUTOMATION") === "ALLOW") {
          const due = await db()
            .select({ id: leads.id, followupCount: leads.followupCount, lastOutboundAt: leads.lastOutboundAt, lastInboundAt: leads.lastInboundAt })
            .from(leads)
            .where(
              and(
                eq(leads.workspaceId, ws.id),
                eq(leads.doNotContact, false),
                eq(leads.aiPaused, false),
                isNotNull(leads.nextActionAt),
                lte(leads.nextActionAt, t),
                inArray(leads.stage, ["CONTACTED", "ENGAGED", "QUALIFIED", "CHECKOUT"]),
                sql`${leads.followupCount} < ${ws.salesSettings.maxFollowups}`,
                sql`(${leads.lastOutboundAt} IS NULL OR ${leads.lastOutboundAt} < ${new Date(t.getTime() - ws.salesSettings.minFollowupIntervalHours * 3600_000)})`,
                sql`(${leads.lastInboundAt} IS NULL OR ${leads.lastOutboundAt} IS NULL OR ${leads.lastInboundAt} <= ${leads.lastOutboundAt})`,
              ),
            )
            .limit(20);
          for (const l of due) {
            const [conv] = await db().select({ id: conversations.id }).from(conversations).where(eq(conversations.leadId, l.id)).orderBy(desc(conversations.lastMessageAt)).limit(1);
            if (!conv) continue;
            await enqueueJob({ type: "FOLLOW_UP", workspaceId: ws.id, payload: { leadId: l.id, conversationId: conv.id }, idempotencyKey: `followup:${l.id}:${l.followupCount}` });
            await db().update(leads).set({ nextActionAt: null }).where(eq(leads.id, l.id));
            report.followUps++;
          }
        }
      }
      // Nightly learning (after 01:00 local) and weekly strategy (Mondays after 06:00 local)
      const hour = localHour(t, ws.timezone);
      if (hour >= 1 && (!ws.lastPerformanceReviewAt || ws.lastPerformanceReviewAt < startOfLocalDay(t, ws.timezone))) {
        await emitEvent({ type: "PERFORMANCE_REVIEW", workspaceId: ws.id, idempotencyKey: `perf_review:${ws.id}:${today}` });
      }
      if (localWeekday(t, ws.timezone) === 1 && hour >= 6 && (!ws.lastWeeklyStrategyAt || t.getTime() - ws.lastWeeklyStrategyAt.getTime() > 6 * 24 * 3600_000)) {
        await emitEvent({ type: "WEEKLY_STRATEGY_DUE", workspaceId: ws.id, idempotencyKey: `weekly:${ws.id}:${today}` });
      }
      await enqueueJob({ type: "TOKEN_HEALTH", workspaceId: ws.id, idempotencyKey: `token_health:${ws.id}:${today}` });
      await enqueueJob({ type: "ANALYTICS_ROLLUP", workspaceId: ws.id, idempotencyKey: `rollup:${ws.id}:${hourKey}` });
    } catch (e) {
      log.error("workspace tick failed", { workspace: ws.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  report.metricsQueued = await enqueueDueMetricSyncs();
  if (!settings.emergencyStop) {
    for (const d of await contentsNeedingDelivery(settings.deliveryLeadHours)) {
      await enqueueJob({ type: "PREPARE_DELIVERY", workspaceId: d.workspace_id, payload: { renderId: d.render_id, contentId: d.content_id }, idempotencyKey: `delivery:${d.render_id}` });
      report.deliveries++;
    }
  }
  await enqueueJob({ type: "CLEANUP_DELIVERY", workspaceId: null, idempotencyKey: `cleanup_delivery:${hourKey}` });
  await enqueueJob({ type: "CLEANUP_LOCAL_RENDERS", workspaceId: null, idempotencyKey: `cleanup_local:${t.toISOString().slice(0, 10)}` });

  // Daily retention (LGPD)
  const lastRetention = await getSetting<string | null>("retention_last_run", null);
  if (lastRetention !== t.toISOString().slice(0, 10)) {
    await applyRetention();
    await setSetting("retention_last_run", t.toISOString().slice(0, 10));
  }

  const workerOffline = await checkWorkerOffline(settings.workerOfflineAfterSec);
  if (workerOffline) await simulateStaleDemoRenders();
  report.durationMs = Date.now() - started;
  log.info("scheduler tick", { ...report });
  return report;
}

/** Alerts when LOCAL work is waiting but no worker has sent a heartbeat recently. Jobs stay QUEUED. */
export async function checkWorkerOffline(offlineAfterSec: number): Promise<boolean> {
  const [pending] = (await db().execute(sql`SELECT count(*) AS n FROM jobs WHERE runner = 'LOCAL' AND status IN ('QUEUED','RETRYING') AND scheduled_at <= now()`)) as unknown as { n: string }[];
  if (Number(pending?.n ?? 0) === 0) return false;
  const [latest] = await db().select().from(workerInstances).orderBy(desc(workerInstances.lastHeartbeatAt)).limit(1);
  const offline = !latest || now().getTime() - latest.lastHeartbeatAt.getTime() > offlineAfterSec * 1000;
  if (offline) {
    await notify({
      workspaceId: null,
      type: "WORKER_OFFLINE",
      severity: "WARNING",
      title: "Local worker is offline",
      body: `${pending!.n} local job(s) (renders/AI) are waiting. They stay queued and will run as soon as the worker reconnects.`,
      link: "/settings?tab=worker",
      dedupeKey: `worker_offline:${now().toISOString().slice(0, 13)}`,
    });
  }
  return offline;
}

/**
 * DEMO workspaces without a local worker (e.g. a hosted demo): renders waiting
 * more than 5 minutes are completed as SIMULATED renders so the demo keeps
 * flowing. LIVE workspaces are never affected — their renders wait for the worker.
 */
export async function simulateStaleDemoRenders(): Promise<number> {
  const stale = (await db().execute(sql`
    SELECT j.id, j.payload->>'contentId' AS content_id, j.workspace_id FROM jobs j JOIN workspaces w ON w.id = j.workspace_id
    WHERE j.type = 'RENDER_VIDEO' AND j.status IN ('QUEUED','RETRYING') AND w.environment = 'DEMO' AND j.created_at < now() - interval '5 minutes'
    LIMIT 20
  `)) as unknown as { id: string; content_id: string; workspace_id: string }[];
  for (const j of stale) {
    await simulateRender(j.content_id);
    await db().update(jobs).set({ status: "COMPLETED", completedAt: now(), result: { simulated: true, reason: "worker offline (DEMO)" } }).where(eq(jobs.id, j.id));
    await emitEvent({ type: "RENDER_COMPLETED", workspaceId: j.workspace_id, idempotencyKey: `render_completed:sim:${j.id}`, payload: { contentId: j.content_id, simulated: true } });
  }
  return stale.length;
}
