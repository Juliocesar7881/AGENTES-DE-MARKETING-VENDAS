"use server";
import { revalidatePath } from "next/cache";
import { approveContent, archiveContent, enqueueJob, publishNow, regenerateContentHook, rescheduleContent, retryPost, saveEditedSpec, scheduleContent, unscheduleContent, currentSpec, setContentStatus } from "@revenueos/core";
import { contents, eq, socialPosts, withUser, workspaces } from "@revenueos/database";
import { AppError, AuthorizationError } from "@revenueos/shared";
import { run } from "../action";
import { kick } from "../runner";
import { requireUser } from "../session";

/** Loads the content through RLS: a content from another tenant is simply not found. */
async function owned(contentId: string) {
  const user = await requireUser();
  const [row] = await withUser(user.id, (tx) =>
    tx.select({ c: contents, slug: workspaces.slug }).from(contents).innerJoin(workspaces, eq(workspaces.id, contents.workspaceId)).where(eq(contents.id, contentId)).limit(1),
  );
  if (!row) throw new AuthorizationError("Content not found.");
  return { user, c: row.c, slug: row.slug };
}

function refresh(slug: string, id: string) {
  revalidatePath(`/w/${slug}/content`);
  revalidatePath(`/w/${slug}/content/${id}`);
  revalidatePath(`/w/${slug}/calendar`);
  revalidatePath(`/w/${slug}`);
}

export async function approveContentAction(contentId: string) {
  return run(async () => {
    const { user, c, slug } = await owned(contentId);
    await approveContent(contentId, user.id);
    kick([c.workspaceId]);
    refresh(slug, contentId);
    return null;
  }, "Approved — publication is scheduled");
}

export async function scheduleContentAction(contentId: string, at?: string | null) {
  return run(async () => {
    const { user, c, slug } = await owned(contentId);
    const when = at ? new Date(at) : null;
    if (when && Number.isNaN(when.getTime())) throw new AppError({ code: "BAD_DATE", userMessage: "Invalid date." });
    const r = c.status === "SCHEDULED" && when ? (await rescheduleContent(contentId, when, user.id), { scheduled: true, reason: "rescheduled" }) : await scheduleContent(contentId, "HUMAN", { at: when, userId: user.id });
    if (!r.scheduled) throw new AppError({ code: "NOT_SCHEDULED", userMessage: `Could not schedule: ${r.reason}.` });
    kick([c.workspaceId]);
    refresh(slug, contentId);
    return null;
  }, "Scheduled");
}

export async function rescheduleAction(contentId: string, at: string) {
  return run(async () => {
    const { user, c, slug } = await owned(contentId);
    await rescheduleContent(contentId, new Date(at), user.id);
    kick([c.workspaceId]);
    refresh(slug, contentId);
    return null;
  }, "Moved");
}

export async function unscheduleAction(contentId: string) {
  return run(async () => {
    const { user, slug } = await owned(contentId);
    await unscheduleContent(contentId, user.id);
    refresh(slug, contentId);
    return null;
  }, "Unscheduled — back to Ready");
}

export async function publishNowAction(contentId: string) {
  return run(async () => {
    const { user, c, slug } = await owned(contentId);
    await publishNow(contentId, user.id);
    kick([c.workspaceId], { maxJobs: 10, timeoutMs: 60_000 });
    refresh(slug, contentId);
    return null;
  }, "Publishing in ~90 seconds");
}

export async function archiveAction(contentId: string) {
  return run(async () => {
    const { user, slug } = await owned(contentId);
    await archiveContent(contentId, user.id);
    refresh(slug, contentId);
    return null;
  }, "Archived");
}

/** Re-render with the current VideoSpec on the local worker. */
export async function rerenderAction(contentId: string) {
  return run(async () => {
    const { user, c, slug } = await owned(contentId);
    if (!(await currentSpec(contentId))) throw new AppError({ code: "NO_SPEC", userMessage: "This content has no VideoSpec yet — regenerate it first." });
    if (c.status === "SCHEDULED") await unscheduleContent(contentId, user.id);
    if (["READY", "RENDERED", "FAILED", "SCHEDULED"].includes(c.status)) await setContentStatus(contentId, "READY_TO_RENDER").catch(() => undefined);
    await enqueueJob({ type: "RENDER_VIDEO", workspaceId: c.workspaceId, payload: { contentId, force: true, requestedBy: user.id }, origin: "HUMAN", idempotencyKey: `rerender:${contentId}:${Date.now()}` });
    refresh(slug, contentId);
    return null;
  }, "Render queued on the local worker");
}

/** Full creative regeneration (new script + VideoSpec) with optional human feedback. */
export async function regenerateAction(contentId: string, feedback?: string | null) {
  return run(async () => {
    const { user, c, slug } = await owned(contentId);
    if (["PUBLISHED", "PUBLISHING"].includes(c.status)) throw new AppError({ code: "PUBLISHED", userMessage: "Published content cannot be regenerated. Duplicate it as new content instead." });
    if (c.status === "SCHEDULED") await unscheduleContent(contentId, user.id);
    await withUser(user.id, (tx) => tx.update(contents).set({ status: "GENERATING", failureReason: null }).where(eq(contents.id, contentId)));
    await enqueueJob({ type: "CREATIVE_GENERATE", workspaceId: c.workspaceId, payload: { contentId, feedback: feedback?.slice(0, 1000) || "Human requested a new version.", regenerate: true }, origin: "HUMAN", idempotencyKey: `regen:${contentId}:${Date.now()}` });
    refresh(slug, contentId);
    return null;
  }, "Regenerating — the Creative agent is writing a new version");
}

export async function regenerateHookAction(contentId: string) {
  return run(async () => {
    const { user, slug } = await owned(contentId);
    await regenerateContentHook(contentId, user.id);
    refresh(slug, contentId);
    return null;
  }, "New hook written — re-render queued");
}

export async function saveSpecAction(contentId: string, spec: unknown) {
  return run(async () => {
    const { user, slug } = await owned(contentId);
    const id = await saveEditedSpec(contentId, spec, user.id);
    refresh(slug, contentId);
    return { specId: id };
  }, "Saved as a new version — re-render queued");
}

export async function retryPostAction(socialPostId: string) {
  return run(async () => {
    const user = await requireUser();
    const [p] = await withUser(user.id, (tx) => tx.select({ id: socialPosts.id, ws: socialPosts.workspaceId, contentId: socialPosts.contentId }).from(socialPosts).where(eq(socialPosts.id, socialPostId)).limit(1));
    if (!p) throw new AuthorizationError("Post not found.");
    await retryPost(socialPostId, user.id);
    kick([p.ws], { maxJobs: 5, timeoutMs: 60_000 });
    revalidatePath("/", "layout");
    return null;
  }, "Retrying publication");
}
