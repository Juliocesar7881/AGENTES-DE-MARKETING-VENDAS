import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { env, findRepoRoot } from "@revenueos/shared/server";

/**
 * "Built-in database": a real PostgreSQL 17 server shipped as an npm package
 * (embedded-postgres), for installs where the dashboard and the worker run on
 * one computer. It listens on 127.0.0.1 only, keeps its data in the user's
 * application-data folder and is started by whichever RevenueOS process needs
 * it first (normally the launcher). Nothing else has to be installed.
 */
export const EMBEDDED_DB_NAME = "revenueos";
export const EMBEDDED_DB_USER = "revenueos";
export const EMBEDDED_DEFAULT_PORT = 5433;

export function embeddedDataDir(): string {
  const custom = env("REVENUEOS_PGDATA");
  if (custom) return custom;
  const home = homedir();
  if (platform() === "win32") return join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "RevenueOS", "pgdata");
  if (platform() === "darwin") return join(home, "Library", "Application Support", "RevenueOS", "pgdata");
  return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "RevenueOS", "pgdata");
}

export function embeddedUrl(port: number, password: string, database = EMBEDDED_DB_NAME): string {
  return `postgres://${EMBEDDED_DB_USER}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

export async function findFreePort(from = EMBEDDED_DEFAULT_PORT, to = from + 30): Promise<number> {
  for (let p = from; p <= to; p++) if (await isPortFree(p)) return p;
  throw new Error(`No free port between ${from} and ${to} for the built-in database.`);
}

async function canConnect(url: string): Promise<boolean> {
  const c = postgres(url, { max: 1, connect_timeout: 3, idle_timeout: 1, onnotice: () => {} });
  try {
    await c`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await c.end({ timeout: 1 }).catch(() => undefined);
  }
}

interface EmbeddedPostgresLike {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
type EmbeddedPostgresCtor = new (options: Record<string, unknown>) => EmbeddedPostgresLike;

function embeddedEntry(): string {
  const root = findRepoRoot() ?? process.cwd();
  const req = createRequire(join(/*turbopackIgnore: true*/ root, "packages", "database", "package.json"));
  try {
    return req.resolve("embedded-postgres");
  } catch {
    throw new Error("The built-in database component is not installed. Run the installer again (pnpm install) or choose another database option.");
  }
}

/** Loaded at runtime from the database package (never bundled into the dashboard). */
async function loadEmbeddedPostgres(): Promise<EmbeddedPostgresCtor> {
  const mod = (await import(/* webpackIgnore: true */ /*turbopackIgnore: true*/ pathToFileURL(embeddedEntry()).href)) as { default: EmbeddedPostgresCtor };
  return mod.default;
}

async function embeddedBinaries(): Promise<{ pg_ctl: string }> {
  const mod = (await import(/* webpackIgnore: true */ /*turbopackIgnore: true*/ pathToFileURL(join(dirname(embeddedEntry()), "binary.js")).href)) as { default: () => Promise<{ pg_ctl: string }> };
  return mod.default();
}

const g = globalThis as unknown as { __revenueosEmbeddedPg?: { pg: EmbeddedPostgresLike; url: string } };

/** The server this process started, if it is still running. */
function hosted(): { pg: EmbeddedPostgresLike; url: string } | null {
  const h = g.__revenueosEmbeddedPg;
  if (!h) return null;
  const child = (h.pg as unknown as { process?: { exitCode: number | null; signalCode: string | null } }).process;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    g.__revenueosEmbeddedPg = undefined;
    return null;
  }
  return h;
}

export interface EmbeddedStartResult {
  url: string;
  /** false when a server was already running on that port (another RevenueOS process hosts it). */
  started: boolean;
  /** true when the data folder was created now. */
  initialised: boolean;
  dataDir: string;
}

export async function startEmbeddedPostgres(opts: { port: number; password: string; dataDir?: string; onLog?: (line: string) => void }): Promise<EmbeddedStartResult> {
  const dataDir = opts.dataDir ?? embeddedDataDir();
  const url = embeddedUrl(opts.port, opts.password);
  if (hosted()?.url === url || (await canConnect(url))) return { url, started: false, initialised: false, dataDir };
  if (!(await isPortFree(opts.port))) throw new Error(`Port ${opts.port} is used by another program. Choose another port or stop that program.`);

  const EmbeddedPostgres = await loadEmbeddedPostgres();
  await mkdir(dirname(dataDir), { recursive: true });
  const log = opts.onLog ?? (() => {});
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: opts.port,
    user: EMBEDDED_DB_USER,
    password: opts.password,
    authMethod: "scram-sha-256",
    persistent: true,
    // Only for root-only Linux containers (e.g. CI). Never needed on Windows/macOS.
    createPostgresUser: process.env.REVENUEOS_PG_CREATE_USER === "1",
    postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "max_connections=80"],
    onLog: (m: string) => log(String(m).trim()),
    onError: (e: unknown) => log(`[error] ${e instanceof Error ? e.message : String(e)}`),
  });
  let initialised = false;
  if (!existsSync(join(dataDir, "PG_VERSION"))) {
    await pg.initialise();
    initialised = true;
  }
  try {
    await pg.start();
  } catch (e) {
    throw new Error(`The built-in database did not start${e instanceof Error ? `: ${e.message}` : ""}. See the log in ${dataDir}.`);
  }
  const admin = postgres(embeddedUrl(opts.port, opts.password, "postgres"), { max: 1, onnotice: () => {} });
  try {
    const rows = await admin`select 1 from pg_database where datname = ${EMBEDDED_DB_NAME}`;
    if (rows.length === 0) await admin.unsafe(`create database "${EMBEDDED_DB_NAME}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  g.__revenueosEmbeddedPg = { pg, url };
  return { url, started: true, initialised, dataDir };
}

export async function stopEmbeddedPostgres(): Promise<void> {
  const h = hosted();
  g.__revenueosEmbeddedPg = undefined;
  // Never wait forever: the server may exit while we ask it to stop.
  if (h) await Promise.race([h.pg.stop(), new Promise((r) => setTimeout(r, 20_000))]);
}

/**
 * Stops the built-in database server that owns this data folder, whichever
 * process started it (e.g. the dashboard during installation, or a crashed run).
 */
export async function stopEmbeddedPostgresByDataDir(dataDir = embeddedDataDir()): Promise<boolean> {
  const pidFile = join(dataDir, "postmaster.pid");
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, "utf8").split(/\r?\n/)[0]);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (!alive()) return false;
  if (platform() === "win32") {
    const { pg_ctl } = await embeddedBinaries();
    spawnSync(pg_ctl, ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", "30"], { windowsHide: true, stdio: "ignore" });
  } else {
    process.kill(pid, "SIGINT"); // PostgreSQL "fast" shutdown
  }
  for (let i = 0; i < 60 && alive(); i++) await new Promise((r) => setTimeout(r, 250));
  return !alive();
}

/** Starts the built-in database when this installation uses it (REVENUEOS_EMBEDDED_DB=true) and it is not running yet. */
export async function ensureEmbeddedPostgres(onLog?: (line: string) => void): Promise<EmbeddedStartResult | null> {
  if (env("REVENUEOS_EMBEDDED_DB") !== "true") return null;
  const raw = env("DATABASE_URL");
  if (!raw) return null;
  const u = new URL(raw);
  return startEmbeddedPostgres({ port: Number(u.port || EMBEDDED_DEFAULT_PORT), password: decodeURIComponent(u.password), onLog });
}
