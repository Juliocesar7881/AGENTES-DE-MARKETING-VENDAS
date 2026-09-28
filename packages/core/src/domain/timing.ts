import { and, eq, gte, inArray, postingSlots, sql, type workspaces } from "@revenueos/database";
import {
  addLocalDays,
  bestTimeNear,
  bestWindows,
  buildTimingModel,
  localDateString,
  localHour,
  localWeekday,
  pickDailyTimes,
  type TimingModel,
  type TimingObservation,
  type TimingPlatform,
  zonedToUtc,
} from "@revenueos/shared";
import { db, now } from "../deps";

type Workspace = typeof workspaces.$inferSelect;

const TIMING_PLATFORMS = new Set<TimingPlatform>(["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK"]);
const LOOKBACK_DAYS = 120;

function timingPlatforms(ws: Workspace): TimingPlatform[] {
  return ws.targetPlatforms.filter((p): p is TimingPlatform => TIMING_PLATFORMS.has(p as TimingPlatform));
}

/** Published posts of this business with their latest metrics, leads and clicks. */
export async function timingObservations(ws: Workspace): Promise<TimingObservation[]> {
  const since = new Date(now().getTime() - LOOKBACK_DAYS * 86400_000);
  const rows = (await db().execute(sql`
    SELECT p.platform, p.published_at,
      m.views,
      (SELECT count(*) FROM leads l WHERE l.source_social_post_id = p.id)::int AS leads,
      (SELECT coalesce(sum(t.clicks), 0) FROM tracked_links t WHERE t.social_post_id = p.id)::int AS clicks
    FROM social_posts p
    JOIN LATERAL (SELECT views FROM social_metrics sm WHERE sm.social_post_id = p.id AND sm.views IS NOT NULL ORDER BY sm.captured_at DESC LIMIT 1) m ON true
    WHERE p.workspace_id = ${ws.id} AND p.status = 'PUBLISHED' AND p.published_at >= ${since}
  `)) as unknown as { platform: string; published_at: Date | string; views: number; leads: number; clicks: number }[];
  return rows
    .filter((r) => TIMING_PLATFORMS.has(r.platform as TimingPlatform))
    .map((r) => {
      const at = r.published_at instanceof Date ? r.published_at : new Date(r.published_at);
      return { platform: r.platform as TimingPlatform, weekday: localWeekday(at, ws.timezone), hour: localHour(at, ws.timezone), views: Number(r.views), leads: Number(r.leads), clicks: Number(r.clicks) };
    });
}

const cache = new Map<string, { at: number; model: TimingModel }>();

/** Timing model for a business (cached for 30 minutes; new metrics refresh it). */
export async function timingModel(ws: Workspace): Promise<TimingModel> {
  const key = `${ws.id}:${ws.industry}:${ws.targetPlatforms.join(",")}`;
  const hit = cache.get(key);
  if (hit && now().getTime() - hit.at < 30 * 60_000) return hit.model;
  const model = buildTimingModel({ platforms: timingPlatforms(ws), industry: `${ws.industry} ${ws.description}`, observations: await timingObservations(ws) });
  cache.set(key, { at: now().getTime(), model });
  return model;
}

export function invalidateTimingModel(workspaceId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${workspaceId}:`)) cache.delete(k);
}

/**
 * Smart slots: for each of the next `days` local days, adds slots until the day has
 * `postsPerDay`, at the best hours for this business (never re-plans slots that exist).
 */
export async function ensureSmartSlots(ws: Workspace, days = 3): Promise<number> {
  if (ws.postsPerDay <= 0) return 0;
  const today = localDateString(now(), ws.timezone);
  const existing = await db()
    .select({ localDate: postingSlots.localDate, localTime: postingSlots.localTime })
    .from(postingSlots)
    .where(and(eq(postingSlots.workspaceId, ws.id), gte(postingSlots.localDate, today), inArray(postingSlots.status, ["OPEN", "FILLED", "PUBLISHED"])));
  const model = await timingModel(ws);
  const earliest = now().getTime() + 10 * 60_000;
  const rows: { workspaceId: string; scheduledFor: Date; localDate: string; localTime: string }[] = [];
  for (let i = 0; i < days; i++) {
    const day = addLocalDays(today, i);
    const have = existing.filter((e) => e.localDate === day).map((e) => e.localTime);
    const need = ws.postsPerDay - have.length;
    if (need <= 0) continue;
    const weekday = localWeekday(zonedToUtc(day, "12:00", ws.timezone), ws.timezone);
    // Today: plan more candidates than needed so past hours can be skipped.
    const times = pickDailyTimes(model, { weekday, count: i === 0 ? need + 3 : need, seed: `${ws.id}:${day}`, existing: have });
    let added = 0;
    for (const t of times) {
      if (added >= need) break;
      const at = zonedToUtc(day, t, ws.timezone);
      if (at.getTime() < earliest) continue;
      rows.push({ workspaceId: ws.id, scheduledFor: at, localDate: day, localTime: t });
      added++;
    }
  }
  if (!rows.length) return 0;
  const res = await db().insert(postingSlots).values(rows).onConflictDoNothing().returning({ id: postingSlots.id });
  return res.length;
}

/** Per-network fine tuning: each network posts at its own best moment within ±90 min of the slot. */
export function tunedTimeFor(ws: Workspace, platform: string, slotAt: Date): Date {
  if (!TIMING_PLATFORMS.has(platform as TimingPlatform)) return slotAt;
  const day = localDateString(slotAt, ws.timezone);
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: ws.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(slotAt);
  const best = bestTimeNear(platform as TimingPlatform, localWeekday(slotAt, ws.timezone), hhmm, `${ws.industry} ${ws.description}`);
  const tuned = zonedToUtc(day, best, ws.timezone);
  // Never earlier than a few minutes from now (the video must have time to be delivered).
  return tuned.getTime() < now().getTime() + 5 * 60_000 ? slotAt : tuned;
}

/** Summary for the dashboard: mode, best windows, how much was learned, next planned slots. */
export async function timingInsights(ws: Workspace) {
  const model = await timingModel(ws);
  const upcoming = await db()
    .select({ scheduledFor: postingSlots.scheduledFor, localDate: postingSlots.localDate, localTime: postingSlots.localTime, status: postingSlots.status })
    .from(postingSlots)
    .where(and(eq(postingSlots.workspaceId, ws.id), gte(postingSlots.scheduledFor, now()), inArray(postingSlots.status, ["OPEN", "FILLED"])))
    .orderBy(postingSlots.scheduledFor)
    .limit(8);
  return {
    mode: ws.postingMode,
    learned: model.learned,
    observations: model.observations,
    segment: model.segment,
    windows: bestWindows(model),
    upcoming: upcoming.map((u) => ({ at: u.scheduledFor.toISOString(), localDate: u.localDate, localTime: u.localTime, status: u.status })),
  };
}
