import { randomBytes } from "node:crypto";
import {
  and,
  approvalRequests,
  asc,
  contents,
  eq,
  gt,
  gte,
  inArray,
  jobs,
  lt,
  postingSlots,
  socialAccounts,
  socialPosts,
  sql,
  trackedLinks,
  workspaces,
  type DbExecutor,
} from "@revenueos/database";
import {
  addLocalDays,
  AppError,
  BUFFER_IN_PROGRESS_STATUSES,
  BUFFER_READY_STATUSES,
  generateSlots,
  isPublicAppUrl,
  localDateString,
  PLATFORM_LABELS,
  startOfLocalDay,
  zonedToUtc,
  type ContentStatus,
  type Platform,
} from "@revenueos/shared";
import { getConfig } from "../config";
import { db, now } from "../deps";
import { emitEvent } from "../events";
import { enqueueJob, type JobOrigin } from "../jobs/queue";
import type { Workspace } from "../providers";
import { audit, notify, recordActivity } from "../records";
import { computeBufferNeed } from "./buffer";
import { assertContentTransition } from "./state-machines";
import { ensureSmartSlots, tunedTimeFor } from "./timing";
import { policy } from "./workspaces";

export type Content = typeof contents.$inferSelect;
export type SocialPost = typeof socialPosts.$inferSelect;

export async function getContent(id: string, exec: DbExecutor = db()): Promise<Content> {
  const rows = await exec.select().from(contents).where(eq(contents.id, id)).limit(1);
  if (!rows[0]) throw new AppError({ code: "NOT_FOUND", userMessage: "Content not found.", httpStatus: 404 });
  return rows[0];
}

export async function setContentStatus(id: string, to: ContentStatus, patch: Partial<Content> = {}, exec: DbExecutor = db()): Promise<Content> {
  const current = await getContent(id, exec);
  assertContentTransition(current.status, to);
  const [row] = await exec
    .update(contents)
    .set({ ...patch, status: to })
    .where(eq(contents.id, id))
    .returning();
  return row!;
}

/* ------------------------------ slots ------------------------------ */

/**
 * Creates posting slots for the next `days` days (idempotent). Smart mode picks the
 * business's best hours (peaks + its own results); fixed mode uses the saved times;
 * "as soon as ready" needs no slots.
 */
export async function ensureSlots(ws: Workspace, days = 3): Promise<number> {
  if (ws.postingMode === "asap") return 0;
  if (ws.postingMode === "smart") return ensureSmartSlots(ws, days);
  const slots = generateSlots({ schedule: ws.postingSchedule, timezone: ws.timezone, from: now(), days, postsPerDay: ws.postsPerDay, minLeadMinutes: 0 });
  if (slots.length === 0) return 0;
  const res = await db()
    .insert(postingSlots)
    .values(slots.map((s) => ({ workspaceId: ws.id, scheduledFor: s.scheduledFor, localDate: s.localDate, localTime: s.localTime })))
    .onConflictDoNothing()
    .returning({ id: postingSlots.id });
  return res.length;
}

export async function markMissedSlots(ws: Workspace): Promise<void> {
  await db()
    .update(postingSlots)
    .set({ status: "MISSED" })
    .where(and(eq(postingSlots.workspaceId, ws.id), eq(postingSlots.status, "OPEN"), lt(postingSlots.scheduledFor, new Date(now().getTime() - 30 * 60 * 1000))));
}

/* ------------------------------ buffer ------------------------------ */

