import { stat } from "node:fs/promises";
import { locateFfmpeg, runBinary } from "./ffmpeg";

export interface ProbeResult {
  exists: boolean;
  fileSize: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  pixelFormat: string | null;
  bitRate: number | null;
}

export async function probeVideo(file: string): Promise<ProbeResult> {
  let size = 0;
  try {
    size = (await stat(file)).size;
  } catch {
    return { exists: false, fileSize: 0, durationSec: null, width: null, height: null, fps: null, videoCodec: null, audioCodec: null, hasAudio: false, pixelFormat: null, bitRate: null };
  }
  const { ffprobe } = locateFfmpeg();
  const r = await runBinary(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], 60_000);
  if (r.code !== 0) throw new Error(`ffprobe failed: ${r.stderr.slice(0, 500)}`);
  const json = JSON.parse(r.stdout.toString("utf8")) as {
    streams?: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; pix_fmt?: string }[];
    format?: { duration?: string; bit_rate?: string };
  };
  const v = json.streams?.find((s) => s.codec_type === "video");
  const a = json.streams?.find((s) => s.codec_type === "audio");
  const [num, den] = (v?.r_frame_rate ?? "0/1").split("/").map(Number) as [number, number];
  return {
    exists: true,
    fileSize: size,
    durationSec: json.format?.duration ? Number(json.format.duration) : null,
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps: den ? Math.round((num / den) * 100) / 100 : null,
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    hasAudio: Boolean(a),
    pixelFormat: v?.pix_fmt ?? null,
    bitRate: json.format?.bit_rate ? Number(json.format.bit_rate) : null,
  };
}

export interface ValidationCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface VideoExpectations {
  width: number;
  height: number;
  durationSec: number;
  maxFileSizeBytes: number;
  requireAudio: boolean;
}

/** Pre-publish technical validation: existence, codec, duration, resolution, aspect ratio, size, audio, integrity. */
export async function validateVideo(file: string, probe: ProbeResult, exp: VideoExpectations, opts: { deepIntegrity?: boolean } = {}): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];
  const push = (id: string, ok: boolean, message: string, warnOnly = false) => checks.push({ id, status: ok ? "pass" : warnOnly ? "warn" : "fail", message });
  push("file_exists", probe.exists && probe.fileSize > 0, probe.exists ? `File exists (${probe.fileSize} bytes)` : "Rendered file is missing");
  if (!probe.exists) return checks;
  push("codec", probe.videoCodec === "h264", `Video codec ${probe.videoCodec ?? "unknown"} (expected h264)`);
  push("pixel_format", probe.pixelFormat === "yuv420p" || probe.pixelFormat === "yuvj420p", `Pixel format ${probe.pixelFormat ?? "unknown"} (4:2:0 required)`, true);
  const d = probe.durationSec ?? 0;
  push("duration", Math.abs(d - exp.durationSec) <= 0.5, `Duration ${d.toFixed(2)}s (expected ${exp.durationSec.toFixed(2)}s)`);
  push("resolution", probe.width === exp.width && probe.height === exp.height, `Resolution ${probe.width}x${probe.height} (expected ${exp.width}x${exp.height})`);
  const ar = probe.width && probe.height ? probe.width / probe.height : 0;
  push("aspect_ratio", Math.abs(ar - exp.width / exp.height) < 0.01, `Aspect ratio ${ar.toFixed(3)}`);
  push("file_size", probe.fileSize <= exp.maxFileSizeBytes, `File size ${(probe.fileSize / 1e6).toFixed(1)} MB (limit ${(exp.maxFileSizeBytes / 1e6).toFixed(0)} MB)`);
  push("audio", !exp.requireAudio || probe.hasAudio, probe.hasAudio ? `Audio track: ${probe.audioCodec}` : "No audio track", !exp.requireAudio);
  if (opts.deepIntegrity) {
    const { ffmpeg } = locateFfmpeg();
    const r = await runBinary(ffmpeg, ["-v", "error", "-i", file, "-an", "-c:v", "rawvideo", "-f", "null", "-"], 180_000);
    push("integrity", r.code === 0 && r.stderr.trim().length === 0, r.stderr.trim() ? `Decode errors: ${r.stderr.slice(0, 200)}` : "Decoded without errors");
  }
  return checks;
}
