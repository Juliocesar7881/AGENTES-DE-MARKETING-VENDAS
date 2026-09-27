import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Locates ffmpeg/ffprobe. Order: FFMPEG_PATH/FFPROBE_PATH env → the binaries
 * bundled with Remotion's compositor (no separate install needed on Windows)
 * → system PATH.
 */
function compositorDir(): string | null {
  const require = createRequire(import.meta.url);
  let rendererDir: string;
  try {
    rendererDir = dirname(require.resolve("@remotion/renderer/package.json"));
  } catch {
    return null;
  }
  const r2 = createRequire(join(rendererDir, "package.json"));
  const candidates =
    process.platform === "win32"
      ? ["@remotion/compositor-win32-x64-msvc"]
      : process.platform === "darwin"
        ? [process.arch === "arm64" ? "@remotion/compositor-darwin-arm64" : "@remotion/compositor-darwin-x64"]
        : [process.arch === "arm64" ? "@remotion/compositor-linux-arm64-gnu" : "@remotion/compositor-linux-x64-gnu", "@remotion/compositor-linux-x64-musl", "@remotion/compositor-linux-arm64-musl"];
  for (const c of candidates) {
    try {
      return dirname(r2.resolve(`${c}/package.json`));
    } catch {
      /* try next */
    }
  }
  return null;
}

let cached: { ffmpeg: string; ffprobe: string; source: string } | null = null;

export function locateFfmpeg(): { ffmpeg: string; ffprobe: string; source: string } {
  if (cached) return cached;
  const exe = process.platform === "win32" ? ".exe" : "";
  if (process.env.FFMPEG_PATH && process.env.FFPROBE_PATH) {
    cached = { ffmpeg: process.env.FFMPEG_PATH, ffprobe: process.env.FFPROBE_PATH, source: "env" };
    return cached;
  }
  const dir = compositorDir();
  if (dir && existsSync(join(dir, `ffprobe${exe}`)) && existsSync(join(dir, `ffmpeg${exe}`))) {
    cached = { ffmpeg: join(dir, `ffmpeg${exe}`), ffprobe: join(dir, `ffprobe${exe}`), source: "remotion" };
    return cached;
  }
  cached = { ffmpeg: `ffmpeg${exe}`, ffprobe: `ffprobe${exe}`, source: "path" };
  return cached;
}

function libEnv(bin: string): NodeJS.ProcessEnv {
  const dir = dirname(bin);
  const key = process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
  return process.platform === "win32" ? process.env : { ...process.env, [key]: [dir, process.env[key]].filter(Boolean).join(":") };
}

/** Runs a binary with an argument ARRAY (never a shell string) and a hard timeout. */
export function runBinary(bin: string, args: string[], timeoutMs = 120_000, stdoutAsBuffer = false): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell: false, windowsHide: true, env: libEnv(bin) });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < 64_000) err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out), stderr: err });
    });
    void stdoutAsBuffer;
  });
}

export function ffmpegVersion(): { ok: boolean; version: string | null; source: string } {
  const { ffmpeg, source } = locateFfmpeg();
  try {
    const r = spawnSync(ffmpeg, ["-version"], { encoding: "utf8", timeout: 15_000, env: libEnv(ffmpeg), windowsHide: true });
    const line = (r.stdout || "").split("\n")[0] ?? "";
    return { ok: r.status === 0, version: line || null, source };
  } catch {
    return { ok: false, version: null, source };
  }
}
