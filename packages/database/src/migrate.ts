import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { findRepoRoot } from "@revenueos/shared/server";
import { closeDb } from "./client";

/** Bundlers (Next.js) relocate this file, so fall back to the repository layout. */
function resolveMigrationsFolder(): string {
  const local = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  if (existsSync(join(/*turbopackIgnore: true*/ local, "meta", "_journal.json"))) return local;
  const root = findRepoRoot();
  return root ? join(/*turbopackIgnore: true*/ root, "packages", "database", "migrations") : local;
}

export const MIGRATIONS_FOLDER = resolveMigrationsFolder();

/** Applied vs. available migrations for a database (0 applied when it was never migrated). */
export async function migrationStatus(url: string): Promise<{ applied: number; total: number }> {
  const journal = JSON.parse(readFileSync(join(/*turbopackIgnore: true*/ MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
  const c = postgres(url, { max: 1, connect_timeout: 5, idle_timeout: 1, onnotice: () => {}, prepare: !/:6543\//.test(url) });
  try {
    const [t] = await c`select to_regclass('drizzle.__drizzle_migrations') is not null as ok`;
    if (!t?.ok) return { applied: 0, total: journal.entries.length };
    const [r] = await c`select count(*)::int as n from drizzle.__drizzle_migrations`;
    return { applied: Number(r?.n ?? 0), total: journal.entries.length };
  } finally {
    await c.end({ timeout: 1 });
  }
}

function isLocal(url: string): boolean {
  try {
    const u = new URL(url);
    return ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Creates the target database on a local Postgres server when it does not exist yet. */
export async function ensureLocalDatabase(url: string): Promise<void> {
  if (!isLocal(url)) return;
  const u = new URL(url);
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!dbName || !/^[a-zA-Z0-9_]+$/.test(dbName)) return;
  u.pathname = "/postgres";
  const admin = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try {
    const rows = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (rows.length === 0) await admin.unsafe(`create database "${dbName}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

export async function runMigrations(url = process.env.DATABASE_URL): Promise<void> {
  if (!url) throw new Error("DATABASE_URL is not set.");
  await ensureLocalDatabase(url);
  // Dedicated connection: migrate exactly the database given, whatever DATABASE_URL says.
  // A session advisory lock serializes concurrent starters (dashboard, launcher, installer).
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client`select pg_advisory_lock(hashtext('revenueos:migrations'))`;
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    await client`select pg_advisory_unlock(hashtext('revenueos:migrations'))`;
  } finally {
    await client.end({ timeout: 5 });
  }
}

/**
 * After an update: applies new migrations to an already-installed database (never
 * to an empty one — that is the installer's job). Returns how many were applied.
 */
export async function migrateIfBehind(url: string): Promise<number> {
  const before = await migrationStatus(url);
  if (before.applied === 0 || before.applied >= before.total) return 0;
  await runMigrations(url);
  const after = await migrationStatus(url);
  return after.applied - before.applied;
}

/** Drops everything. Refuses to run against non-local databases unless ALLOW_DB_RESET=true. */
export async function resetDatabase(url = process.env.DATABASE_URL): Promise<void> {
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!isLocal(url) && process.env.ALLOW_DB_RESET !== "true") {
    throw new Error("Refusing to reset a non-local database. Set ALLOW_DB_RESET=true if you really mean it.");
  }
  await ensureLocalDatabase(url);
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`
      drop schema if exists public cascade;
      drop schema if exists drizzle cascade;
      drop schema if exists app cascade;
      create schema public;
      grant all on schema public to public;
    `);
  } finally {
    await admin.end({ timeout: 5 });
  }
  await closeDb();
  await runMigrations(url);
}
