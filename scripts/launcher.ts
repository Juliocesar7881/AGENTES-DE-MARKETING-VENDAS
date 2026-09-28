/**
 * RevenueOS launcher — one command (or a double-click on RevenueOS.bat) for a
 * single-computer installation:
 *   1. starts the built-in database when this installation uses it;
 *   2. builds the dashboard the first time (or after an update);
 *   3. starts the dashboard (127.0.0.1 only) and the local worker, and keeps them running;
 *   4. opens the browser — on the installer (with its setup code) the first time.
 * Close the window or press Ctrl+C to stop everything.
 *
 *   pnpm launch [--rebuild] [--no-browser] [--no-worker] [--port 3000]
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { embeddedDataDir, ensureEmbeddedPostgres, migrateIfBehind, stopEmbeddedPostgres, stopEmbeddedPostgresByDataDir } from "@revenueos/database";
import { ensureRootEnv, env } from "@revenueos/shared/server";

const ROOT = resolve(import.meta.dirname, "..");
const WEB = join(ROOT, "apps", "web");
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const c = { dim: "\x1b[2m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", bold: "\x1b[1m", reset: "\x1b[0m" };
const say = (m: string) => console.info(`${c.dim}[revenueos]${c.reset} ${m}`);
const fail = (m: string): never => {
  console.error(`${c.red}✖ ${m}${c.reset}`);
  process.exit(1);
};

function checkNode(): void {
  const [maj, min] = process.versions.node.split(".").map(Number) as [number, number];
  if (maj < 20 || (maj === 20 && min < 18)) fail(`Node.js ${process.versions.node} is too old. Install Node.js 20 LTS or newer from https://nodejs.org and try again.`);
}

function portFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((r) => {
    const s = createServer();
    s.once("error", () => r(false));
    s.once("listening", () => s.close(() => r(true)));
    s.listen(port, host);
  });
}

async function health(base: string): Promise<{ setup?: string } | null> {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
    return (await res.json()) as { setup?: string };
  } catch {
    return null;
  }
}

function openBrowser(url: string): void {
  if (flag("--no-browser")) return;
  const [cmd, cmdArgs] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, cmdArgs as string[], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* no browser available: the address is printed below */
  }
}

/** Newest modification time among the dashboard sources and the packages it bundles. */
function sourceStamp(): number {
  let newest = 0;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  for (const d of [join(WEB, "src"), ...readdirSync(join(ROOT, "packages")).map((p) => join(ROOT, "packages", p, "src"))]) if (existsSync(d)) walk(d);
  for (const f of ["next.config.ts", "package.json"]) if (existsSync(join(WEB, f))) newest = Math.max(newest, statSync(join(WEB, f)).mtimeMs);
  return Math.floor(newest);
}

function ensureBuild(): void {
  const stampFile = join(WEB, ".next", "revenueos-build-stamp");
  const stamp = String(sourceStamp());
  const built = existsSync(join(WEB, ".next", "BUILD_ID")) && existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp;
  if (built && !flag("--rebuild")) return;
  say("Preparing the dashboard (first start or update — takes a few minutes)…");
  const r = spawnSync(process.execPath, [join(WEB, "node_modules", "next", "dist", "bin", "next"), "build"], { cwd: WEB, stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  if (r.status !== 0) fail("The dashboard build failed (see the messages above).");
  writeFileSync(stampFile, stamp);
}

const children = new Map<string, ChildProcess>();
let stopping = false;

function supervise(name: string, command: string, cmdArgs: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }, restarts = { n: 0 }): void {
  const child = spawn(command, cmdArgs, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "inherit", "inherit"] });
  children.set(name, child);
  child.on("exit", (code) => {
    children.delete(name);
    if (stopping) return;
    restarts.n++;
    if (restarts.n > 5) {
      console.error(`${c.red}✖ The ${name} keeps stopping (exit ${code}). Check the messages above.${c.reset}`);
      return;
    }
    say(`${c.yellow}${name} stopped (exit ${code}) — restarting in 5s${c.reset}`);
    setTimeout(() => supervise(name, command, cmdArgs, opts, restarts), 5000);
  });
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  say("Stopping RevenueOS…");
  for (const ch of children.values()) ch.kill("SIGTERM");
  // The worker lets running jobs finish (up to ~25s); anything left is killed and retried later.
  for (let i = 0; i < 120 && children.size > 0; i++) await new Promise((r) => setTimeout(r, 250));
  for (const ch of children.values()) ch.kill("SIGKILL");
  await stopEmbeddedPostgres().catch(() => undefined);
  if (env("REVENUEOS_EMBEDDED_DB") === "true") await stopEmbeddedPostgresByDataDir(embeddedDataDir()).catch(() => undefined);
  process.exit(0);
}