export async function bufferState(ws: Workspace) {
  const counts = (await db().execute(sql`
    SELECT
      count(*) FILTER (WHERE status = ANY(${sql.raw(`ARRAY[${BUFFER_READY_STATUSES.map((s) => `'${s}'`).join(",")}]`)})) AS ready,
      count(*) FILTER (WHERE status = ANY(${sql.raw(`ARRAY[${BUFFER_IN_PROGRESS_STATUSES.map((s) => `'${s}'`).join(",")}]`)})) AS in_progress,
      count(*) FILTER (WHERE created_at >= ${startOfLocalDay(now(), ws.timezone)} AND created_by = 'AGENT') AS generated_today
    FROM contents WHERE workspace_id = ${ws.id}
  `)) as unknown as { ready: string; in_progress: string; generated_today: string }[];
  const pending = (await db().execute(sql`
    SELECT coalesce(sum((payload->>'count')::int), 0) AS n FROM jobs
    WHERE workspace_id = ${ws.id} AND type = 'STRATEGY_PLAN' AND status IN ('QUEUED','RUNNING','RETRYING')
  `)) as unknown as { n: string }[];
  const c = counts[0]!;
  return computeBufferNeed({
    readyOrScheduled: Number(c.ready),
    inProgress: Number(c.in_progress),
    pendingPlanned: Number(pending[0]?.n ?? 0),
    target: ws.targetReadyBuffer,
    generatedToday: Number(c.generated_today),
    maxGeneratedPerDay: ws.maxContentGeneratedPerDay,
  });
}

/**
 * Buffer analyzer: if ready+scheduled+in-progress content is below the target,
 * emits CONTENT_NEEDED with the deficit (bounded by the daily generation cap).
 */
export async function analyzeBuffer(ws: Workspace, origin: JobOrigin = "AUTOMATION"): Promise<{ requested: number; reason: string }> {
  if (policy(ws, "createStrategies", origin) !== "ALLOW" || policy(ws, "generateContent", origin) !== "ALLOW") {
    return { requested: 0, reason: "automation not allowed in this mode" };
  }
  const b = await bufferState(ws);
  if (b.toCreate <= 0) return { requested: 0, reason: b.deficit > 0 ? "daily generation limit reached" : "buffer is full" };
  const key = `content_needed:${ws.id}:${localDateString(now(), ws.timezone)}:${b.available}:${b.remainingToday}`;
  const id = await emitEvent({ type: "CONTENT_NEEDED", workspaceId: ws.id, idempotencyKey: key, payload: { count: b.toCreate, reason: `buffer ${b.available}/${ws.targetReadyBuffer}` } }, db(), origin);
  if (id) {
    await recordActivity({ workspaceId: ws.id, type: "CONTENT_NEEDED", title: `Buffer at ${b.available}/${ws.targetReadyBuffer} — requested ${b.toCreate} new content`, agentRole: "STRATEGIST" });
  }
  return { requested: id ? b.toCreate : 0, reason: id ? "requested" : "already requested" };
}

/* ------------------------------ tracked links & captions ------------------------------ */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newRefCode(len = 6): string {
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export async function createTrackedLink(ws: Workspace, c: Content, socialPostId: string | null, exec: DbExecutor = db()): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = newRefCode();
    const res = await exec
      .insert(trackedLinks)
      .values({
        workspaceId: ws.id,
        code,
        socialPostId,
        contentId: c.id,
        campaignId: c.campaignId,
        productId: c.productId,
        destinationType: ws.whatsappNumber ? "WHATSAPP" : "LANDING",
        destinationUrl: null,
      })
      .onConflictDoNothing()
      .returning({ code: trackedLinks.code });
    if (res[0]) return res[0].code;
  }
  throw new AppError({ code: "REF_CODE", userMessage: "Could not allocate a tracked link code." });
}

/** Platform caption with the tracked CTA. Each platform gets its own copy. */
/**
 * Link placed in captions. The tracked link (/r/CODE) only when the dashboard is reachable from the
 * internet; otherwise a direct WhatsApp link carrying the reference code (the lead is still attributed
 * to the video) or the website — never a localhost address in a public post.
 */
