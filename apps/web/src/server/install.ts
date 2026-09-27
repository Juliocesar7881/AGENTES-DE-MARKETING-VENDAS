import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import { resetConfigCache } from "@revenueos/core";
import { closeDb, EMBEDDED_DEFAULT_PORT, ensureLocalDatabase, findFreePort, migrationStatus, runMigrations, startEmbeddedPostgres } from "@revenueos/database";
import { AppError, createLogger } from "@revenueos/shared";
import { env, envFilePath, envFileWritable, loadEncryptionKey, safeEqual, updateEnvFile } from "@revenueos/shared/server";
import postgres from "postgres";
import { z } from "zod";
import "./env";

/**
 * First-run installation from the browser (no terminal needed): database,
 * encryption key, migrations — then the admin account is created on /signup.
 *
 * Protection: the installer only works while RevenueOS is NOT installed, and
 * every call needs the one-time setup code printed by the server at startup
 * (the Windows launcher passes it to the browser automatically, in the URL
 * fragment, which never reaches the server logs).
 */
const log = createLogger({ component: "installer" });

export interface InstallState {
  envFile: string | null;
  writable: boolean;
  databaseConfigured: boolean;
  databaseReachable: boolean;
  databaseError: string | null;
  migrationsApplied: number;
  migrationsTotal: number;
  encryptionKey: boolean;
  adminExists: boolean;
  embedded: boolean;
  /** Everything needed to sign in exists. */
  installed: boolean;
  /** Database + key + migrations are ready (only the admin account is missing). */
  ready: boolean;
}

const g = globalThis as unknown as { __rvosInstalled?: boolean; __rvosSetupCode?: string; __rvosCodeFailures?: { n: number; since: number } };

const isLocalHost = (h: string) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(h);

/** Human explanation for the most common connection failures. */
export function describeDbError(e: unknown, url?: string): string {
  const err = e as { code?: string; message?: string; errno?: string };
  const code = err?.code ?? err?.errno ?? "";
  let host = "";
  try {
    if (url) {
      const u = new URL(url);
      host = `${u.hostname}:${u.port || 5432}`;
    }
  } catch {
    /* ignore */
  }
  const msg = err?.message ?? String(e);
  if (code === "ECONNREFUSED") return `Nothing is answering at ${host || "that address"}. Is PostgreSQL installed and running?`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `Host not found (${host}). Check the address.`;
  if (code === "ETIMEDOUT" || code === "CONNECT_TIMEOUT") return `Connection timed out (${host}). Check the address, port and firewall.`;
  if (code === "28P01") return "Wrong user name or password.";
  if (code === "3D000") return "The database does not exist yet.";
  if (code === "28000") return "The server refused this connection (check its access rules / pg_hba.conf).";
  if (/self[- ]signed|certificate/i.test(msg)) return `TLS certificate problem: ${msg}`;
  return msg.replace(/postgres(ql)?:\/\/[^@\s]*@/gi, "postgres://***@");
}

