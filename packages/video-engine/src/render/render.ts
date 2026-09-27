import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { makeCancelSignal, renderMedia, renderStill, selectComposition, type ChromiumOptions } from "@remotion/renderer";
import type { VideoSpec } from "@revenueos/shared/video-spec";
import { COMPOSITION_ID } from "../remotion/Root";
import type { RevenueOSVideoProps } from "../Video";
import { startAssetServer } from "./asset-server";
import { getBundle } from "./bundle";
import { probeVideo, type ProbeResult } from "./probe";

export interface RenderVideoOptions {
  spec: VideoSpec;
  /** Directory containing local copies of the brand assets used by the spec. */
  assetRoot?: string | null;
  /** asset id → path relative to assetRoot. */
  assetFiles?: Record<string, string>;
  /** Optional soundtrack file (relative to assetRoot), e.g. a generated royalty-free pad. */
  soundtrackFile?: string | null;
  outFile: string;
  thumbnailFile?: string | null;
  cacheDir: string;
  concurrency?: number | null;
  /** Render scale (1 = full resolution). Lower only for tests/previews. */
  scale?: number;
  browserExecutable?: string | null;
  timeoutMs?: number;
  onProgress?: (p: { stage: "bundle" | "render" | "thumbnail"; progress: number }) => void;
  signal?: AbortSignal;
}

export interface RenderVideoResult {
  outFile: string;
  thumbnailFile: string | null;
  renderMs: number;
  probe: ProbeResult;
}

function chromiumOptions(): ChromiumOptions {
  const gl = process.env.REMOTION_GL as ChromiumOptions["gl"] | undefined;
  return { gl: gl ?? null, enableMultiProcessOnLinux: true };
}

/** Frame used for the thumbnail: late in the hook scene, when the headline is fully visible. */
export function thumbnailFrame(spec: VideoSpec): number {
  const first = spec.scenes[0];
  const t = first ? Math.min(first.start + first.duration * 0.7, first.start + 1.6) : 1;
  return Math.max(0, Math.min(Math.round(t * spec.fps), Math.round(spec.duration * spec.fps) - 1));
}

/**
 * Renders a VideoSpec to MP4 (H.264 + AAC, yuv420p) with Remotion, plus a JPEG
 * thumbnail, then probes the result. Runs entirely on the local machine.
 */
export async function renderVideo(opts: RenderVideoOptions): Promise<RenderVideoResult> {
  const started = Date.now();
  const serveUrl = await getBundle({ cacheDir: opts.cacheDir, onProgress: (p) => opts.onProgress?.({ stage: "bundle", progress: p / 100 }) });
  const server = opts.assetRoot ? await startAssetServer(opts.assetRoot) : null;
  const { cancelSignal, cancel } = makeCancelSignal();
  const onAbort = () => cancel();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    const assets: Record<string, string> = {};
    if (server) {
      for (const [id, rel] of Object.entries(opts.assetFiles ?? {})) assets[id] = `${server.baseUrl}/${rel.split(/[\\/]/).map(encodeURIComponent).join("/")}`;
      if (opts.soundtrackFile) assets.__soundtrack = `${server.baseUrl}/${opts.soundtrackFile.split(/[\\/]/).map(encodeURIComponent).join("/")}`;
    }
    const inputProps: RevenueOSVideoProps = { spec: opts.spec, assets };
    const browserExecutable = opts.browserExecutable ?? process.env.REMOTION_BROWSER_EXECUTABLE ?? null;
    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps,
      browserExecutable,
      chromiumOptions: chromiumOptions(),
      timeoutInMilliseconds: 60_000,
      logLevel: "error",
    });
    await mkdir(dirname(opts.outFile), { recursive: true });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      enforceAudioTrack: true,
      crf: 20,
      outputLocation: opts.outFile,
      inputProps,
      concurrency: opts.concurrency ?? null,
      scale: opts.scale ?? 1,
      browserExecutable,
      chromiumOptions: chromiumOptions(),
      timeoutInMilliseconds: opts.timeoutMs ?? 120_000,
      cancelSignal,
      logLevel: "error",
      onProgress: ({ progress }) => opts.onProgress?.({ stage: "render", progress }),
    });
    let thumbnailFile: string | null = null;
    if (opts.thumbnailFile) {
      await mkdir(dirname(opts.thumbnailFile), { recursive: true });
      await renderStill({
        composition,
        serveUrl,
        output: opts.thumbnailFile,
        frame: thumbnailFrame(opts.spec),
        imageFormat: "jpeg",
        jpegQuality: 82,
        inputProps: { ...inputProps, hideCaptions: true },
        scale: Math.min(opts.scale ?? 1, 0.5),
        browserExecutable,
        chromiumOptions: chromiumOptions(),
        timeoutInMilliseconds: 60_000,
        logLevel: "error",
      });
      thumbnailFile = opts.thumbnailFile;
      opts.onProgress?.({ stage: "thumbnail", progress: 1 });
    }
    const probe = await probeVideo(opts.outFile);
    return { outFile: opts.outFile, thumbnailFile, renderMs: Date.now() - started, probe };
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    await server?.close();
  }
}