export function captionLink(ws: Pick<Workspace, "whatsappNumber" | "website"> | null, code: string): string | null {
  const appUrl = getConfig().appUrl;
  if (isPublicAppUrl(appUrl)) return `${appUrl}/r/${code}`;
  const phone = ws?.whatsappNumber?.replace(/\D/g, "");
  if (phone) return `https://wa.me/${phone}?text=${encodeURIComponent(`Olá! Vim pelo vídeo e quero saber mais (código ${code})`)}`;
  return ws?.website && /^https:\/\//.test(ws.website) ? ws.website : null;
}

export function buildCaption(c: Content, platform: Platform, code: string, ws: Pick<Workspace, "whatsappNumber" | "website"> | null = null): { caption: string; title: string | null; hashtags: string[] } {
  const link = captionLink(ws, code);
  const url = link ?? `código ${code}`;
  const copy = c.copy;
  const cta = c.cta ?? "Fale com a gente";
  switch (platform) {
    case "YOUTUBE":
      return {
        title: copy?.youtube.title ?? c.title,
        caption: `${copy?.youtube.description ?? c.title}\n\n👉 ${cta}: ${url}`,
        hashtags: (copy?.youtube.tags ?? []).map((t) => `#${t.replace(/^#/, "").replace(/\s+/g, "")}`).slice(0, 5),
      };
    case "FACEBOOK":
      return { title: null, caption: `${copy?.facebook.caption ?? c.title}\n\n👉 ${cta}: ${url}`, hashtags: [] };
    case "TIKTOK":
      return { title: null, caption: `${copy?.tiktok.caption ?? c.title} 👉 ${cta} — link na bio (código ${code})`, hashtags: copy?.tiktok.hashtags ?? [] };
    case "INSTAGRAM":
    case "MOCK":
    default:
      return { title: null, caption: `${copy?.instagram.caption ?? c.title}\n\n👉 ${cta} — link na bio (código ${code})`, hashtags: copy?.instagram.hashtags ?? [] };
  }
}

/* ------------------------------ scheduling ------------------------------ */

async function eligibleAccounts(ws: Workspace, platforms: Platform[]) {
  if (platforms.length === 0) return [];
  return db()
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.workspaceId, ws.id), eq(socialAccounts.enabled, true), inArray(socialAccounts.platform, platforms), inArray(socialAccounts.status, ["CONNECTED", "NEEDS_ACTION"])));
}

/**
 * Creates one SocialPost per target platform for which the workspace has a
 * connected account (never another workspace's account), with its own caption
 * and tracked link. Returns the created post ids.
 */
export async function createSocialPosts(ws: Workspace, c: Content, slotAt: Date, publishedBy: "AI" | "HUMAN", exec: DbExecutor = db(), opts: { tunePerNetwork?: boolean } = {}): Promise<SocialPost[]> {
  const platforms = (c.targetPlatforms.length ? c.targetPlatforms : ws.targetPlatforms) as Platform[];
  const accounts = await eligibleAccounts(ws, platforms);
  const covered = new Set(accounts.map((a) => a.platform));
  const missing = platforms.filter((p) => !covered.has(p));
  if (missing.length) {
    await notify({
      workspaceId: ws.id,
      type: "ACTION_REQUIRED",
      severity: "WARNING",
      title: `Connect ${missing.map((m) => PLATFORM_LABELS[m]).join(", ")} for ${ws.name}`,
      body: "Content is scheduled only for connected accounts. Connect the missing networks in Integrations.",
      link: `/w/${ws.slug}/connections`,
      dedupeKey: `missing_accounts:${ws.id}:${missing.sort().join(",")}:${localDateString(now(), ws.timezone)}`,
    });
  }
  const created: SocialPost[] = [];
  for (const acc of accounts) {
    // Smart mode: each network goes out at its own best moment near the slot.
    const scheduledFor = opts.tunePerNetwork ? tunedTimeFor(ws, acc.platform, slotAt) : slotAt;
    if (acc.workspaceId !== ws.id || c.workspaceId !== ws.id) {
      throw new AppError({ code: "WORKSPACE_MISMATCH", userMessage: "Safety check failed: account and content belong to different workspaces." });
    }
    const existing = await exec.select().from(socialPosts).where(and(eq(socialPosts.contentId, c.id), eq(socialPosts.socialAccountId, acc.id))).limit(1);
    if (existing[0]) {
      if (existing[0].status === "QUEUED" || existing[0].status === "FAILED" || existing[0].status === "CANCELLED") {
        const [u] = await exec.update(socialPosts).set({ scheduledFor, status: "QUEUED" }).where(eq(socialPosts.id, existing[0].id)).returning();
        created.push(u!);
      } else created.push(existing[0]);
      continue;
    }
    const code = await createTrackedLink(ws, c, null, exec);
    const cap = buildCaption(c, acc.platform, code, ws);
    const [post] = await exec
      .insert(socialPosts)
      .values({
        workspaceId: ws.id,
        contentId: c.id,
        socialAccountId: acc.id,
        platform: acc.platform,
        status: "QUEUED",
        scheduledFor,
        caption: cap.caption,
        hashtags: cap.hashtags,
        title: cap.title,
        publishMode: "DIRECT",
        aiLabel: true,
        idempotencyKey: `post:${c.id}:${acc.id}`,
        publishedBy,
        isDemo: acc.isDemo,
        trackedLinkCode: code,
      })
      .returning();
    await exec.update(trackedLinks).set({ socialPostId: post!.id }).where(eq(trackedLinks.code, code));
    created.push(post!);
  }
  return created;
}

