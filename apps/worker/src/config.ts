import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDotEnv } from "@revenueos/shared/server";

export const WORKER_VERSION = "0.1.0";

export interface WorkerConfig {
  workerId: string;
  name: string;
  renderDir: string;
  cacheDir: string;
  renderConcurrency: number;
  aiConcurrency: number;
  ioConcurrency: number;
  uiPort: number;
  dashboardUrl: string;
  /** Upload a preview copy of each render to cloud storage (costs storage; off by default). */
  uploadPreviews: boolean;
  runScheduler: boolean;
  paused: boolean;
}

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function configDir(): string {
  if (process.env.REVENUEOS_WORKER_HOME) return process.env.REVENUEOS_WORKER_HOME;
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "RevenueOS");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "RevenueOS");
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "revenueos");
}

export function configPath(): string {
  return process.env.REVENUEOS_WORKER_CONFIG ?? join(configDir(), "worker.json");
}

/**
 * Default render folder. Windows: D:\RevenueOS\renders when a D: drive exists,
 * otherwise %USERPROFILE%\RevenueOS\renders. Never assumes D: exists.
 */
export function defaultRenderDir(): string {
  if (process.env.REVENUEOS_RENDER_DIR) return resolve(process.env.REVENUEOS_RENDER_DIR);
  if (process.platform === "win32") {
    try {
      if (existsSync("D:\\")) return "D:\\RevenueOS\\renders";
    } catch {
      /* ignore */
    }
    return join(homedir(), "RevenueOS", "renders");
  }
  return join(homedir(), "RevenueOS", "renders");
}

function stableWorkerId(): string {
  const h = createHash("sha256").update(`${hostname()}|${userInfo().username}|${REPO_ROOT}`).digest("hex").slice(0, 12);
  return `worker-${h}`;
}

function defaults(): WorkerConfig {
  return {
    workerId: stableWorkerId(),
    name: `${hostname()} worker`,
    renderDir: defaultRenderDir(),
    cacheDir: join(configDir(), "cache"),
    renderConcurrency: 1,
    aiConcurrency: 2,
    ioConcurrency: 4,
    uiPort: Number(process.env.WORKER_UI_PORT ?? 4417),
    dashboardUrl: process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    uploadPreviews: false,
    runScheduler: true,
    paused: false,
  };
}

let current: WorkerConfig | null = null;

export function loadWorkerConfig(): WorkerConfig {
  if (current) return current;
  const path = configPath();
  let fromFile: Partial<WorkerConfig> = {};
  if (existsSync(path)) {
    try {
      fromFile = JSON.parse(readFileSync(path, "utf8")) as Partial<WorkerConfig>;
    } catch {
      fromFile = {};
    }
  }
  current = { ...defaults(), ...fromFile };
  if (process.env.REVENUEOS_RENDER_DIR) current.renderDir = resolve(process.env.REVENUEOS_RENDER_DIR);
  if (process.env.WORKER_RENDER_CONCURRENCY) current.renderConcurrency = Number(process.env.WORKER_RENDER_CONCURRENCY);
  if (process.env.WORKER_AI_CONCURRENCY) current.aiConcurrency = Number(process.env.WORKER_AI_CONCURRENCY);
  if (!existsSync(path)) saveWorkerConfig({});
  return current;
}

export function saveWorkerConfig(patch: Partial<WorkerConfig>): WorkerConfig {
  const next = { ...(current ?? defaults()), ...patch };
  next.renderConcurrency = Math.max(1, Math.min(4, Math.round(next.renderConcurrency)));
  next.aiConcurrency = Math.max(1, Math.min(8, Math.round(next.aiConcurrency)));
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf8");
  current = next;
  return next;
}

/** Loads the repo .env (and .env.local) without overriding real env vars. */
export function loadDotEnv(): void {
  const files = process.env.REVENUEOS_ENV_FILE ? [resolve(process.env.REVENUEOS_ENV_FILE), join(REPO_ROOT, ".env.worker")] : [".env", ".env.local", ".env.worker"].map((f) => join(REPO_ROOT, f));
  for (const p of files) {
    if (!existsSync(p)) continue;
    for (const [k, v] of Object.entries(parseDotEnv(readFileSync(p, "utf8")))) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}

/** Per-process token for the local control panel (protects local actions from other websites). */
export const UI_TOKEN = randomBytes(18).toString("base64url");