async function main(): Promise<void> {
  checkNode();
  if (!existsSync(join(ROOT, "node_modules", ".pnpm"))) fail("Dependencies are missing. Run RevenueOS.bat again (it installs them) or `pnpm install`.");
  ensureRootEnv();
  mkdirSync(join(ROOT, ".data", "logs"), { recursive: true });

  const port = Number(opt("--port") ?? env("PORT") ?? 3000);
  const host = env("REVENUEOS_HOST") ?? "127.0.0.1";
  const base = `http://localhost:${port}`;
  const probe = host === "127.0.0.1" || host === "0.0.0.0" ? `http://127.0.0.1:${port}` : base;

  if (!(await portFree(port, host))) {
    const h = await health(probe);
    if (h) {
      say(`RevenueOS is already running at ${base} — opening it.`);
      openBrowser(h.setup === "required" ? `${base}/install` : base);
      return;
    }
    fail(`Port ${port} is used by another program. Start with another port: pnpm launch --port 3100`);
  }

  // 1. Built-in database (this process hosts it, so it stops cleanly with RevenueOS).
  try {
    const db = await ensureEmbeddedPostgres((line) => {
      if (/error|fatal/i.test(line)) say(`database: ${line}`);
    });
    if (db?.started) say(`Built-in database started (${db.dataDir})`);
  } catch (e) {
    say(`${c.yellow}Built-in database: ${e instanceof Error ? e.message : String(e)}${c.reset}`);
  }
  // The database library stops PostgreSQL on the first signal; the launcher does it itself,
  // after the dashboard and the worker have finished (see shutdown()).
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) process.removeAllListeners(sig);

  // 2. Database schema up to date after an update (the installer handles empty databases).
  try {
    const url = env("DATABASE_URL");
    if (url) {
      const n = await migrateIfBehind(url);
      if (n > 0) say(`Database updated (${n} new migration${n > 1 ? "s" : ""}).`);
    }
  } catch (e) {
    say(`${c.yellow}Database update skipped: ${e instanceof Error ? e.message : String(e)}${c.reset}`);
  }

  // 3. Dashboard build
  ensureBuild();

  // 4. Dashboard + worker
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const setupCode = Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + alphabet[randomInt(alphabet.length)]).join("");
  const childEnv: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), REVENUEOS_SETUP_CODE: setupCode, NEXT_TELEMETRY_DISABLED: "1" };
  if (!env("APP_URL")) {
    childEnv.APP_URL = base;
    childEnv.NEXT_PUBLIC_APP_URL = base;
  }
  supervise("dashboard", process.execPath, [join(WEB, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(port), "--hostname", host], { cwd: WEB, env: { ...childEnv, NODE_ENV: "production" } });
  if (!flag("--no-worker")) {
    // Single process (no wrapper) so stop signals reach the worker directly.
    supervise("worker", process.execPath, ["--import", "tsx", join(ROOT, "apps", "worker", "src", "index.ts")], { cwd: ROOT, env: childEnv });
  }

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGHUP", () => void shutdown());
  process.on("SIGBREAK", () => void shutdown());

  // 5. Browser
  let h: { setup?: string } | null = null;
  for (let i = 0; i < 120 && !h; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    h = await health(probe);
  }
  if (!h) fail(`The dashboard did not start. See the messages above.`);
  const url = h!.setup === "required" ? `${base}/install#code=${setupCode}` : base;
  const line = "─".repeat(60);
  console.info(`\n${c.green}${line}${c.reset}\n  ${c.bold}RevenueOS is running${c.reset}  →  ${base}\n${h!.setup === "required" ? `  First start: finish the installation in the browser (setup code ${c.bold}${setupCode}${c.reset}).\n` : ""}  Keep this window open (minimize it). Close it to stop RevenueOS.\n${c.green}${line}${c.reset}\n`);
  openBrowser(url);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