export async function enqueuePublishJobs(ws: Workspace, posts: SocialPost[], origin: JobOrigin, exec: DbExecutor = db()): Promise<void> {
  for (const p of posts) {
    if (p.status !== "QUEUED") continue;
    await enqueueJob(
      {
        type: "PUBLISH_POST",
        workspaceId: ws.id,
        payload: { socialPostId: p.id },
        origin,
        scheduledAt: p.scheduledFor ?? now(),
        idempotencyKey: `publish:${p.id}:${(p.scheduledFor ?? now()).getTime()}`,
      },
      exec,
    );
  }
}

/**
 * "As soon as it is ready": a couple of minutes from now, at least 30 minutes away from
 * other scheduled videos and within the daily publication cap (otherwise null → next slot).
 */
async function asapTime(ws: Workspace): Promise<Date | null> {
  let at = new Date(now().getTime() + 2 * 60_000);
  for (let i = 0; i < 48 && (await hasScheduledNear(ws, at, MIN_POST_GAP_MIN)); i++) at = new Date(at.getTime() + MIN_POST_GAP_MIN * 60_000);
  if ((await scheduledCountForDay(ws, at)) >= ws.maxContentPublishedPerDay) return null;
  return at;
}

/** Minimum distance between two videos of the same business. */
const MIN_POST_GAP_MIN = 30;

async function hasScheduledNear(ws: Workspace, at: Date, minutes: number): Promise<boolean> {
  const [row] = await db()
    .select({ n: sql<number>`count(*)` })
    .from(contents)
    .where(
      and(
        eq(contents.workspaceId, ws.id),
        inArray(contents.status, ["SCHEDULED", "PUBLISHING", "PUBLISHED"]),
        gt(contents.scheduledFor, new Date(at.getTime() - minutes * 60_000)),
        lt(contents.scheduledFor, new Date(at.getTime() + minutes * 60_000)),
      ),
    );
  return Number(row?.n ?? 0) > 0;
}

/** Videos already going out on the local day of `at` (slot-based and "as soon as ready" alike). */
async function scheduledCountForDay(ws: Workspace, at: Date): Promise<number> {
  const day = localDateString(at, ws.timezone);
  const dayStart = startOfLocalDay(at, ws.timezone);
  const dayEnd = zonedToUtc(addLocalDays(day, 1), "00:00", ws.timezone);
  const [row] = await db()
    .select({ n: sql<number>`count(*)` })
    .from(contents)
    .where(and(eq(contents.workspaceId, ws.id), inArray(contents.status, ["SCHEDULED", "PUBLISHING", "PUBLISHED"]), gte(contents.scheduledFor, dayStart), lt(contents.scheduledFor, dayEnd)));
  return Number(row?.n ?? 0);
}

