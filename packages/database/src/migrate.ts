import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { closeDb } from "./client";

export const MIGRATIONS_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

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
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end({ timeout: 5 });
  }
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
