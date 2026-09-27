/**
 * First-run dependency check for the local worker:
 *   pnpm worker:check            full check (includes a short test render)
 *   pnpm worker:check --quick    skip the test render and the AI call
 *   pnpm worker:check --json     machine-readable output (used by setup-worker.ps1)
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { configureCore, resolveAI, storage } from "@revenueos/core";
import { closeDb } from "@revenueos/database";
import { serializeError } from "@revenueos/shared";
import { env } from "@revenueos/shared/server";
import { SAMPLE_SPEC } from "@revenueos/video-engine";
import { renderVideo, validateVideo } from "@revenueos/video-engine/render";
import { loadDotEnv, loadWorkerConfig, REPO_ROOT } from "../config";
import { databaseCheck, ffmpegCheck, nodeCheck, renderDirCheck, storageCheck } from "../health";

loadDotEnv();

interface Row {
  name: string;
  ok: boolean;
  required: boolean;
  detail: string;
  fix?: string;
}

const args = new Set(process.argv.slice(2));
const quick = args.has("--quick");
const json = args.has("--json");
const rows: Row[] = [];

function add(row: Row): void {
  rows.push(row);
  if (!json) {
    const mark = row.ok ? "\x1b[32m✔\x1b[0m" : row.required ? "\x1b[31m✖\x1b[0m" : "\x1b[33m!\x1b[0m";
    process.stdout.write(`  ${mark} ${row.name.padEnd(22)} ${row.detail}\n`);
    if (!row.ok && row.fix) process.stdout.write(`    → ${row.fix}\n`);
  }
}

async function run(): Promise<void> {
  const cfg = loadWorkerConfig();
  configureCore({ runnerId: cfg.workerId, isLocalWorker: true });
  if (!json) process.stdout.write("\nRevenueOS worker — dependency check\n\n");

  const node = nodeCheck();
  add({ name: "Node.js", required: true, ...node, fix: "Install Node.js 20 LTS or newer from https://nodejs.org" });

  const depsOk = existsSync(join(REPO_ROOT, "node_modules", ".pnpm")) || existsSync(join(REPO_ROOT, "node_modules", "@remotion"));
  add({ name: "Dependencies", required: true, ok: depsOk, detail: depsOk ? "installed" : "node_modules missing", fix: "Run: pnpm install" });

  const envOk = Boolean(process.env.DATABASE_URL) && Boolean(process.env.APP_ENCRYPTION_KEY);
  add({ name: "Configuration", required: true, ok: envOk, detail: envOk ? "DATABASE_URL and APP_ENCRYPTION_KEY set" : "DATABASE_URL or APP_ENCRYPTION_KEY missing", fix: "Run scripts\\windows\\setup-worker.ps1 (Windows) or create .env from .env.example" });

  let dbOk = false;
  if (process.env.DATABASE_URL) {
    const d = await databaseCheck();
    dbOk = d.ok;
    add({ name: "Database", required: true, ...d, fix: "Check DATABASE_URL (Supabase: Project Settings → Database → Connection string) and your internet connection" });
  }

  const ff = await ffmpegCheck();
  add({ name: "FFmpeg", required: true, ...ff, fix: "Run pnpm install again (FFmpeg ships with Remotion), or set FFMPEG_PATH" });

  // Remotion's headless Chrome: downloaded once into node_modules (official Remotion mechanism).
  let browserOk = false;
  const exe = env("REMOTION_BROWSER_EXECUTABLE");
  if (exe) {
    browserOk = existsSync(exe);
    add({ name: "Render browser", required: true, ok: browserOk, detail: browserOk ? `custom: ${exe}` : `REMOTION_BROWSER_EXECUTABLE not found: ${exe}`, fix: "Remove REMOTION_BROWSER_EXECUTABLE to let Remotion download its own browser" });
  } else {
    try {
      const { ensureBrowser } = await import("@remotion/renderer");
      const status = await ensureBrowser({ logLevel: "error" });
      browserOk = true;
      add({ name: "Render browser", required: true, ok: true, detail: `Chrome Headless Shell (${status.type})` });
    } catch (e) {
      add({ name: "Render browser", required: true, ok: false, detail: serializeError(e).message, fix: "Check the internet connection (first run downloads Chrome Headless Shell ~100 MB)" });
    }
  }

  const dir = await renderDirCheck(cfg.renderDir);
  add({ name: "Render folder", required: true, ok: dir.ok, detail: `${dir.path} — ${dir.detail}`, fix: "Choose another folder in the worker panel → Settings" });

  if (!quick && browserOk && ff.ok) {
    const out = join(cfg.cacheDir, "check", "test-render.mp4");
    try {
      await mkdir(join(cfg.cacheDir, "check"), { recursive: true });
      const spec = { ...SAMPLE_SPEC, duration: 3, scenes: SAMPLE_SPEC.scenes.slice(0, 1).map((s) => ({ ...s, start: 0, duration: 3 })), captions: [], transitions: [], soundtrack: null };
      const t0 = Date.now();
      const r = await renderVideo({ spec, outFile: out, cacheDir: join(cfg.cacheDir, "remotion-bundle"), scale: 0.25, timeoutMs: 120_000 });
      const v = await validateVideo(out, r.probe, { width: Math.round(spec.width * 0.25), height: Math.round(spec.height * 0.25), durationSec: 3, maxFileSizeBytes: 50 * 1024 * 1024, requireAudio: true });
      const failed = v.filter((c) => c.status === "fail");
      add({ name: "Test render", required: true, ok: failed.length === 0, detail: failed.length ? failed.map((c) => c.message).join("; ") : `3s H.264/AAC rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s` });
    } catch (e) {
      add({ name: "Test render", required: true, ok: false, detail: serializeError(e).message, fix: "See logs; on Windows make sure no antivirus blocks node_modules\\@remotion" });
    } finally {
      await rm(join(cfg.cacheDir, "check"), { recursive: true, force: true });
    }
  }

  const st = storageCheck();
  if (dbOk && st.ok) {
    try {
      const key = `healthcheck/${cfg.workerId}-${Date.now()}.txt`;
      await storage().put(key, Buffer.from("ok"), "text/plain");
      const back = await storage().get(key);
      await storage().delete(key);
      add({ name: "Storage", required: true, ok: back.toString() === "ok", detail: `${st.detail} — write/read/delete OK` });
    } catch (e) {
      add({ name: "Storage", required: true, ok: false, detail: serializeError(e).message, fix: "Check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY or STORAGE_LOCAL_DIR" });
    }
  } else add({ name: "Storage", required: true, ok: st.ok, detail: st.detail });

  if (dbOk) {
    try {
      const ai = await resolveAI(null, "classification");
      if (quick) add({ name: "Claude", required: false, ok: true, detail: `${ai.providerId} configured (not called in --quick)` });
      else {
        const h = await ai.runtime.ai.healthCheck(ai.runtime.model.model);
        add({ name: "Claude", required: false, ok: h.ok, detail: h.ok ? `${ai.providerId} OK — ${h.message}` : h.message, fix: "Settings → AI in the dashboard (Anthropic API key or Claude Code login)" });
      }
    } catch (e) {
      add({ name: "Claude", required: false, ok: false, detail: serializeError(e).userMessage, fix: "Add an Anthropic API key in Settings → AI (demo workspaces work without it)" });
    }
  }

  try {
    const r = await fetch("https://api.anthropic.com/", { method: "HEAD", signal: AbortSignal.timeout(8000) });
    add({ name: "Internet", required: false, ok: true, detail: `reachable (HTTP ${r.status})` });
  } catch (e) {
    add({ name: "Internet", required: false, ok: false, detail: serializeError(e).message, fix: "Uploads and Claude need internet; renders work offline" });
  }

  const pkg = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8")) as { version?: string };
  const failed = rows.filter((r) => r.required && !r.ok);
  if (json) process.stdout.write(JSON.stringify({ ok: failed.length === 0, version: pkg.version ?? "0.0.0", checks: rows }, null, 2) + "\n");
  else process.stdout.write(failed.length === 0 ? "\n\x1b[32mAll required checks passed.\x1b[0m Start the worker with: pnpm worker\n\n" : `\n\x1b[31m${failed.length} required check(s) failed.\x1b[0m Fix the items marked ✖ and run this again.\n\n`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

try {
  await run();
} catch (e) {
  process.stderr.write(`Check crashed: ${serializeError(e).message}\n`);
  process.exitCode = 1;
} finally {
  await closeDb().catch(() => undefined);
}