/**
 * Scheduler: assigns a READY content to the earliest open future slot
 * (respecting max publications/day), creates its social posts and either
 * enqueues timed PUBLISH_POST jobs (AUTOPILOT) or asks for approval (ASSISTED).
 */
export async function scheduleContent(contentId: string, origin: JobOrigin, opts: { at?: Date | null; userId?: string | null } = {}): Promise<{ scheduled: boolean; reason: string; scheduledFor?: Date }> {
  const c = await getContent(contentId);
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, c.workspaceId)).limit(1);
  if (!ws) throw new AppError({ code: "NOT_FOUND", userMessage: "Workspace not found." });
  if (c.status !== "READY" && c.status !== "SCHEDULED") return { scheduled: false, reason: `content is ${c.status}` };
  if (c.qaStatus === "FAILED" && origin !== "HUMAN") return { scheduled: false, reason: "QA failed" };
  const decision = policy(ws, "scheduleContent", origin);
  if (decision === "DENY") return { scheduled: false, reason: "scheduling not allowed by operating mode/permissions" };

  let slotId: string | null = null;
  let at = opts.at ?? null;
  const fromSlot = !at;
  if (!at && c.status !== "SCHEDULED" && (ws.postingMode === "asap" || c.publishAsap)) {
    at = await asapTime(ws);
  }
  if (!at) {
    if (c.status === "SCHEDULED" && c.scheduledFor) return { scheduled: true, reason: "already scheduled", scheduledFor: c.scheduledFor };
    await ensureSlots(ws);
    const open = await db()
      .select()
      .from(postingSlots)
      .where(and(eq(postingSlots.workspaceId, ws.id), eq(postingSlots.status, "OPEN"), gt(postingSlots.scheduledFor, new Date(now().getTime() + 5 * 60 * 1000))))
      .orderBy(asc(postingSlots.scheduledFor))
      .limit(10);
    for (const s of open) {
      if ((await scheduledCountForDay(ws, s.scheduledFor)) >= ws.maxContentPublishedPerDay) continue;
      if (await hasScheduledNear(ws, s.scheduledFor, MIN_POST_GAP_MIN)) continue;
      const claimed = await db()
        .update(postingSlots)
        .set({ status: "FILLED", contentId: c.id })
        .where(and(eq(postingSlots.id, s.id), eq(postingSlots.status, "OPEN")))
        .returning({ id: postingSlots.id });
      if (claimed[0]) {
        slotId = s.id;
        at = s.scheduledFor;
        break;
      }
    }
    if (!at) return { scheduled: false, reason: "no open slot in the next days" };
  }

  const publishDecision = policy(ws, "publishContent", origin);
  await db().transaction(async (tx) => {
    const fresh = await getContent(c.id, tx);
    if (fresh.status === "READY") assertContentTransition("READY", "SCHEDULED");
    await tx
      .update(contents)
      .set({
        status: "SCHEDULED",
        scheduledFor: at,
        slotId: slotId ?? fresh.slotId,
        approvalStatus: publishDecision === "APPROVAL" && fresh.approvalStatus !== "APPROVED" ? "PENDING" : fresh.approvalStatus === "PENDING" ? "PENDING" : fresh.approvalStatus,
      })
      .where(eq(contents.id, c.id));
    const posts = await createSocialPosts(ws, { ...fresh, scheduledFor: at }, at!, origin === "HUMAN" ? "HUMAN" : "AI", tx, { tunePerNetwork: fromSlot && slotId !== null && ws.postingMode === "smart" });
    const approved = fresh.approvalStatus === "APPROVED" || publishDecision === "ALLOW";
    if (approved) await enqueuePublishJobs(ws, posts, origin, tx);
    else {
      await tx
        .insert(approvalRequests)
        .values({
          workspaceId: ws.id,
          type: "PUBLISH_CONTENT",
          title: `Approve publication: ${fresh.title}`,
          description: `Scheduled for ${at!.toISOString()} on ${posts.map((p) => PLATFORM_LABELS[p.platform]).join(", ") || "no connected networks"}.`,
          payload: { contentId: fresh.id, scheduledFor: at!.toISOString() },
          entityType: "content",
          entityId: fresh.id,
          requestedBy: "GROWTH",
        })
        .onConflictDoNothing();
      await notify(
        {
          workspaceId: ws.id,
          type: "APPROVAL_REQUIRED",
          severity: "INFO",
          title: `Approval needed: ${fresh.title}`,
          body: "A video is ready and scheduled. Review and approve it to publish.",
          link: `/w/${ws.slug}/content/${fresh.id}`,
          dedupeKey: `approval:publish:${fresh.id}`,
        },
        tx,
      );
    }
    await emitEvent({ type: "POST_SCHEDULED", workspaceId: ws.id, idempotencyKey: `post_scheduled:${fresh.id}:${at!.getTime()}`, payload: { contentId: fresh.id, at: at!.toISOString() } }, tx);
    await recordActivity(
      {
        workspaceId: ws.id,
        type: "POST_SCHEDULED",
        title: `Scheduled Content #${fresh.number} for ${new Intl.DateTimeFormat("pt-BR", { timeZone: ws.timezone, dateStyle: "short", timeStyle: "short" }).format(at!)} (${posts.map((p) => PLATFORM_LABELS[p.platform]).join(", ")})${approved ? "" : " — awaiting approval"}`,
        agentRole: origin === "HUMAN" ? null : "GROWTH",
        actorType: origin === "HUMAN" ? "USER" : "AGENT",
        actorId: opts.userId ?? null,
        entityType: "content",
        entityId: fresh.id,
      },
      tx,
    );
  });
  return { scheduled: true, reason: "scheduled", scheduledFor: at! };
}

