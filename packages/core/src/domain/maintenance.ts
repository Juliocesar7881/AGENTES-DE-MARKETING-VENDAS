import {
  and,
  dailyAnalytics,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  socialAccounts,
  socialPosts,
  sql,
  videoRenders,
  workspaces,
} from "@revenueos/database";
import { performanceReview, weeklyStrategy } from "@revenueos/agents";
import { AppError, localDateString, PLATFORM_LABELS, startOfLocalDay } from "@revenueos/shared";
import { db, now } from "../deps";
import { accountInfo, isDemo, loadSocialCredentials, resolveAI, socialProviderFor, storage, storeSocialCredentials, type Workspace } from "../providers";
import { notify, recordActivity } from "../records";
import { recordAgentRun, setAgentStatus } from "./agent-runs";
import { totals } from "./analytics";
import { loadBusinessContext, loadPerformanceContext } from "./context";
import { refreshInsights, saveMemory } from "./learning";

/** Nightly PERFORMANCE_REVIEW: deterministic insights first, then the Strategist's narrative + memories. */
export async function runPerformanceReview(ws: Workspace, jobId: string): Promise<Record<string, unknown>> {
  const insights = await refreshInsights(ws, 30);
  let aiInsights = 0;
  try {
    const [business, p7, p30] = await Promise.all([loadBusinessContext(ws), loadPerformanceContext(ws, 7), loadPerformanceContext(ws, 30)]);
    const ai = await resolveAI(ws, "strategist");
    await setAgentStatus(ws.id, "STRATEGIST", "WORKING", { task: "Nightly performance review", jobId });
    const res = await performanceReview(ai.runtime, business, p7, p30);
    await recordAgentRun({ workspaceId: ws.id, jobId, isDemo: ai.isMock, result: res });
    for (const m of res.result.data.memories) await saveMemory(ws.id, m.category, m.content, { source: "performance_review" }, 6);
    aiInsights = res.result.data.insights.length;
    await recordActivity({ workspaceId: ws.id, type: "PERFORMANCE_REVIEW", title: `Strategist nightly review: ${res.result.data.headline}`, agentRole: "STRATEGIST", details: { insights: res.result.data.insights, nextFocus: res.result.data.nextFocus } });
  } catch (e) {
    await recordActivity({ workspaceId: ws.id, type: "PERFORMANCE_REVIEW", title: `Nightly review saved ${insights.length} deterministic insights (AI summary skipped: ${e instanceof AppError ? e.userMessage : "error"})`, agentRole: "STRATEGIST" });
  } finally {
    await setAgentStatus(ws.id, "STRATEGIST", "IDLE");
    await db().update(workspaces).set({ lastPerformanceReviewAt: now() }).where(eq(workspaces.id, ws.id));
  }
  return { insights: insights.length, aiInsights };
}

export async function runWeeklyStrategy(ws: Workspace, jobId: string): Promise<Record<string, unknown>> {
  const [business, p30] = await Promise.all([loadBusinessContext(ws), loadPerformanceContext(ws, 30)]);
  const ai = await resolveAI(ws, "strategist");
  const res = await weeklyStrategy(ai.runtime, business, p30);
  await recordAgentRun({ workspaceId: ws.id, jobId, isDemo: ai.isMock, result: res });
  await db().update(workspaces).set({ weeklyStrategy: { ...res.result.data, generatedAt: now().toISOString() }, lastWeeklyStrategyAt: now() }).where(eq(workspaces.id, ws.id));
  await recordActivity({ workspaceId: ws.id, type: "WEEKLY_STRATEGY", title: "Strategist published the weekly strategy", agentRole: "STRATEGIST" });
  return { priorities: res.result.data.priorities.length };
}

/** Daily rollup into daily_analytics (today and yesterday in the workspace timezone). */
export async function rollupAnalytics(ws: Workspace): Promise<void> {
  for (const offset of [0, 1]) {
    const dayStart = new Date(startOfLocalDay(now(), ws.timezone).getTime() - offset * 24 * 3600 * 1000);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const t = await totals([ws.id], dayStart, dayEnd);
    const date = localDateString(new Date(dayStart.getTime() + 3600 * 1000), ws.timezone);
    const generated = (await db().execute(sql`SELECT count(*) AS n FROM contents WHERE workspace_id = ${ws.id} AND created_at >= ${dayStart} AND created_at < ${dayEnd}`)) as unknown as { n: string }[];
    const clicks = (await db().execute(sql`SELECT count(*) AS n FROM attribution_events WHERE workspace_id = ${ws.id} AND event_type='CLICK' AND occurred_at >= ${dayStart} AND occurred_at < ${dayEnd}`)) as unknown as { n: string }[];
    const values = {
      postsPublished: t.postsPublished,
      contentsGenerated: Number(generated[0]?.n ?? 0),
      views: t.views,
      clicks: Number(clicks[0]?.n ?? 0),
      leads: t.leads,
      qualifiedLeads: t.qualifiedLeads,
      checkouts: t.checkouts,
      sales: t.sales,
      revenueCents: t.revenueCents,
      aiCostUsd: t.aiCostUsd,
    };
    await db()
      .insert(dailyAnalytics)
      .values({ workspaceId: ws.id, date, ...values })
      .onConflictDoUpdate({ target: [dailyAnalytics.workspaceId, dailyAnalytics.date], set: { ...values, updatedAt: now() } });
  }
}

