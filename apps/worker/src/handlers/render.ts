import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  currentSpec,
  db as coreDb,
  emitEvent,
  enqueueJob,
  isDemo,
  notify,
  policy,
  recordActivity,
  setAgentStatus,
  setContentStatus,
  storage,
  type HandlerContext,
  type JobRow,
} from "@revenueos/core";
import { and, brandAssets, contents, eq, sql, videoRenders, workspaces } from "@revenueos/database";
import { AppError, PLATFORM_CAPABILITIES, SIMILARITY_THRESHOLD, type Platform } from "@revenueos/shared";
import { extractFrames, generateAmbientTrack, renderVideo, runContentQA, validateVideo } from "@revenueos/video-engine/render";
import { loadWorkerConfig } from "../config";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "video/mp4": "mp4", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/mp4": "m4a" };

let rendersToday = { date: "", count: 0 };
export function renderStats() {
  return rendersToday;
}

/**
 * RENDER_VIDEO on the local machine: VideoSpec → Remotion → MP4 + thumbnail →
 * ffprobe validation → frame snapshots → Content QA → READY (or FAILED with a
 * human-readable reason). Files are stored as renders/<workspace>/<yyyy-mm>/<content>.mp4.
 */
export async function renderHandler(job: JobRow, ctx: HandlerContext): Promise<Record<string, unknown>> {
  const cfg = loadWorkerConfig();
  const contentId = String(job.payload.contentId);
  const attachOnly = Boolean(job.payload.attachOnly);
  const [content] = await coreDb().select().from(contents).where(eq(contents.id, contentId)).limit(1);
  if (!content) return { skipped: "content not found" };
  const [ws] = await coreDb().select().from(workspaces).where(eq(workspaces.id, content.workspaceId)).limit(1);
  if (!ws) return { skipped: "workspace not found" };
  if (job.workspaceId && job.workspaceId !== ws.id) throw new AppError({ code: "WORKSPACE_MISMATCH", userMessage: "Render job workspace mismatch.", retryable: false });
  const renderable = ["READY_TO_RENDER", "RENDERING", "FAILED"].includes(content.status) || Boolean(job.payload.force && ["RENDERED", "READY", "SCHEDULED"].includes(content.status));
  if (!attachOnly && !renderable) return { skipped: `content is ${content.status}` };
  if (!attachOnly && policy(ws, "renderVideos", ctx.origin) !== "ALLOW") {
    await notify({ workspaceId: ws.id, type: "APPROVAL_REQUIRED", severity: "INFO", title: `Render waiting for approval — Content #${content.number}`, body: "Rendering is not automatic in the current operating mode. Click Re-render in Content Studio.", link: `/w/${ws.slug}/content/${content.id}`, dedupeKey: `render_approval:${content.id}` });
    return { skipped: "render not allowed by operating mode" };
  }
  const cur = await currentSpec(contentId);
  if (!cur) throw new AppError({ code: "NO_SPEC", userMessage: "This content has no VideoSpec to render.", retryable: false });
  const spec = cur.spec;

  // Resolve brand assets (only from THIS workspace) into the local cache.
  const assetRoot = join(cfg.cacheDir, "assets", ws.id);
  await mkdir(assetRoot, { recursive: true });
  const assetFiles: Record<string, string> = {};
  const missingAssets: string[] = [];
  for (const ref of spec.assets) {
    const [asset] = await coreDb().select().from(brandAssets).where(and(eq(brandAssets.id, ref.id), eq(brandAssets.workspaceId, ws.id))).limit(1);
    if (!asset) {
      missingAssets.push(ref.id);
      continue;
    }
    const file = `${asset.id}.${EXT[asset.mimeType] ?? "bin"}`;
    if (!existsSync(join(assetRoot, file))) {
      try {
        await writeFile(join(assetRoot, file), await storage().get(asset.storageKey));
      } catch {
        missingAssets.push(ref.id);
        continue;
      }
    }
    assetFiles[asset.id] = file;
  }
  let soundtrackFile: string | null = null;
  if (spec.soundtrack?.generated && !spec.soundtrack.assetId && spec.soundtrack.mood !== "none") {
    soundtrackFile = `soundtrack-${cur.id}.wav`;
    if (!existsSync(join(assetRoot, soundtrackFile))) await generateAmbientTrack(join(assetRoot, soundtrackFile), spec.duration, spec.soundtrack.mood, content.number);
  }

  const month = new Date().toISOString().slice(0, 7);
  const outDir = join(cfg.renderDir, ws.id, month);
  const outFile = join(outDir, `${contentId}.mp4`);
  const thumbFile = join(outDir, `${contentId}.jpg`);
  const [render] = await coreDb()
    .insert(videoRenders)
    .values({ workspaceId: ws.id, contentId, videoSpecId: cur.id, status: "RENDERING", workerId: cfg.workerId, startedAt: new Date(), attempt: job.attempts })
    .returning();
  if (!attachOnly) {
    if (content.status === "FAILED") await setContentStatus(contentId, "READY_TO_RENDER");
    if (content.status !== "RENDERING") await setContentStatus(contentId, "RENDERING");
  }
  await setAgentStatus(ws.id, "CREATIVE", "WORKING", { task: `Rendering Content #${content.number}`, jobId: job.id });
  await recordActivity({ workspaceId: ws.id, type: "RENDER_STARTED", title: `Worker started render of Content #${content.number} (${spec.templateId}, ${spec.duration}s)`, actorType: "WORKER", actorId: cfg.workerId, entityType: "content", entityId: contentId });

  let lastLease = Date.now();
  try {
    const scale = Number(process.env.REVENUEOS_RENDER_SCALE ?? 1);
    const result = await renderVideo({
      spec,
      assetRoot,
      assetFiles,
      soundtrackFile,
      outFile,
      thumbnailFile: thumbFile,
      cacheDir: join(cfg.cacheDir, "remotion-bundle"),
      concurrency: null,
      scale: scale > 0 && scale <= 1 ? scale : 1,
      timeoutMs: 180_000,
      signal: ctx.signal,
      onProgress: () => {
        if (Date.now() - lastLease > 60_000) {
          lastLease = Date.now();
          void ctx.extendLease(1800);
        }
      },
    });
    const probe = result.probe;
    const expectW = Math.round(spec.width * (scale > 0 && scale <= 1 ? scale : 1));
    const expectH = Math.round(spec.height * (scale > 0 && scale <= 1 ? scale : 1));
    const platforms = (content.targetPlatforms.length ? content.targetPlatforms : ws.targetPlatforms) as Platform[];
    const maxSize = Math.min(...platforms.map((p) => PLATFORM_CAPABILITIES[p].maxFileSizeBytes));
    const validation = await validateVideo(outFile, probe, { width: expectW - (expectW % 2), height: expectH - (expectH % 2), durationSec: spec.duration, maxFileSizeBytes: maxSize, requireAudio: true }, { deepIntegrity: true });
    const frames = await extractFrames(outFile, spec.duration, join(cfg.cacheDir, "frames", render!.id));
    const qa = runContentQA({ spec, platforms, copy: content.copy, validation, frames, similarity: { score: content.similarityScore ?? 0, threshold: SIMILARITY_THRESHOLD }, missingAssets });

    // Thumbnail + QA frames go to storage (small files) so the dashboard can show them anywhere.
    const st = storage();
    const thumbKey = `workspaces/${ws.id}/thumbs/${contentId}-${render!.id}.jpg`;
    if (result.thumbnailFile) await st.put(thumbKey, await readFile(result.thumbnailFile), "image/jpeg");
    const frameKeys: string[] = [];
    for (const f of frames) {
      if (!existsSync(f.path)) continue;
      const key = `workspaces/${ws.id}/frames/${render!.id}/${f.label.replace("%", "pct")}.jpg`;
      await st.put(key, await readFile(f.path), "image/jpeg");
      frameKeys.push(key);
    }
    // Local storage (single machine): keep a copy in storage for previews/publishing. Remote storage: only on demand.
    let previewKey: string | null = null;
    let deliveryKey: string | null = null;
    if (!st.remote || cfg.uploadPreviews || isDemo(ws)) {
      previewKey = `workspaces/${ws.id}/renders/${contentId}-${render!.id}.mp4`;
      if (!st.remote || cfg.uploadPreviews) {
        await st.put(previewKey, await readFile(outFile), "video/mp4");
        if (!st.remote) deliveryKey = previewKey;
      } else previewKey = null;
    }
    const technicalFail = validation.some((v) => v.status === "fail");
    await coreDb()
      .update(videoRenders)
      .set({
        status: technicalFail ? "FAILED" : "COMPLETED",
        localPath: outFile,
        fileSize: probe.fileSize,
        durationMs: probe.durationSec ? Math.round(probe.durationSec * 1000) : null,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        hasAudio: probe.hasAudio,
        thumbnailKey: thumbKey,
        previewKey,
        deliveryKey,
        deliveredAt: deliveryKey ? new Date() : null,
        frameKeys,
        validation: { checks: validation, frames: frames.map((f) => ({ label: f.label, mean: f.mean, stddev: f.stddev, blank: f.blank })) },
        renderMs: result.renderMs,
        completedAt: new Date(),
        error: technicalFail ? validation.filter((v) => v.status === "fail").map((v) => v.message).join("; ") : null,
      })
      .where(eq(videoRenders.id, render!.id));
    if (technicalFail) {
      throw new AppError({ code: "RENDER_INVALID", userMessage: `The rendered file failed validation: ${validation.filter((v) => v.status === "fail").map((v) => v.message).join("; ")}`, retryable: true });
    }
    const today = new Date().toISOString().slice(0, 10);
    rendersToday = rendersToday.date === today ? { date: today, count: rendersToday.count + 1 } : { date: today, count: 1 };
    if (attachOnly) {
      await setAgentStatus(ws.id, "CREATIVE", "IDLE");
      return { attached: true, renderMs: result.renderMs };
    }
    await setContentStatus(contentId, "RENDERED");
    const contentFail = qa.status === "FAILED";
    if (contentFail) {
      const reasons = qa.checks.filter((c) => c.status === "fail").map((c) => c.message);
      if (ctx.origin !== "HUMAN" && content.regenerationCount < 2 && !reasons.some((r) => /Missing assets/.test(r))) {
        // Automatic creative repair: regenerate the spec with QA feedback (bounded).
        await coreDb().update(contents).set({ status: "GENERATING", qaStatus: "FAILED", qaReport: { checks: qa.checks, checkedAt: new Date().toISOString() }, regenerationCount: sql`${contents.regenerationCount} + 1` }).where(eq(contents.id, contentId));
        await enqueueJob({ type: "CREATIVE_GENERATE", workspaceId: ws.id, payload: { contentId, feedback: `Quality check failed: ${reasons.join("; ")}` }, origin: ctx.origin, idempotencyKey: `qa_regen:${contentId}:${render!.id}` });
        await recordActivity({ workspaceId: ws.id, type: "QA_FAILED", title: `QA failed for Content #${content.number} — regenerating (${reasons[0]})`, agentRole: "CREATIVE", entityType: "content", entityId: contentId });
        return { qa: "FAILED", regenerating: true };
      }
      await setContentStatus(contentId, "FAILED", { qaStatus: "FAILED", qaReport: { checks: qa.checks, checkedAt: new Date().toISOString() }, failureReason: `QA: ${reasons.join("; ")}` });
      await notify({ workspaceId: ws.id, type: "JOB_FAILED", severity: "WARNING", title: `Content #${content.number} needs review`, body: reasons.join("; "), link: `/w/${ws.slug}/content/${contentId}`, dedupeKey: `qa_failed:${contentId}:${render!.id}` });
      return { qa: "FAILED" };
    }
    await setContentStatus(contentId, "READY", { qaStatus: qa.status === "PASSED" ? "PASSED" : "WARNINGS", qaReport: { checks: qa.checks, checkedAt: new Date().toISOString() }, failureReason: null });
    await emitEvent({ type: "RENDER_COMPLETED", workspaceId: ws.id, idempotencyKey: `render_completed:${render!.id}`, payload: { contentId, renderId: render!.id } }, coreDb(), ctx.origin);
    await recordActivity({ workspaceId: ws.id, type: "RENDER_COMPLETED", title: `Render complete: Content #${content.number} (${(result.renderMs / 1000).toFixed(1)}s, ${(probe.fileSize / 1e6).toFixed(1)} MB, QA ${qa.status})`, actorType: "WORKER", actorId: cfg.workerId, entityType: "content", entityId: contentId });
    await notify({ workspaceId: ws.id, type: "RENDER_COMPLETE", severity: "SUCCESS", title: `Render complete — Content #${content.number}`, body: spec.hook.text, link: `/w/${ws.slug}/content/${contentId}`, dedupeKey: `render_complete:${render!.id}` });
    await setAgentStatus(ws.id, "CREATIVE", "IDLE");
    return { renderId: render!.id, renderMs: result.renderMs, qa: qa.status, sizeBytes: probe.fileSize };
  } catch (e) {
    await coreDb()
      .update(videoRenders)
      .set({ status: "FAILED", error: e instanceof AppError ? e.userMessage : e instanceof Error ? e.message.slice(0, 500) : String(e), completedAt: new Date() })
      .where(and(eq(videoRenders.id, render!.id), eq(videoRenders.status, "RENDERING")));
    if (!attachOnly) {
      const [c] = await coreDb().select({ status: contents.status }).from(contents).where(eq(contents.id, contentId)).limit(1);
      if (c?.status === "RENDERING") await setContentStatus(contentId, "READY_TO_RENDER");
    }
    await setAgentStatus(ws.id, "CREATIVE", "IDLE");
    if (e instanceof AppError) throw e;
    throw new AppError({ code: "RENDER_FAILED", userMessage: `Remotion render failed: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`, retryable: true, cause: e });
  }
}

/** Final failure: keep the spec, mark the content FAILED with the reason (Retry available in the UI). */
export async function renderFinalFailure(job: JobRow, error: unknown): Promise<void> {
  const contentId = String(job.payload.contentId);
  const [c] = await coreDb().select().from(contents).where(eq(contents.id, contentId)).limit(1);
  if (!c || job.payload.attachOnly) return;
  if (["READY_TO_RENDER", "RENDERING"].includes(c.status)) {
    await coreDb().update(contents).set({ status: "FAILED", failureReason: error instanceof AppError ? error.userMessage : String(error) }).where(eq(contents.id, contentId));
  }
}
