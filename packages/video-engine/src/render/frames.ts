import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { locateFfmpeg, runBinary } from "./ffmpeg";

export interface FrameStats {
  atSec: number;
  label: string;
  path: string;
  /** Mean luminance 0..255 */
  mean: number;
  /** Standard deviation of luminance — near 0 means a blank/flat frame. */
  stddev: number;
  blank: boolean;
}

const SNAPSHOTS: [string, number][] = [
  ["start", 0.02],
  ["25%", 0.25],
  ["50%", 0.5],
  ["75%", 0.75],
  ["end", 0.97],
];

async function luminanceStats(file: string, atSec: number): Promise<{ mean: number; stddev: number }> {
  const { ffmpeg } = locateFfmpeg();
  // 36x64 grayscale raw frame is plenty to detect blank/flat frames.
  const r = await runBinary(ffmpeg, ["-v", "error", "-ss", atSec.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=36:64,format=gray", "-f", "image2pipe", "-c:v", "rawvideo", "pipe:1"], 60_000);
  const buf = r.stdout;
  if (r.code !== 0 || buf.length === 0) return { mean: 0, stddev: 0 };
  let sum = 0;
  for (const b of buf) sum += b;
  const mean = sum / buf.length;
  let v = 0;
  for (const b of buf) v += (b - mean) ** 2;
  return { mean, stddev: Math.sqrt(v / buf.length) };
}

/** Extracts JPEG snapshots at start/25/50/75/end and computes blank-frame statistics. */
export async function extractFrames(file: string, durationSec: number, outDir: string): Promise<FrameStats[]> {
  await mkdir(outDir, { recursive: true });
  const { ffmpeg } = locateFfmpeg();
  const out: FrameStats[] = [];
  for (const [label, frac] of SNAPSHOTS) {
    const at = Math.max(0, Math.min(durationSec - 0.05, durationSec * frac));
    const path = join(outDir, `frame-${label.replace("%", "pct")}.jpg`);
    await runBinary(ffmpeg, ["-v", "error", "-y", "-ss", at.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", path], 60_000);
    const stats = await luminanceStats(file, at);
    out.push({ atSec: at, label, path, ...stats, blank: stats.stddev < 4 });
  }
  return out;
}
