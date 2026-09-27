import { accessSync, constants, mkdirSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { getAISettings, getConfig, integrationSecret, db as coreDb } from "@revenueos/core";
import { sql } from "@revenueos/database";
import { ffmpegVersion, locateFfmpeg } from "@revenueos/video-engine/render";
import type { WorkerConfig } from "./config";

export interface CheckResult {
  ok: boolean;
  detail: string;
}

export interface WorkerHealth {
  checkedAt: string;
  node: CheckResult;
  database: CheckResult;
  ffmpeg: CheckResult;
  renderDir: CheckResult & { path: string; freeBytes: number | null };
  ai: CheckResult & { provider: string };
  storage: CheckResult & { driver: string };
}

export function nodeCheck(): CheckResult {
  const major = Number(process.versions.node.split(".")[0]);
  return { ok: major >= 20, detail: major >= 20 ? `Node ${process.versions.node}` : `Node ${process.versions.node} — version 20 or newer is required` };
}

export async function databaseCheck(): Promise<CheckResult> {
  const t = Date.now();
  try {
    await coreDb().execute(sql`select 1`);
    return { ok: true, detail: `connected (${Date.now() - t} ms)` };
  } catch (e) {
    return { ok: false, detail: `cannot reach the database: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function ffmpegCheck(): Promise<CheckResult> {
  try {
    locateFfmpeg();
    const v = ffmpegVersion();
    const version = v.version?.match(/ffmpeg version (\S+)/)?.[1] ?? v.version ?? "unknown";
    return { ok: v.ok, detail: v.ok ? `FFmpeg ${version} (${v.source})` : `FFmpeg found (${v.source}) but did not run` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function renderDirCheck(dir: string): Promise<CheckResult & { path: string; freeBytes: number | null }> {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    const s = await statfs(dir);
    const free = Number(s.bavail) * Number(s.bsize);
    const lowSpace = free < 2 * 1024 ** 3;
    return { ok: !lowSpace, path: dir, freeBytes: free, detail: lowSpace ? `only ${(free / 1024 ** 3).toFixed(1)} GB free — renders need space` : `${(free / 1024 ** 3).toFixed(1)} GB free` };
  } catch (e) {
    return { ok: false, path: dir, freeBytes: null, detail: `not writable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Cheap AI check used by the heartbeat: only verifies configuration (the CLI's `check` does a real call). */
export async function aiConfigCheck(): Promise<CheckResult & { provider: string }> {
  try {
    const s = await getAISettings();
    if (s.provider === "mock") return { ok: true, provider: "mock", detail: "Mock provider (demo only)" };
    if (s.provider === "claude-code-cli") return { ok: true, provider: s.provider, detail: `Claude Code CLI (${s.claudeCliPath || process.env.CLAUDE_CLI_PATH || "claude"})` };
    const configured = Boolean(await integrationSecret("anthropic", null, "API_KEY", "ANTHROPIC_API_KEY"));
    return { ok: configured, provider: s.provider, detail: configured ? "Anthropic API key configured" : "No Anthropic API key yet (demo workspaces use the mock provider) — add it in Settings → AI" };
  } catch (e) {
    return { ok: false, provider: "unknown", detail: e instanceof Error ? e.message : String(e) };
  }
}

export function storageCheck(): CheckResult & { driver: string } {
  const cfg = getConfig();
  if (cfg.storageDriver === "supabase") {
    const ok = Boolean(cfg.supabaseUrl && cfg.supabaseServiceRoleKey);
    return { ok, driver: "supabase", detail: ok ? `Supabase Storage (${cfg.supabaseBucket})` : "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" };
  }
  return { ok: true, driver: "local", detail: `Local storage at ${cfg.storageLocalDir}` };
}

export async function collectHealth(cfg: WorkerConfig): Promise<WorkerHealth> {
  const [database, ffmpeg, renderDir, ai] = await Promise.all([databaseCheck(), ffmpegCheck(), renderDirCheck(cfg.renderDir), aiConfigCheck()]);
  return { checkedAt: new Date().toISOString(), node: nodeCheck(), database, ffmpeg, renderDir, ai, storage: storageCheck() };
}