/** Token health: validate connections daily, refresh tokens nearing expiry, warn before expiration. */
export async function runTokenHealth(ws: Workspace): Promise<Record<string, unknown>> {
  const accounts = await db().select().from(socialAccounts).where(eq(socialAccounts.workspaceId, ws.id));
  let ok = 0;
  let problems = 0;
  for (const acc of accounts) {
    if (acc.isDemo) {
      ok++;
      continue;
    }
    try {
      const provider = await socialProviderFor(acc.platform, { workspaceId: ws.id, isDemo: isDemo(ws), accountIsDemo: acc.isDemo });
      let creds = await loadSocialCredentials(acc.id);
      if (creds.expiresAt && creds.expiresAt.getTime() - now().getTime() < 7 * 24 * 3600 * 1000) {
        const refreshed = await provider.refreshAuth(creds).catch(() => null);
        if (refreshed) {
          await storeSocialCredentials(acc, { ...refreshed, extra: refreshed.extra ?? creds.extra });
          creds = { ...refreshed, extra: refreshed.extra ?? creds.extra };
        } else {
          await notify({ workspaceId: ws.id, type: "TOKEN_EXPIRED", severity: "WARNING", title: `${PLATFORM_LABELS[acc.platform]} connection expires soon`, body: `@${acc.username} expires on ${creds.expiresAt.toISOString().slice(0, 10)}. Reconnect to avoid interruptions.`, link: `/w/${ws.slug}/integrations`, dedupeKey: `expiring:${acc.id}:${creds.expiresAt.toISOString().slice(0, 10)}` });
        }
      }
      const test = await provider.validateConnection(creds, accountInfo(acc));
      const status = !test.authenticated ? "EXPIRED" : test.publishPermissionOk ? "CONNECTED" : "NEEDS_ACTION";
      await db()
        .update(socialAccounts)
        .set({ status, lastValidatedAt: now(), actionRequired: test.actionRequired ?? null, lastError: test.authenticated ? null : (test.actionRequired?.reason ?? "Authentication failed"), capabilities: test.details })
        .where(eq(socialAccounts.id, acc.id));
      if (status === "EXPIRED") {
        problems++;
        await notify({ workspaceId: ws.id, type: "TOKEN_EXPIRED", severity: "ERROR", title: `${PLATFORM_LABELS[acc.platform]} disconnected — ${ws.name}`, body: test.actionRequired?.reason ?? "Reconnect the account.", link: `/w/${ws.slug}/integrations`, dedupeKey: `expired:${acc.id}:${localDateString(now(), ws.timezone)}` });
      } else ok++;
    } catch (e) {
      problems++;
      await db().update(socialAccounts).set({ lastValidatedAt: now(), lastError: e instanceof AppError ? e.userMessage : String(e) }).where(eq(socialAccounts.id, acc.id));
    }
  }
  return { ok, problems };
}

/** Removes temporary cloud copies once every post of the content is final. Never touches local originals. */
export async function cleanupDeliveries(): Promise<number> {
  const candidates = await db()
    .select()
    .from(videoRenders)
    .where(and(isNotNull(videoRenders.deliveryKey), isNull(videoRenders.deliveryDeletedAt)))
    .limit(100);
  let removed = 0;
  for (const r of candidates) {
    const posts = await db().select({ status: socialPosts.status }).from(socialPosts).where(eq(socialPosts.contentId, r.contentId));
    const allFinal = posts.length > 0 && posts.every((p) => ["PUBLISHED", "DRAFT", "FAILED", "CANCELLED"].includes(p.status));
    const expired = r.deliveryExpiresAt && r.deliveryExpiresAt.getTime() < now().getTime();
    const oldEnough = r.deliveredAt && now().getTime() - r.deliveredAt.getTime() > 3600 * 1000;
    if ((allFinal && oldEnough) || expired) {
      try {
        await storage().delete(r.deliveryKey!);
      } catch {
        /* object may already be gone */
      }
      await db().update(videoRenders).set({ deliveryDeletedAt: now() }).where(eq(videoRenders.id, r.id));
      removed++;
    }
  }
  return removed;
}

/** Contents scheduled soon whose video is still only on the worker → ask the worker to upload a temporary copy. */
export async function contentsNeedingDelivery(leadHours: number) {
  const until = new Date(now().getTime() + leadHours * 3600 * 1000);
  return (await db().execute(sql`
    SELECT DISTINCT r.id AS render_id, r.content_id, r.workspace_id
    FROM video_renders r
    JOIN contents c ON c.id = r.content_id
    JOIN social_posts sp ON sp.content_id = c.id
    JOIN social_accounts sa ON sa.id = sp.social_account_id
    WHERE r.status = 'COMPLETED' AND r.delivery_key IS NULL AND r.local_path IS NOT NULL
      AND c.status IN ('SCHEDULED','PUBLISHING') AND c.scheduled_for <= ${until}
      AND sp.status IN ('QUEUED','UPLOADING') AND sa.is_demo = false
      AND r.id = (SELECT id FROM video_renders r2 WHERE r2.content_id = c.id AND r2.status = 'COMPLETED' ORDER BY created_at DESC LIMIT 1)
  `)) as unknown as { render_id: string; content_id: string; workspace_id: string }[];
}

export async function expireStaleCheckoutsAndSessions(): Promise<void> {
  await db().execute(sql`UPDATE checkouts SET status = 'EXPIRED' WHERE status IN ('CREATED','SENT') AND expires_at < now()`);
  await db().execute(sql`DELETE FROM auth_sessions WHERE expires_at < now()`);
  await db().execute(sql`DELETE FROM oauth_states WHERE expires_at < now()`);
  await db().execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
}

void inArray;
void lt;
void or;