export async function installState(): Promise<InstallState> {
  const base = {
    envFile: envFilePath(),
    writable: envFileWritable(),
    embedded: env("REVENUEOS_EMBEDDED_DB") === "true",
  };
  let encryptionKey = false;
  try {
    loadEncryptionKey();
    encryptionKey = true;
  } catch {
    encryptionKey = false;
  }
  if (g.__rvosInstalled && encryptionKey) {
    return { ...base, databaseConfigured: true, databaseReachable: true, databaseError: null, migrationsApplied: 1, migrationsTotal: 1, encryptionKey, adminExists: true, installed: true, ready: true };
  }
  const url = env("DATABASE_URL");
  const s: InstallState = { ...base, databaseConfigured: Boolean(url), databaseReachable: false, databaseError: null, migrationsApplied: 0, migrationsTotal: 0, encryptionKey, adminExists: false, installed: false, ready: false };
  if (!url) return s;
  const c = postgres(url, { max: 1, connect_timeout: 5, idle_timeout: 1, onnotice: () => {}, prepare: !/:6543\//.test(url) });
  try {
    await c`select 1`;
    s.databaseReachable = true;
    const m = await migrationStatus(url);
    s.migrationsApplied = m.applied;
    s.migrationsTotal = m.total;
    if (m.applied > 0) {
      const [r] = await c`select count(*)::int as n from profiles where is_admin and not is_demo`;
      s.adminExists = Number(r?.n ?? 0) > 0;
    }
  } catch (e) {
    s.databaseError = describeDbError(e, url);
  } finally {
    await c.end({ timeout: 1 }).catch(() => undefined);
  }
  s.ready = s.databaseReachable && s.encryptionKey && s.migrationsTotal > 0 && s.migrationsApplied >= s.migrationsTotal;
  s.installed = s.ready && s.adminExists;
  if (s.installed) g.__rvosInstalled = true;
  return s;
}

/** Cheap check used by pages: true when the browser should be sent to /install. */
export async function needsInstall(): Promise<boolean> {
  if (g.__rvosInstalled) return false;
  const s = await installState();
  return !s.ready;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function setupCode(): string {
  if (process.env.REVENUEOS_SETUP_CODE) return process.env.REVENUEOS_SETUP_CODE.toUpperCase();
  g.__rvosSetupCode ??= Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return g.__rvosSetupCode;
}

function normalizeCode(c: string): string {
  return c.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Validates the setup code; locks the installer for 15 minutes after 10 wrong attempts. */
export function assertSetupCode(input: unknown): void {
  const f = (g.__rvosCodeFailures ??= { n: 0, since: Date.now() });
  if (Date.now() - f.since > 15 * 60_000) {
    f.n = 0;
    f.since = Date.now();
  }
  if (f.n >= 10) throw new AppError({ code: "SETUP_LOCKED", userMessage: "Too many wrong setup codes. Wait 15 minutes or restart RevenueOS to get a new code.", httpStatus: 429 });
  if (typeof input !== "string" || !safeEqual(normalizeCode(input), normalizeCode(setupCode()))) {
    f.n++;
    throw new AppError({ code: "SETUP_CODE", userMessage: "Setup code is not correct. It is shown in the RevenueOS window (or terminal) that started the dashboard.", httpStatus: 403 });
  }
}

export const DatabaseChoiceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("embedded") }),
  z.object({
    mode: z.literal("postgres"),
    host: z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9.\-:[\]]+$/, "Invalid host"),
    port: z.coerce.number().int().min(1).max(65535),
    user: z.string().trim().min(1).max(100),
    password: z.string().max(300),
    database: z.string().trim().min(1).max(63).regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers and _ only"),
  }),
  z.object({
    mode: z.literal("url"),
    url: z
      .string()
      .trim()
      .max(2000)
      .regex(/^postgres(ql)?:\/\//, "Paste a connection string that starts with postgres:// or postgresql://"),
  }),
]);
export type DatabaseChoice = z.infer<typeof DatabaseChoiceSchema>;

