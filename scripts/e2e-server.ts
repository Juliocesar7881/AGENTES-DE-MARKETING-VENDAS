/**
 * Starts the dashboard for the Playwright E2E suite against its OWN database
 * and its own config/storage folders, so E2E never touches development data
 * or the real .env. Used by playwright.config.ts.
 *
 *   (default)  installed instance: fresh migrated database (revenueos_e2e) — port E2E_PORT (3100)
 *   --fresh    NOT installed: no database/keys configured, to test the browser installer — port 3101
 *
 *   E2E_DATABASE_URL  postgres://…/revenueos_e2e  (name must contain "e2e")
 *   E2E_BUILD=1       force `next build` even if a build exists
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";

const ROOT = resolve(import.meta.dirname, "..");
const WEB = join(ROOT, "apps", "web");
const FRESH = process.argv.includes("--fresh");
const DB_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/revenueos_e2e";
const PORT = FRESH ? Number(process.env.E2E_INSTALL_PORT ?? 3101) : Number(process.env.E2E_PORT ?? 3100);
const DATA = join(ROOT, ".data", FRESH ? "e2e-install" : "e2e");
/** Database the installer E2E creates through the UI (dropped here first). */
export const INSTALL_DB = "revenueos_e2e_install";

async function recreate(url: string, create: boolean): Promise<void> {
  const u = new URL(url);
  const name = u.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("e2e")) throw new Error(`Refusing to recreate database "${name}" (name must contain "e2e").`);
  u.pathname = "/postgres";
  const admin = postgres(u.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${name}' and pid <> pg_backend_pid()`);
  await admin.unsafe(`drop database if exists "${name}"`);
  if (create) await admin.unsafe(`create database "${name}"`);
  await admin.end();
}

async function main(): Promise<void> {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    // Never read or write the developer's .env.
    REVENUEOS_ENV_FILE: join(DATA, ".env"),
    APP_URL: `http://localhost:${PORT}`,
    NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
    DEMO_MODE_ENABLED: "true",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: join(DATA, "storage"),
    REVENUEOS_DATA_DIR: DATA,
    CRON_SECRET: "e2e-cron-secret",
    EMBEDDED_RUNNER: "true",
    LOG_LEVEL: "warn",
    // Never use a developer's real credentials in E2E (explicitly empty = not configured).
    ANTHROPIC_API_KEY: "",
    INSTAGRAM_APP_ID: "",
    INSTAGRAM_APP_SECRET: "",
    META_APP_ID: "",
    META_APP_SECRET: "",
    TIKTOK_CLIENT_KEY: "",
    TIKTOK_CLIENT_SECRET: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
  };
  let env: NodeJS.ProcessEnv;
  if (FRESH) {
    const u = new URL(DB_URL);
    u.pathname = `/${INSTALL_DB}`;
    await recreate(u.toString(), false);
    env = { ...base, REVENUEOS_SETUP_CODE: "E2E0-TEST" };
    delete env.DATABASE_URL;
    delete env.APP_ENCRYPTION_KEY;
    delete env.CRON_SECRET;
  } else {
    await recreate(DB_URL, true);
    const { runMigrations, closeDb } = await import("@revenueos/database");
    await runMigrations(DB_URL);
    await closeDb();
    env = { ...base, DATABASE_URL: DB_URL, APP_ENCRYPTION_KEY: process.env.E2E_ENCRYPTION_KEY ?? Buffer.alloc(32, 9).toString("base64") };
  }
  const nextBin = join(WEB, "node_modules", "next", "dist", "bin", "next");
  if (FRESH) {
    // Share the build of the main E2E server: wait until it has built and started.
    const main = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}/api/health`;
    for (let i = 0; i < 900; i++) {
      if (await fetch(main).then(() => true, () => false)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!FRESH && (process.env.E2E_BUILD === "1" || !existsSync(join(WEB, ".next", "BUILD_ID")))) {
    const b = spawnSync(process.execPath, [nextBin, "build"], { cwd: WEB, env, stdio: "inherit" });
    if (b.status !== 0) process.exit(b.status ?? 1);
  }
  const child = spawn(process.execPath, [nextBin, "start", "--port", String(PORT)], { cwd: WEB, env, stdio: "inherit" });
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => child.kill(sig));
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
