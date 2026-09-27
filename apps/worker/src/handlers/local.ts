import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db as coreDb, notify, recordActivity, storage, type HandlerContext, type JobRow } from "@revenueos/core";
import { and, approvalRequests, brandAssets, contents, customCompositions, eq, isNotNull, isNull, videoRenders, workspaces } from "@revenueos/database";
import { AppError } from "@revenueos/shared";
import { assertPublicUrl, isPrivateAddress } from "@revenueos/shared/server";
import { locateFfmpeg, probeVideo, renderCompositionTest, runBinary, validateComposition } from "@revenueos/video-engine/render";
import type * as PlaywrightModule from "playwright-core";
import { loadWorkerConfig } from "../config";

type PlaywrightChromium = typeof PlaywrightModule.chromium;

/** PREPARE_DELIVERY: uploads the MP4 to temporary cloud storage shortly before publication (worker may go offline later). */
export async function deliveryHandler(job: JobRow): Promise<Record<string, unknown>> {
  const [render] = await coreDb().select().from(videoRenders).where(eq(videoRenders.id, String(job.payload.renderId))).limit(1);
  if (!render) return { skipped: "render not found" };
  if (render.deliveryKey && !render.deliveryDeletedAt) return { skipped: "already delivered" };
  if (!render.localPath || !existsSync(render.localPath)) {
    throw new AppError({ code: "LOCAL_FILE_MISSING", userMessage: "The rendered video file is missing on this computer. Re-render the content.", retryable: false });
  }
  const key = `delivery/${render.workspaceId}/${render.contentId}-${render.id}.mp4`;
  const data = await readFile(render.localPath);
  await storage().put(key, data, "video/mp4");
  await coreDb()
    .update(videoRenders)
    .set({ deliveryKey: key, deliveredAt: new Date(), deliveryExpiresAt: new Date(Date.now() + 72 * 3600 * 1000), deliveryDeletedAt: null })
    .where(eq(videoRenders.id, render.id));
  return { key, bytes: data.length };
}

/** CLEANUP_LOCAL_RENDERS: deletes local MP4s of PUBLISHED content older than the workspace retention. Never unpublished content. */
export async function cleanupLocalHandler(): Promise<Record<string, unknown>> {
  const rows = await coreDb()
    .select({ r: videoRenders, c: contents, w: workspaces })
    .from(videoRenders)
    .innerJoin(contents, eq(contents.id, videoRenders.contentId))
    .innerJoin(workspaces, eq(workspaces.id, videoRenders.workspaceId))
    .where(and(isNotNull(videoRenders.localPath), isNull(videoRenders.localDeletedAt), eq(contents.status, "PUBLISHED")))
    .limit(500);
  let deleted = 0;
  let freed = 0;
  for (const { r, c, w } of rows) {
    const days = w.retention.localVideoRetentionDays;
    if (days === 0 || !c.publishedAt) continue;
    if (Date.now() - c.publishedAt.getTime() < days * 24 * 3600 * 1000) continue;
    try {
      if (r.localPath && existsSync(r.localPath)) {
        freed += (await stat(r.localPath)).size;
        await rm(r.localPath, { force: true });
        await rm(r.localPath.replace(/\.mp4$/, ".jpg"), { force: true });
      }
      await coreDb().update(videoRenders).set({ localDeletedAt: new Date() }).where(eq(videoRenders.id, r.id));
      deleted++;
    } catch {
      /* try again tomorrow */
    }
  }
  return { deleted, freedBytes: freed };
}