/** Builds the connection string for a choice (TLS required for non-local servers). */
export function connectionUrl(choice: Exclude<DatabaseChoice, { mode: "embedded" }>): string {
  let url: URL;
  if (choice.mode === "postgres") {
    url = new URL("postgres://placeholder");
    url.hostname = choice.host.replace(/^\[|\]$/g, "");
    url.port = String(choice.port);
    url.username = encodeURIComponent(choice.user);
    url.password = encodeURIComponent(choice.password);
    url.pathname = `/${choice.database}`;
  } else {
    url = new URL(choice.url.replace(/^postgresql:\/\//, "postgres://"));
  }
  if (!isLocalHost(url.hostname) && !url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
  return url.toString();
}

export interface DbTestResult {
  ok: boolean;
  message: string;
  serverVersion: string | null;
  databaseExists: boolean;
  willCreate: boolean;
}

export async function testDatabase(choice: DatabaseChoice): Promise<DbTestResult> {
  if (choice.mode === "embedded") return { ok: true, message: "The built-in database will be created on this computer.", serverVersion: null, databaseExists: false, willCreate: true };
  const url = connectionUrl(choice);
  const u = new URL(url);
  const local = isLocalHost(u.hostname);
  const probe = async (target: string) => {
    const c = postgres(target, { max: 1, connect_timeout: 8, idle_timeout: 1, onnotice: () => {}, prepare: !/:6543\//.test(target) });
    try {
      const [v] = await c`select current_setting('server_version') as v`;
      return String(v?.v ?? "");
    } finally {
      await c.end({ timeout: 1 }).catch(() => undefined);
    }
  };
  try {
    const version = await probe(url);
    return { ok: true, message: `Connected — PostgreSQL ${version}.`, serverVersion: version, databaseExists: true, willCreate: false };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "3D000" && local) {
      const admin = new URL(url);
      admin.pathname = "/postgres";
      try {
        const version = await probe(admin.toString());
        return { ok: true, message: `Connected — PostgreSQL ${version}. The database “${u.pathname.slice(1)}” will be created.`, serverVersion: version, databaseExists: false, willCreate: true };
      } catch (e2) {
        return { ok: false, message: describeDbError(e2, url), serverVersion: null, databaseExists: false, willCreate: false };
      }
    }
    return { ok: false, message: describeDbError(e, url), serverVersion: null, databaseExists: false, willCreate: false };
  }
}

export const InstallSchema = z.object({
  database: DatabaseChoiceSchema,
  appUrl: z
    .string()
    .trim()
    .url()
    .regex(/^https?:\/\//)
    .max(300),
  demo: z.boolean(),
});

export interface InstallStep {
  label: string;
  ok: boolean;
  detail?: string;
}

/** Performs the installation. Never overwrites an existing encryption key. */
export async function performInstall(input: z.infer<typeof InstallSchema>): Promise<{ steps: InstallStep[]; envFile: string }> {
  const state = await installState();
  if (state.installed) throw new AppError({ code: "ALREADY_INSTALLED", userMessage: "RevenueOS is already installed. Sign in instead.", httpStatus: 409 });
  if (!state.writable) throw new AppError({ code: "READ_ONLY", userMessage: "This server cannot write its configuration file. Set the environment variables in your hosting provider (see docs/deploy.md).", httpStatus: 400 });
  const steps: InstallStep[] = [];
  const values: Record<string, string> = {};

  // 1. Database
  let url: string;
  if (input.database.mode === "embedded") {
    const existing = env("REVENUEOS_EMBEDDED_DB") === "true" ? env("DATABASE_URL") : undefined;
    let port = EMBEDDED_DEFAULT_PORT;
    let password = randomBytes(18).toString("base64url");
    if (existing) {
      const u = new URL(existing);
      port = Number(u.port);
      password = decodeURIComponent(u.password);
    } else port = await findFreePort();
    try {
      const r = await startEmbeddedPostgres({ port, password, onLog: (l) => log.debug(l) });
      url = r.url;
      steps.push({ label: "Built-in database", ok: true, detail: `${r.initialised ? "Created" : "Started"} in ${r.dataDir} (127.0.0.1:${port})` });
    } catch (e) {
      throw new AppError({ code: "EMBEDDED_DB", userMessage: `The built-in database could not start: ${e instanceof Error ? e.message : String(e)}`, httpStatus: 500 });
    }
    values.REVENUEOS_EMBEDDED_DB = "true";
  } else {
    const test = await testDatabase(input.database);
    if (!test.ok) throw new AppError({ code: "DB_CONNECT", userMessage: test.message, httpStatus: 400 });
    url = connectionUrl(input.database);
    if (test.willCreate) {
      await ensureLocalDatabase(url);
      steps.push({ label: "Database created", ok: true, detail: new URL(url).pathname.slice(1) });
    } else steps.push({ label: "Database connection", ok: true, detail: test.message });
    values.REVENUEOS_EMBEDDED_DB = "false";
    if (/:6543\//.test(url)) values.DATABASE_POOLER = "true";
  }
  values.DATABASE_URL = url;

  // 2. Keys (kept when already valid — changing it would make stored credentials unreadable)
  if (!state.encryptionKey) {
    values.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    steps.push({ label: "Encryption key generated", ok: true, detail: "AES-256-GCM key for stored credentials" });
  } else steps.push({ label: "Encryption key", ok: true, detail: "Existing key kept" });
  if (!env("CRON_SECRET")) values.CRON_SECRET = randomBytes(24).toString("base64url");

  // 3. URL and demo
  const appUrl = input.appUrl.replace(/\/$/, "");
  values.APP_URL = appUrl;
  values.NEXT_PUBLIC_APP_URL = appUrl;
  values.DEMO_MODE_ENABLED = input.demo ? "true" : "false";
  values.REVENUEOS_INSTALLED_AT = new Date().toISOString();

  const file = updateEnvFile(values);
  steps.push({ label: "Configuration saved", ok: true, detail: file });
  await closeDb();
  resetConfigCache();

  // 4. Migrations (tables, roles, Row Level Security)
  try {
    await runMigrations(url);
    const m = await migrationStatus(url);
    steps.push({ label: "Database tables and security policies", ok: true, detail: `${m.applied} migration(s) applied` });
  } catch (e) {
    throw new AppError({ code: "MIGRATE", userMessage: `Migrations failed: ${describeDbError(e, url)}`, httpStatus: 500 });
  }
  log.info("installation completed", { embedded: values.REVENUEOS_EMBEDDED_DB === "true" });
  return { steps, envFile: file };
}

/** Printed by the server at startup while RevenueOS is not installed. */
export async function announceSetup(appUrl: string): Promise<void> {
  const s = await installState();
  if (s.installed || !s.writable) return;
  const line = "─".repeat(58);
  console.info(`\n${line}\n  RevenueOS is not set up yet.\n  Open ${appUrl}/install\n  Setup code: ${setupCode()}\n${line}\n`);
}