/** Human approval of a scheduled/ready content: enqueues its publish jobs. */
export async function approveContent(contentId: string, userId: string): Promise<void> {
  const c = await getContent(contentId);
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, c.workspaceId)).limit(1);
  await db().update(contents).set({ approvalStatus: "APPROVED", approvedBy: userId, approvedAt: now() }).where(eq(contents.id, contentId));
  await db()
    .update(approvalRequests)
    .set({ status: "APPROVED", decidedBy: userId, decidedAt: now() })
    .where(and(eq(approvalRequests.entityId, contentId), eq(approvalRequests.type, "PUBLISH_CONTENT"), eq(approvalRequests.status, "PENDING")));
  if (c.status === "SCHEDULED") {
    const posts = await db().select().from(socialPosts).where(eq(socialPosts.contentId, contentId));
    await enqueuePublishJobs(ws!, posts, "HUMAN");
  } else if (c.status === "READY") {
    await scheduleContent(contentId, "HUMAN", { userId });
  }
  await audit({ workspaceId: c.workspaceId, actorType: "USER", actorId: userId, action: "content.approve", entityType: "content", entityId: contentId });
  await recordActivity({ workspaceId: c.workspaceId, type: "CONTENT_APPROVED", title: `Content #${c.number} approved for publication`, actorType: "USER", actorId: userId, entityType: "content", entityId: contentId });
}

