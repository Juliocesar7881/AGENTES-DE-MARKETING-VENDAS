import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { and, contents, desc, eq, isNull, lt, or, postingSlots, socialAccounts, socialPosts, sql, videoRenders, workspaces } from "@revenueos/database";
import type { ProviderState, VideoSource } from "@revenueos/providers/social";
import { AppError, PLATFORM_LABELS, serializeError } from "@revenueos/shared";
import { db, isLocalWorker, now } from "../deps";
import { emitEvent } from "../events";
import { RescheduleSignal, type JobOrigin } from "../jobs/queue";
import { accountInfo, freshCredentials, isDemo, socialProviderFor, storage, type Workspace } from "../providers";
import { audit, notify, recordActivity } from "../records";
import { isEmergencyStopped } from "../settings";
import { canTransitionPost } from "./state-machines";
import { policy } from "./workspaces";

async function latestRender(contentId: string) {
  const rows = await db()
    .select()
    .from(videoRenders)
    .where(and(eq(videoRenders.contentId, contentId), or(eq(videoRenders.status, "COMPLETED"), eq(videoRenders.status, "SIMULATED"))))
    .orderBy(desc(videoRenders.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Where the provider gets the MP4 from: temporary cloud delivery, or the local file on the worker. */
async function videoSourceFor(contentId: string, mock: boolean): Promise<VideoSource> {
  const r = await latestRender(contentId);
  if (mock) {
    return { size: r?.fileSize ?? 0, url: null, read: async () => (r?.localPath && existsSync(r.localPath) ? readFile(r.localPath) : Buffer.alloc(0)) };
  }
  if (!r || r.status !== "COMPLETED") {
    throw new AppError({ code: "VIDEO_NOT_RENDERED", userMessage: "The video has not been rendered yet. It will publish after the local worker renders it.", retryable: true, retryAfterSec: 600 });
  }
  const st = storage();
  if (r.deliveryKey && !r.deliveryDeletedAt) {
    const key = r.deliveryKey;
    return {
      size: r.fileSize ?? 0,
      url: st.remote ? await st.getSignedUrl(key, 6 * 3600) : null,
      read: () => st.get(key),
      thumbnail: r.thumbnailKey ? () => st.get(r.thumbnailKey!).catch(() => null) : undefined,
    };
  }
  if (isLocalWorker() && r.localPath && existsSync(r.localPath)) {
    const size = (await stat(r.localPath)).size;
    return { size, url: null, read: () => readFile(r.localPath!), thumbnail: r.thumbnailKey ? () => st.get(r.thumbnailKey!).catch(() => null) : undefined };
  }
  throw new AppError({
    code: "VIDEO_NOT_DELIVERED",
    userMessage: "The video file is still on the local worker and has not been uploaded for publishing yet. Make sure the worker is online.",
    retryable: true,
    retryAfterSec: 300,
  });
}

async function finalizeContent(contentId: string): Promise<void> {
  const posts = await db().select().from(socialPosts).where(eq(socialPosts.contentId, contentId));
  const active = posts.filter((p) => p.status !== "CANCELLED");
  if (active.length === 0) return;
  const anyPublished = active.some((p) => p.status === "PUBLISHED" || p.status === "DRAFT");
  const pending = active.some((p) => ["QUEUED", "UPLOADING", "PROCESSING"].includes(p.status));
  const allFailed = active.every((p) => p.status === "FAILED");
  const [c] = await db().select().from(contents).where(eq(contents.id, contentId)).limit(1);
  if (!c) return;
  if (anyPublished && c.status !== "PUBLISHED") {
    await db().update(contents).set({ status: "PUBLISHED", publishedAt: c.publishedAt ?? now(), failureReason: null }).where(eq(contents.id, contentId));
    if (c.slotId) await db().update(postingSlots).set({ status: "PUBLISHED" }).where(eq(postingSlots.id, c.slotId));
  } else if (!pending && allFailed) {
    const reason = active.map((p) => `${PLATFORM_LABELS[p.platform]}: ${p.lastError ?? "failed"}`).join(" · ");
    await db().update(contents).set({ status: "FAILED", failureReason: reason }).where(eq(contents.id, contentId));
  } else if (pending && c.status === "SCHEDULED") {
    await db().update(contents).set({ status: "PUBLISHING" }).where(eq(contents.id, contentId));
  }
}

const TOKEN_ERRORS = /TOKEN_EXPIRED|INVALID_GRANT|ACCESS_TOKEN_INVALID|SOCIAL_NO_TOKEN|_AUTH$/;

/**
 * Publishes one SocialPost. Safety: the post, content, account and job must
 * all belong to the same workspace (server-side check). A per-post lock plus
 * the persisted provider state make retries resume instead of double-posting.
 */
export async function publishSocialPost(socialPostId: string, ctx: { jobId: string; workspaceId: string | null; origin: JobOrigin }): Promise<Record<string, unknown>> {
  const [post] = await db().select().from(socialPosts).where(eq(socialPosts.id, socialPostId)).limit(1);
  if (!post) return { skipped: "post not found" };
  if (post.status === "PUBLISHED" || post.status === "DRAFT" || post.status === "CANCELLED") return { skipped: `post already ${post.status}` };
  const [content] = await db().select().from(contents).where(eq(contents.id, post.contentId)).limit(1);
  const [account] = await db().select().from(socialAccounts).where(eq(socialAccounts.id, post.socialAccountId)).limit(1);
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, post.workspaceId)).limit(1);
  if (!content || !account || !ws) return { skipped: "missing related records" };

  // Server-side isolation check: never post to another workspace's account.
  if (account.workspaceId !== post.workspaceId || content.workspaceId !== post.workspaceId || (ctx.workspaceId && ctx.workspaceId !== post.workspaceId)) {
    await audit({ workspaceId: post.workspaceId, actorType: "SYSTEM", action: "publish.blocked_workspace_mismatch", entityType: "social_post", entityId: post.id, details: { accountWs: account.workspaceId, contentWs: content.workspaceId, jobWs: ctx.workspaceId } });
    await db().update(socialPosts).set({ status: "FAILED", lastError: "Blocked: workspace mismatch between content and social account." }).where(eq(socialPosts.id, post.id));
    throw new AppError({ code: "WORKSPACE_MISMATCH", userMessage: "Publishing blocked: the social account does not belong to this workspace.", retryable: false });
  }
  if (await isEmergencyStopped()) throw new RescheduleSignal(600, "Emergency stop is active — publication paused.");
  if (ctx.origin !== "HUMAN" && content.approvalStatus !== "APPROVED" && policy(ws, "publishContent", ctx.origin) !== "ALLOW") {
    return { skipped: "awaiting approval" };
  }

  // Per-post publishing lock (30 min) — prevents concurrent double publication.
  const lock = await db()
    .update(socialPosts)
    .set({ publishLock: ctx.jobId, lockedAt: now() })
    .where(and(eq(socialPosts.id, post.id), or(isNull(socialPosts.publishLock), eq(socialPosts.publishLock, ctx.jobId), lt(socialPosts.lockedAt, new Date(now().getTime() - 30 * 60 * 1000)))))
    .returning({ id: socialPosts.id });
  if (!lock[0]) throw new RescheduleSignal(120, "Another runner is publishing this post.");

  const demo = isDemo(ws) || account.isDemo;
  const provider = await socialProviderFor(account.platform, { workspaceId: ws.id, isDemo: isDemo(ws), accountIsDemo: account.isDemo });
  const info = accountInfo(account);
  try {
    const creds = await freshCredentials(provider, account);
    let state: ProviderState = { ...post.providerState };
    // Retry after a crash/timeout: ask the platform first instead of re-uploading blindly.
    if (Object.keys(state).length > 0) {
      const st = await provider.getPublishStatus(creds, info, state);
      if (st.status === "PUBLISHED") {
        await markPublished(ws, content, post.id, { platformPostId: st.platformPostId ?? null, permalink: st.permalink ?? null, state, notice: null, privacy: post.privacy }, ctx.origin, demo);
        return { published: true, resumed: true };
      }
      if (st.status === "PROCESSING") {
        await db().update(socialPosts).set({ status: "PROCESSING", publishLock: null }).where(eq(socialPosts.id, post.id));
        throw new RescheduleSignal(120, "Platform is still processing the upload.");
      }
      if (st.status === "SENT_TO_DRAFTS") {
        await markDraft(ws, content, post.id, state);
        return { draft: true };
      }
    }
    if (canTransitionPost(post.status, "UPLOADING")) {
      await db().update(socialPosts).set({ status: "UPLOADING", attemptCount: post.attemptCount + 1 }).where(eq(socialPosts.id, post.id));
    }
    if (content.status === "SCHEDULED") await db().update(contents).set({ status: "PUBLISHING" }).where(eq(contents.id, content.id));
    const video = await videoSourceFor(content.id, provider.isMock);
    const result = await provider.publishVideo(creds, info, {
      idempotencyKey: post.idempotencyKey,
      video,
      caption: post.caption,
      title: post.title,
      hashtags: post.hashtags,
      privacy: post.privacy,
      mode: post.publishMode,
      aiGenerated: post.aiLabel,
      durationSec: content.durationSec ?? 30,
      state: { ...state, publishedAt: now().toISOString() },
      saveState: async (s) => {
        state = s;
        await db().update(socialPosts).set({ providerState: s }).where(eq(socialPosts.id, post.id));
      },
    });
    if (result.outcome === "PROCESSING") {
      await db().update(socialPosts).set({ status: "PROCESSING", providerState: result.state, publishLock: null }).where(eq(socialPosts.id, post.id));
      throw new RescheduleSignal(120, "Platform is processing the video; checking again in 2 minutes.");
    }
    if (result.outcome === "SENT_TO_DRAFTS") {
      await markDraft(ws, content, post.id, result.state, result.notice);
      return { draft: true };
    }
    await markPublished(ws, content, post.id, { platformPostId: result.platformPostId ?? null, permalink: result.permalink ?? null, state: result.state, notice: result.notice ?? null, privacy: result.privacy ?? post.privacy }, ctx.origin, demo);
    return { published: true, platformPostId: result.platformPostId ?? null };
  } catch (e) {
    if (e instanceof RescheduleSignal) throw e;
    const ser = serializeError(e);
    const tokenProblem = TOKEN_ERRORS.test(ser.code);
    await db()
      .update(socialPosts)
      .set({ status: "QUEUED", lastError: ser.userMessage, errorDetails: { code: ser.code, message: ser.message, details: ser.details ?? null }, publishLock: null })
      .where(eq(socialPosts.id, post.id));
    if (tokenProblem) {
      await db().update(socialAccounts).set({ status: "EXPIRED", lastError: ser.userMessage }).where(eq(socialAccounts.id, account.id));
      await notify({
        workspaceId: ws.id,
        type: "TOKEN_EXPIRED",
        severity: "ERROR",
        title: `${PLATFORM_LABELS[account.platform]} needs reconnection — ${ws.name}`,
        body: ser.userMessage,
        link: `/w/${ws.slug}/connections`,
        dedupeKey: `token:${account.id}:${now().toISOString().slice(0, 13)}`,
      });
      throw new AppError({ code: ser.code, userMessage: ser.userMessage, retryable: false, cause: e });
    }
    throw e;
  }
}

async function markPublished(
  ws: Workspace,
  content: typeof contents.$inferSelect,
  postId: string,
  r: { platformPostId: string | null; permalink: string | null; state: ProviderState; notice: string | null; privacy: string | null },
  origin: JobOrigin,
  demo: boolean,
): Promise<void> {
  const [post] = await db()
    .update(socialPosts)
    .set({
      status: "PUBLISHED",
      platformPostId: r.platformPostId,
      permalink: r.permalink,
      providerState: r.state,
      publishedAt: now(),
      privacy: r.privacy,
      lastError: r.notice,
      publishLock: null,
      nextMetricsSyncAt: new Date(now().getTime() + 3600 * 1000),
      publishedBy: origin === "HUMAN" ? "HUMAN" : "AI",
    })
    .where(eq(socialPosts.id, postId))
    .returning();
  await finalizeContent(content.id);
  await emitEvent({ type: "POST_PUBLISHED", workspaceId: ws.id, idempotencyKey: `post_published:${postId}`, payload: { socialPostId: postId, contentId: content.id, platform: post!.platform } });
  const label = PLATFORM_LABELS[post!.platform];
  await recordActivity({
    workspaceId: ws.id,
    type: "POST_PUBLISHED",
    title: `${label} published Content #${content.number}${demo ? " (DEMO — simulated)" : ""}${r.privacy === "SELF_ONLY" || r.privacy === "private" ? " as PRIVATE" : ""}`,
    agentRole: origin === "HUMAN" ? null : "GROWTH",
    entityType: "social_post",
    entityId: postId,
    details: { permalink: r.permalink, notice: r.notice },
  });
  await audit({
    workspaceId: ws.id,
    actorType: origin === "HUMAN" ? "USER" : "AGENT",
    action: origin === "HUMAN" ? "content.published_by_human" : "content.published_by_ai",
    entityType: "social_post",
    entityId: postId,
    details: { platform: post!.platform, socialAccountId: post!.socialAccountId, contentId: content.id, workspace: ws.name, demo },
  });
}

async function markDraft(ws: Workspace, content: typeof contents.$inferSelect, postId: string, state: ProviderState, notice?: string | null): Promise<void> {
  await db()
    .update(socialPosts)
    .set({ status: "DRAFT", providerState: state, publishLock: null, lastError: notice ?? "Sent to the creator's drafts — finish posting in the app." })
    .where(eq(socialPosts.id, postId));
  await finalizeContent(content.id);
  await notify({
    workspaceId: ws.id,
    type: "ACTION_REQUIRED",
    severity: "WARNING",
    title: `Finish posting in the app — Content #${content.number}`,
    body: notice ?? "The video was uploaded as a draft/inbox item because direct posting is not available.",
    link: `/w/${ws.slug}/content/${content.id}`,
    dedupeKey: `draft:${postId}`,
  });
}

/** Called when a PUBLISH_POST job fails for good: keep the video, surface the reason, allow Retry. */
export async function onPublishFinalFailure(socialPostId: string, error: unknown): Promise<void> {
  const ser = serializeError(error);
  const [post] = await db()
    .update(socialPosts)
    .set({ status: "FAILED", lastError: ser.userMessage, errorDetails: { code: ser.code, message: ser.message }, publishLock: null })
    .where(eq(socialPosts.id, socialPostId))
    .returning();
  if (!post) return;
  await finalizeContent(post.contentId);
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, post.workspaceId)).limit(1);
  await notify({
    workspaceId: post.workspaceId,
    type: "PUBLISH_FAILED",
    severity: "ERROR",
    title: `${PLATFORM_LABELS[post.platform]} publication failed`,
    body: ser.userMessage,
    link: ws ? `/w/${ws.slug}/content/${post.contentId}` : null,
    dedupeKey: `publish_failed:${post.id}`,
  });
  await recordActivity({ workspaceId: post.workspaceId, type: "PUBLISH_FAILED", title: `${PLATFORM_LABELS[post.platform]} publish failed: ${ser.userMessage}`, agentRole: "GROWTH", entityType: "social_post", entityId: post.id });
}

/** Retry button: resets a failed post to QUEUED and enqueues it now. */
export async function retryPost(socialPostId: string, userId: string): Promise<void> {
  const [post] = await db().update(socialPosts).set({ status: "QUEUED", lastError: null, publishLock: null }).where(and(eq(socialPosts.id, socialPostId), sql`status IN ('FAILED','CANCELLED')`)).returning();
  if (!post) return;
  const { enqueueJob } = await import("../jobs/queue");
  await enqueueJob({ type: "PUBLISH_POST", workspaceId: post.workspaceId, payload: { socialPostId }, origin: "HUMAN", idempotencyKey: `publish:${socialPostId}:retry:${Date.now()}` });
  await audit({ workspaceId: post.workspaceId, actorType: "USER", actorId: userId, action: "post.retry", entityType: "social_post", entityId: socialPostId });
}
