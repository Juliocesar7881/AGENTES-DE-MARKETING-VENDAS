#!/usr/bin/env node
/**
 * First-run setup (idempotent, never deletes data):
 *   1. creates .env from .env.example with freshly generated secrets (if missing)
 *   2. creates the local database when DATABASE_URL points to localhost and it does not exist
 *   3. applies migrations (tables, RLS policies, roles)
 *   4. creates the demo account + 3 demo workspaces (clearly marked DEMO)
 * Usage: pnpm setup [--no-demo]
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const args = new Set(process.argv.slice(2));
const ok = (m) => console.info(`\x1b[32m✔\x1b[0m ${m}`);
const warn = (m) => console.info(`\x1b[33m!\x1b[0m ${m}`);
const fail = (m) => {
  console.error(`\x1b[31m✖\x1b[0m ${m}`);
  process.exit(1);
};

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) fail(`Node.js ${process.versions.node} is too old — install Node 20 LTS or newer.`);

// 1. .env
if (!existsSync(envPath)) {
  copyFileSync(join(root, ".env.example"), envPath);
  ok("Created .env from .env.example");
}
let env = readFileSync(envPath, "utf8");
const setIfEmpty = (key, value) => {
  const re = new RegExp(`^${key}=\\s*(#.*)?$`, "m");
  if (re.test(env)) {
    env = env.replace(re, `${key}=${value}`);
    return true;
  }
  if (!new RegExp(`^${key}=`, "m").test(env)) {
    env += `\n${key}=${value}\n`;
    return true;
  }
  return false;
};
if (setIfEmpty("APP_ENCRYPTION_KEY", randomBytes(32).toString("base64"))) ok("Generated APP_ENCRYPTION_KEY (keep it safe — it encrypts stored credentials)");
if (setIfEmpty("CRON_SECRET", randomBytes(24).toString("base64url"))) ok("Generated CRON_SECRET");
writeFileSync(envPath, env);

const values = Object.fromEntries(
  env
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#]*?)\s*(#.*)?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const dbUrl = process.env.DATABASE_URL || values.DATABASE_URL;
if (!dbUrl) fail("DATABASE_URL is empty in .env");

const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsx)) fail("Dependencies are missing — run: pnpm install");
const run = (label, script, extra = []) => {
  const r = spawnSync(process.execPath, [tsx, script, ...extra], { cwd: root, stdio: "inherit", env: { ...process.env } });
  if (r.status !== 0) fail(`${label} failed (exit ${r.status}).`);
};

// 2. Local database creation (only for localhost URLs).
const url = new URL(dbUrl);
if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
  const dbName = decodeURIComponent(url.pathname.slice(1)) || "revenueos";
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) fail(`Unsupported database name "${dbName}"`);
  const r = spawnSync(process.execPath, [tsx, join(root, "packages", "database", "scripts", "ensure-db.ts"), dbName], { cwd: root, stdio: "inherit", env: { ...process.env } });
  if (r.status !== 0) {
    warn("Could not connect to the local Postgres server.");
    console.info("  Start Postgres 15+ locally (or use a free Supabase project) and set DATABASE_URL in .env.");
    console.info("  Windows: winget install PostgreSQL.PostgreSQL.16   ·   Docker: docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16");
    process.exit(1);
  }
}

// 3. Migrations
run("Migrations", join(root, "packages", "database", "scripts", "migrate.ts"));

// 4. Demo
if (!args.has("--no-demo") && (values.DEMO_MODE_ENABLED ?? "true") !== "false") run("Demo seed", join(root, "packages", "core", "scripts", "seed.ts"));

console.info(`
\x1b[1mRevenueOS is ready.\x1b[0m
  Start everything:   pnpm dev          (dashboard http://localhost:3000 + local worker)
  Dashboard only:     pnpm dev:web
  Worker only:        pnpm worker       (Windows: start-worker.bat)
  Demo login:         click "Explore Demo" on the login page
`);