/** Calendar drag-and-drop: moves a scheduled content (and its queued posts/jobs) to a new time. */
export async function rescheduleContent(contentId: string, at: Date, userId: string): Promise<void> {
  const c = await getContent(contentId);
  if (!["SCHEDULED", "READY"].includes(c.status)) throw new AppError({ code: "INVALID_STATE", userMessage: `Only ready or scheduled content can be rescheduled (current: ${c.status}).` });
  if (at.getTime() < now().getTime() + 60_000) throw new AppError({ code: "PAST_TIME", userMessage: "Choose a time in the future." });
  await db()
    .update(jobs)
    .set({ status: "CANCELLED", lastError: "Rescheduled by user", completedAt: now() })
    .where(and(eq(jobs.type, "PUBLISH_POST"), inArray(jobs.status, ["QUEUED", "RETRYING"]), sql`${jobs.payload}->>'socialPostId' IN (SELECT id::text FROM social_posts WHERE content_id = ${contentId})`));
  if (c.slotId) await db().update(postingSlots).set({ status: "OPEN", contentId: null }).where(and(eq(postingSlots.id, c.slotId), eq(postingSlots.status, "FILLED")));
  await db().update(contents).set({ slotId: null }).where(eq(contents.id, contentId));
  if (c.status === "SCHEDULED") await db().update(contents).set({ status: "READY" }).where(eq(contents.id, contentId));
  await scheduleContent(contentId, "HUMAN", { at, userId });
  await audit({ workspaceId: c.workspaceId, actorType: "USER", actorId: userId, action: "content.reschedule", entityType: "content", entityId: contentId, details: { at: at.toISOString() } });
}

export async function unscheduleContent(contentId: string, userId: string): Promise<void> {
  const c = await getContent(contentId);
  if (c.status !== "SCHEDULED") return;
  await db()
    .update(jobs)
    .set({ status: "CANCELLED", lastError: "Unscheduled by user", completedAt: now() })
    .where(and(eq(jobs.type, "PUBLISH_POST"), inArray(jobs.status, ["QUEUED", "RETRYING"]), sql`${jobs.payload}->>'socialPostId' IN (SELECT id::text FROM social_posts WHERE content_id = ${contentId})`));
  await db().update(socialPosts).set({ status: "CANCELLED" }).where(and(eq(socialPosts.contentId, contentId), eq(socialPosts.status, "QUEUED")));
  if (c.slotId) await db().update(postingSlots).set({ status: "OPEN", contentId: null }).where(eq(postingSlots.id, c.slotId));
  await db().update(contents).set({ status: "READY", scheduledFor: null, slotId: null }).where(eq(contents.id, contentId));
  await audit({ workspaceId: c.workspaceId, actorType: "USER", actorId: userId, action: "content.unschedule", entityType: "content", entityId: contentId });
}

/** Publish immediately (human action from Content Detail). */
export async function publishNow(contentId: string, userId: string): Promise<void> {
  const c = await getContent(contentId);
  if (!["READY", "SCHEDULED", "FAILED"].includes(c.status)) throw new AppError({ code: "INVALID_STATE", userMessage: `Content is ${c.status}; render it before publishing.` });
  await db().update(contents).set({ approvalStatus: "APPROVED", approvedBy: userId, approvedAt: now() }).where(eq(contents.id, contentId));
  if (c.status === "SCHEDULED") {
    await rescheduleContent(contentId, new Date(now().getTime() + 90_000), userId);
  } else {
    if (c.status === "FAILED") await db().update(contents).set({ status: "READY" }).where(eq(contents.id, contentId));
    await scheduleContent(contentId, "HUMAN", { at: new Date(now().getTime() + 90_000), userId });
  }
}

export async function archiveContent(contentId: string, userId: string): Promise<void> {
  const c = await getContent(contentId);
  if (c.status === "SCHEDULED") await unscheduleContent(contentId, userId);
  await db().update(contents).set({ status: "ARCHIVED", archivedAt: now() }).where(eq(contents.id, contentId));
  await audit({ workspaceId: c.workspaceId, actorType: "USER", actorId: userId, action: "content.archive", entityType: "content", entityId: contentId });
}

/** Contents that failed QA/render/publish and still need attention (for dashboards). */
export async function failedContents(workspaceId: string) {
  return db()
    .select()
    .from(contents)
    .where(and(eq(contents.workspaceId, workspaceId), eq(contents.status, "FAILED"), gte(contents.updatedAt, new Date(now().getTime() - 7 * 24 * 3600 * 1000))));
}
