import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AuthorizationError } from "@revenueos/shared";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run queries: the root database or a transaction. */
export type DbExecutor = Database | Transaction;

interface ClientState {
  sql: postgres.Sql;
  db: Database;
  url: string;
}

const globalForDb = globalThis as unknown as { __revenueosDb?: ClientState };

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and point it at your Postgres/Supabase database.");
  }
  return url;
}

function createClient(url: string): ClientState {
  // Supabase transaction pooler (port 6543) does not support prepared statements.
  const usesPooler = /:6543\//.test(url) || process.env.DATABASE_POOLER === "true";
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: !usesPooler,
    onnotice: () => {},
    connection: { application_name: process.env.DATABASE_APP_NAME ?? "revenueos" },
  });
  const database = drizzle(client, { schema, casing: undefined });
  // drizzle installs identity serializers for date/time OIDs; make raw `sql` params accept Date objects too.
  const serializers = (client.options as unknown as { serializers: Record<number, (x: unknown) => unknown> }).serializers;
  for (const oid of [1082, 1083, 1114, 1115, 1182, 1184, 1185]) {
    serializers[oid] = (x: unknown) => (x instanceof Date ? x.toISOString() : x);
  }
  return { sql: client, db: database, url };
}

/**
 * System (service) database handle. Runs as the table owner, so RLS does not
 * apply — use only in trusted server code: workers, webhooks, cron, and after
 * the caller has been authorized explicitly.
 */
export function getDb(): Database {
  const url = databaseUrl();
  if (!globalForDb.__revenueosDb || globalForDb.__revenueosDb.url !== url) {
    globalForDb.__revenueosDb = createClient(url);
  }
  return globalForDb.__revenueosDb.db;
}

export function getSql(): postgres.Sql {
  getDb();
  return globalForDb.__revenueosDb!.sql;
}

export async function closeDb(): Promise<void> {
  const state = globalForDb.__revenueosDb;
  globalForDb.__revenueosDb = undefined;
  if (state) await state.sql.end({ timeout: 5 });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Postgres role used for all user-scoped queries. It has no BYPASSRLS. */
export const APP_ROLE = "revenueos_app";

/**
 * Runs `fn` inside a transaction that impersonates `userId` under Row Level
 * Security: `SET LOCAL ROLE revenueos_app` + `app.user_id`. Every SELECT,
 * UPDATE and DELETE is filtered by the RLS policies to workspaces the user
 * belongs to — isolation is enforced by the database, not only the UI.
 */
export async function withUser<T>(userId: string, fn: (tx: Transaction) => Promise<T>, db: Database = getDb()): Promise<T> {
  if (!isUuid(userId)) throw new AuthorizationError("Invalid session.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql.raw(`set local role ${APP_ROLE}`));
    return fn(tx);
  });
}
