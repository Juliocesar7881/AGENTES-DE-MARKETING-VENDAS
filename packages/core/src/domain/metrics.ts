import { and, eq, isNotNull, lte, socialAccounts, socialMetrics, socialPosts, workspaces } from "@revenueos/database";
import { db, now } from "../deps";
import { enqueueJob } from "../jobs/queue";
import { accountInfo, freshCredentials, isDemo, socialProviderFor } from "../providers";
import { nextMetricsSyncDelayHours } from "./buffer";

/** Pulls metrics for one published post and schedules the next sync (frequent when young, rare when old). */
export async function syncPostMetrics(socialPostId: string): Promise<Record<string, unknown>> {
  const [post] = await db().select().from(socialPosts).where(eq(socialPosts.id, socialPostId)).limit(1);
  if (!post || post.status !== "PUBLISHED" || !post.platformPostId) return { skipped: "not published" };
  const [account] = await db().select().from(socialAccounts).where(eq(socialAccounts.id, post.socialAccountId)).limit(1);
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, post.workspaceId)).limit(1);
  if (!account || !ws || account.workspaceId !== post.workspaceId) return { skipped: "account mismatch" };
  const provider = await socialProviderFor(account.platform, { workspaceId: ws.id, isDemo: isDemo(ws), accountIsDemo: account.isDemo });
  const creds = await freshCredentials(provider, account);
  const m = await provider.getMetrics(creds, accountInfo(account), post.platformPostId, { ...post.providerState, publishedAt: post.publishedAt?.toISOString() });
  await db().insert(socialMetrics).values({
    workspaceId: post.workspaceId,
    socialPostId: post.id,
    views: m.views ?? null,
    reach: m.reach ?? null,
    impressions: m.impressions ?? null,
    likes: m.likes ?? null,
    comments: m.comments ?? null,
    shares: m.shares ?? null,
    saves: m.saves ?? null,
    clicks: m.clicks ?? null,
    watchTimeMs: m.watchTimeMs ?? null,
    avgWatchMs: m.avgWatchMs ?? null,
    raw: m.raw,
    isSimulated: provider.isMock,
  });
  const ageH = (now().getTime() - (post.publishedAt ?? now()).getTime()) / 3600_000;
  const delay = nextMetricsSyncDelayHours(ageH);
  await db()
    .update(socialPosts)
    .set({ lastMetricsSyncAt: now(), nextMetricsSyncAt: delay == null ? null : new Date(now().getTime() + delay * 3600_000) })
    .where(eq(socialPosts.id, post.id));
  return { views: m.views ?? null, simulated: provider.isMock };
}

/** Scheduler helper: enqueue due metric syncs (idempotent per post + hour). */
export async function enqueueDueMetricSyncs(limit = 100): Promise<number> {
  const due = await db()
    .select({ id: socialPosts.id, workspaceId: socialPosts.workspaceId })
    .from(socialPosts)
    .where(and(eq(socialPosts.status, "PUBLISHED"), isNotNull(socialPosts.nextMetricsSyncAt), lte(socialPosts.nextMetricsSyncAt, now())))
    .limit(limit);
  for (const p of due) {
    await enqueueJob({ type: "SYNC_METRICS", workspaceId: p.workspaceId, payload: { socialPostId: p.id }, idempotencyKey: `metrics:${p.id}:${now().toISOString().slice(0, 13)}` });
  }
  return due.length;
}
