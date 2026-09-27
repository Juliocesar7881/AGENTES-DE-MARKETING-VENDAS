import postgres from "postgres";
import { applyTestEnv, TEST_DB_URL } from "./test-env";

/** Creates a fresh test database and applies all migrations (tables, roles, RLS policies). */
export default async function setup(): Promise<() => Promise<void>> {
  applyTestEnv();
  const u = new URL(TEST_DB_URL);
  const name = u.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.includes("test")) throw new Error(`Refusing to recreate database "${name}" (name must contain "test").`);
  u.pathname = "/postgres";
  const admin = postgres(u.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${name}' and pid <> pg_backend_pid()`);
  await admin.unsafe(`drop database if exists "${name}"`);
  await admin.unsafe(`create database "${name}"`);
  await admin.end();
  const { runMigrations } = await import("@revenueos/database");
  const { closeDb } = await import("@revenueos/database");
  await runMigrations(TEST_DB_URL);
  await closeDb();
  return async () => {};
}