/** PROCESS_ASSET: video brand assets get duration/dimensions and a thumbnail (FFmpeg bundled with Remotion). */
export async function processAssetHandler(job: JobRow): Promise<Record<string, unknown>> {
  const cfg = loadWorkerConfig();
  const [asset] = await coreDb().select().from(brandAssets).where(eq(brandAssets.id, String(job.payload.assetId))).limit(1);
  if (!asset) return { skipped: "asset not found" };
  const dir = join(cfg.cacheDir, "assets", asset.workspaceId);
  await mkdir(dir, { recursive: true });
  const local = join(dir, `${asset.id}.${asset.mimeType === "video/quicktime" ? "mov" : "mp4"}`);
  if (!existsSync(local)) await writeFile(local, await storage().get(asset.storageKey));
  const probe = await probeVideo(local);
  const thumb = join(dir, `${asset.id}-thumb.jpg`);
  const { ffmpeg } = locateFfmpeg();
  await runBinary(ffmpeg, ["-v", "error", "-y", "-ss", String(Math.min(1, (probe.durationSec ?? 1) / 2)), "-i", local, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", thumb], 60_000);
  let thumbnailKey: string | null = null;
  if (existsSync(thumb)) {
    thumbnailKey = `workspaces/${asset.workspaceId}/thumbs/${asset.id}.jpg`;
    await storage().put(thumbnailKey, await readFile(thumb), "image/jpeg");
  }
  await coreDb()
    .update(brandAssets)
    .set({ status: "READY", width: probe.width, height: probe.height, durationMs: probe.durationSec ? Math.round(probe.durationSec * 1000) : null, thumbnailKey })
    .where(eq(brandAssets.id, asset.id));
  return { durationSec: probe.durationSec };
}

/**
 * WEBSITE_SCREENSHOT: captures public pages with a local browser (Edge/Chrome
 * via playwright-core). Every request the page makes is checked against the
 * SSRF rules, so a site cannot make the browser reach the local network.
 */
export async function screenshotHandler(job: JobRow): Promise<Record<string, unknown>> {
  const url = String(job.payload.url);
  await assertPublicUrl(url);
  let chromium: PlaywrightChromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    throw new AppError({ code: "SCREENSHOT_UNAVAILABLE", userMessage: "Website screenshots need playwright-core on the worker (installed by setup-worker.ps1).", retryable: false });
  }
  const executablePath = process.env.SCREENSHOT_BROWSER_EXECUTABLE || process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
  const browser = await chromium.launch({ headless: true, executablePath, channel: executablePath ? undefined : process.platform === "win32" ? "msedge" : "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await page.route("**/*", async (route) => {
      try {
        const u = new URL(route.request().url());
        if (!["http:", "https:", "data:", "blob:"].includes(u.protocol)) return route.abort();
        if ((u.protocol === "http:" || u.protocol === "https:") && (u.hostname === "localhost" || isPrivateAddress(u.hostname.replace(/^\[|\]$/g, "")) === true) && /^[\d.:[\]a-f]+$/i.test(u.hostname)) return route.abort();
        if (u.protocol === "http:" || u.protocol === "https:") await assertPublicUrl(u.toString());
        return route.continue();
      } catch {
        return route.abort();
      }
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    const png = await page.screenshot({ type: "png", fullPage: false });
    const id = crypto.randomUUID();
    const key = `workspaces/${job.workspaceId}/assets/${id}.png`;
    await storage().put(key, png, "image/png");
    await coreDb().insert(brandAssets).values({ id, workspaceId: job.workspaceId!, kind: "SCREENSHOT", filename: `screenshot-${new URL(url).hostname}.png`, mimeType: "image/png", sizeBytes: png.length, storageKey: key, width: 1280, height: 800, sha256: id, description: `Screenshot of ${url}` });
    return { assetId: id };
  } finally {
    await browser.close();
  }
}

/** VALIDATE_COMPOSITION: sandbox pipeline for Claude-proposed Remotion code. Approval by a human is still required. */
export async function validateCompositionHandler(job: JobRow, ctx: HandlerContext): Promise<Record<string, unknown>> {
  const cfg = loadWorkerConfig();
  const [comp] = await coreDb().select().from(customCompositions).where(eq(customCompositions.id, String(job.payload.compositionId))).limit(1);
  if (!comp) return { skipped: "composition not found" };
  await coreDb().update(customCompositions).set({ status: "VALIDATING" }).where(eq(customCompositions.id, comp.id));
  await ctx.extendLease(900);
  const report = await validateComposition(comp.code, join(cfg.cacheDir, "sandbox"), comp.id, (dir) => renderCompositionTest(dir, { timeoutMs: 30_000 }));
  await coreDb()
    .update(customCompositions)
    .set({ status: report.ok ? "VALIDATED" : "FAILED", validationReport: report as unknown as Record<string, unknown> })
    .where(eq(customCompositions.id, comp.id));
  if (report.ok) {
    await coreDb()
      .insert(approvalRequests)
      .values({ workspaceId: comp.workspaceId, type: "CUSTOM_COMPOSITION", title: `Approve new composition "${comp.name}"`, description: "Passed static analysis, typecheck and render test in the sandbox.", payload: { compositionId: comp.id }, entityType: "custom_composition", entityId: comp.id, requestedBy: "CREATIVE" })
      .onConflictDoNothing();
    await notify({ workspaceId: comp.workspaceId, type: "APPROVAL_REQUIRED", severity: "INFO", title: `New composition ready for review: ${comp.name}`, link: null, dedupeKey: `composition:${comp.id}` });
  }
  await recordActivity({ workspaceId: comp.workspaceId, type: "COMPOSITION_VALIDATED", title: `Composition "${comp.name}" ${report.ok ? "passed" : "failed"} sandbox validation`, agentRole: "CREATIVE", entityType: "custom_composition", entityId: comp.id });
  return { ok: report.ok, issues: report.static.issues.length + report.typecheck.length };
}

