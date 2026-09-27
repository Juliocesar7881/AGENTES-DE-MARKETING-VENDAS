#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { configureCore, JobRunner, registerCoreHandlers, registerHandler, runSchedulerTick } from "@revenueos/core";
import { closeDb, ensureEmbeddedPostgres } from "@revenueos/database";
import { createLogger, serializeError } from "@revenueos/shared";
import { loadDotEnv, loadWorkerConfig, REPO_ROOT, saveWorkerConfig, WORKER_VERSION, type WorkerConfig } from "./config";
import { cleanupLocalHandler, deliveryHandler, processAssetHandler, screenshotHandler, validateCompositionHandler } from "./handlers/local";
import { renderFinalFailure, renderHandler } from "./handlers/render";
import { collectHealth, type WorkerHealth } from "./health";
import { markOffline, pendingLocalJobs, sendHeartbeat, todayStats } from "./heartbeat";
import { installFileLogging } from "./logs";
import { startupStatus } from "./startup";
import { openExternal, removeRuntimeFile, RUNTIME_FILE, startPanel, type PanelStatus } from "./ui/server";

loadDotEnv();
installFileLogging();
const log = createLogger({ component: "worker" });

const POLL_MS = 2_000;
const HEARTBEAT_MS = 15_000;
const SCHEDULER_MS = 60_000;
const HEALTH_MS = 5 * 60_000;

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const cfg = loadWorkerConfig();
  const startedAt = new Date();
  configureCore({ runnerId: cfg.workerId, isLocalWorker: true });
  // Built-in database: start it when no other RevenueOS process (launcher/dashboard) has.
  await ensureEmbeddedPostgres().catch((e) => log.warn("built-in database unavailable", { error: serializeError(e).message }));

  registerCoreHandlers();
  registerHandler("RENDER_VIDEO", renderHandler, renderFinalFailure);
  registerHandler("PREPARE_DELIVERY", deliveryHandler);
  registerHandler("CLEANUP_LOCAL_RENDERS", cleanupLocalHandler);
  registerHandler("PROCESS_ASSET", processAssetHandler);
  registerHandler("WEBSITE_SCREENSHOT", screenshotHandler);
  registerHandler("VALIDATE_COMPOSITION", validateCompositionHandler);

  let paused = cfg.paused;
  let pauseChangedAt = Date.now();
  let stopping = false;
  let databaseOk = false;
  let lastError: string | null = null;
  let lastHeartbeatAt: string | null = null;
  let health: WorkerHealth | null = null;

  // Mutable so settings changes apply without restarting.
  const concurrency = { render: cfg.renderConcurrency, ai: cfg.aiConcurrency, io: cfg.ioConcurrency };
  const runner = new JobRunner({ runnerId: cfg.workerId, runners: ["LOCAL", "ANY"], concurrency, paused: () => paused || stopping });

  const setPaused = (value: boolean, at = Date.now()) => {
    if (paused === value) return;
    paused = value;
    pauseChangedAt = at;
    saveWorkerConfig({ paused: value });
    log.info(value ? "worker paused — running jobs will finish, no new jobs are taken" : "worker resumed");
  };

  let statusCache: { at: number; data: Pick<PanelStatus, "pending" | "renderedToday" | "failedToday"> } | null = null;
  const current = (): WorkerConfig => loadWorkerConfig();

  const panel = await startPanel({
    config: current,
    async status() {
      if (!statusCache || Date.now() - statusCache.at > 2500) {
        try {
          const [pending, today] = await Promise.all([pendingLocalJobs(), todayStats(cfg.workerId)]);
          statusCache = { at: Date.now(), data: { pending, ...today } };
          databaseOk = true;
        } catch (e) {
          databaseOk = false;
          lastError = serializeError(e).message;
        }
      }
      const jobsNow = [...runner.current.values()];
      return {
        workerId: cfg.workerId,
        name: current().name,
        version: WORKER_VERSION,
        online: databaseOk,
        paused,
        databaseOk,
        pending: statusCache?.data.pending ?? 0,
        rendering: jobsNow.filter((j) => j.type === "RENDER_VIDEO").length,
        renderedToday: statusCache?.data.renderedToday ?? 0,
        failedToday: statusCache?.data.failedToday ?? 0,
        currentJobs: jobsNow,
        lastHeartbeatAt,
        lastError,
        config: current(),
        health,
        startup: startupStatus(),
      };
    },
    async pause() {
      setPaused(true);
      await heartbeat();
    },
    async resume() {
      setPaused(false);
      await heartbeat();
    },
    async updateSettings(patch) {
      const next = saveWorkerConfig(patch);
      concurrency.render = next.renderConcurrency;
      concurrency.ai = next.aiConcurrency;
      health = await collectHealth(next).catch(() => health);
      log.info("settings updated", { renderDir: next.renderDir, renderConcurrency: next.renderConcurrency, aiConcurrency: next.aiConcurrency });
      return next;
    },
    shutdown: () => void shutdown("panel"),
  });

  async function heartbeat(): Promise<void> {
    try {
      const send = () => sendHeartbeat({ cfg: current(), paused, health, currentJobs: [...runner.current.values()], localUiUrl: panel.url, startedAt });
      const remote = await send();
      databaseOk = true;
      lastHeartbeatAt = new Date().toISOString();
      if (remote && Date.parse(remote.at) > pauseChangedAt) {
        // Pause/resume requested from the dashboard: apply and report the new state right away.
        const changed = remote.paused !== paused;
        setPaused(remote.paused, Date.parse(remote.at));
        pauseChangedAt = Math.max(pauseChangedAt, Date.parse(remote.at));
        if (changed) await send();
      }
    } catch (e) {
      databaseOk = false;
      lastError = `Heartbeat failed: ${serializeError(e).message}`;
      log.warn("heartbeat failed", { error: lastError });
    }
  }

  health = await collectHealth(cfg);
  for (const [k, v] of Object.entries(health)) {
    if (k !== "checkedAt" && typeof v === "object" && v && !(v as { ok: boolean }).ok) log.warn(`health: ${k} — ${(v as { detail: string }).detail}`);
  }
  await heartbeat();

  log.info(`RevenueOS worker ${WORKER_VERSION} started`, { workerId: cfg.workerId, panel: panel.url, renderDir: cfg.renderDir, paused });
  process.stdout.write(`\n  RevenueOS Worker is running.\n  Local panel:  ${panel.url}\n  Renders:      ${cfg.renderDir}\n  Dashboard:    ${cfg.dashboardUrl}\n\n`);

  // Job loop with exponential backoff while the database is unreachable (jobs just wait in the queue).
  let backoff = POLL_MS;
  const loop = async () => {
    while (!stopping) {
      try {
        const started = await runner.tick();
        databaseOk = true;
        backoff = POLL_MS;
        if (started === 0) await sleep(POLL_MS);
        else await sleep(200);
      } catch (e) {
        databaseOk = false;
        lastError = `Queue unavailable: ${serializeError(e).message}`;
        log.warn("job poll failed, retrying", { error: lastError, retryInMs: backoff });
        await sleep(backoff);
        backoff = Math.min(20_000, backoff * 2);
      }
    }
  };
  void loop();

  const timers: NodeJS.Timeout[] = [];
  timers.push(setInterval(() => void heartbeat(), HEARTBEAT_MS));
  timers.push(
    setInterval(() => {
      void collectHealth(current()).then((h) => (health = h)).catch(() => undefined);
    }, HEALTH_MS),
  );
  if (cfg.runScheduler) {
    const tick = async () => {
      if (stopping) return;
      try {
        await runSchedulerTick({ holder: cfg.workerId });
      } catch (e) {
        log.warn("scheduler tick failed", { error: serializeError(e).message });
      }
    };
    timers.push(setInterval(() => void tick(), SCHEDULER_MS));
    setTimeout(() => void tick(), 3_000);
  }

  const tray = startTray(args);
  if (args.has("--open")) openExternal(panel.url);

  async function shutdown(reason: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    log.info("worker stopping", { reason });
    for (const t of timers) clearInterval(t);
    // Give running jobs a chance to finish; anything still running is aborted and retried later.
    await Promise.race([runner.waitIdle(), sleep(20_000)]);
    runner.stop();
    await Promise.race([runner.waitIdle(), sleep(5_000)]);
    await markOffline(cfg.workerId);
    tray?.kill();
    panel.server.close();
    removeRuntimeFile();
    await closeDb().catch(() => undefined);
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (e) => log.error("unhandled rejection", { error: serializeError(e).message }));
}

/** Windows notification-area icon (PowerShell + WinForms, no extra install). Talks to the panel API. */
function startTray(args: Set<string>): ChildProcess | null {
  if (process.platform !== "win32" || args.has("--no-tray") || process.env.REVENUEOS_NO_TRAY === "1") return null;
  const script = join(REPO_ROOT, "scripts", "windows", "tray.ps1");
  if (!existsSync(script)) return null;
  try {
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", script, "-RuntimeFile", RUNTIME_FILE, "-WorkerPid", String(process.pid)], { stdio: "ignore", windowsHide: true });
    child.on("error", (e) => log.warn("tray icon unavailable", { error: e.message }));
    return child;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  log.error("worker failed to start", { error: serializeError(e).message });
  process.stderr.write(`\nRevenueOS worker could not start: ${serializeError(e).userMessage}\nRun "pnpm worker:check" to diagnose.\n`);
  process.exit(1);
});
