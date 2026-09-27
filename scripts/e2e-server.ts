/**
 * Starts the dashboard for the Playwright E2E suite against its OWN database
 * (default revenueos_e2e, recreated on every run) and its own storage folder,
 * so E2E never touches development data. Used by playwright.config.ts.
 *
 *   E2E_DATABASE_URL  postgres://…/revenueos_e2e  (name must contain "e2e")
 *   E2E_PORT          3100
 *   E2E_BUILD=1       force `next build` even if a build exists
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";

const ROOT = resolve(import.meta.dirname, "..");
const WEB = join(ROOT, "apps", "web");
const DB_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/revenueos_e2e";
const PORT = Number(process.env.E2E_PORT ?? 3100);
const DATA = join(ROOT, ".data", "e2e");

async function resetDatabase(): Promise<void> {
  const u = new URL(DB_URL);
  const name = u.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("e2e")) throw new Error(`Refusing to recreate database "${name}" (name must contain "e2e").`);
  u.pathname = "/postgres";
  const admin = postgres(u.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${name}' and pid <> pg_backend_pid()`);
  await admin.unsafe(`drop database if exists "${name}"`);
  await admin.unsafe(`create database "${name}"`);
  await admin.end();
  const { runMigrations, closeDb } = await import("@revenueos/database");
  await runMigrations(DB_URL);
  await closeDb();
}

async function main(): Promise<void> {
  await resetDatabase();
  rmSync(DATA, { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: DB_URL,
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
  const nextBin = join(WEB, "node_modules", "next", "dist", "bin", "next");
  if (process.env.E2E_BUILD === "1" || !existsSync(join(WEB, ".next", "BUILD_ID"))) {
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
