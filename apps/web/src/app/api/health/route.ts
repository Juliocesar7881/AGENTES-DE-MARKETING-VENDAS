import { NextResponse } from "next/server";
import { getConfig } from "@revenueos/core";
import { getDb, sql } from "@revenueos/database";
import "@/server/boot";

export const dynamic = "force-dynamic";

/** Liveness + database check (no secrets, no tenant data). */
export async function GET() {
  const started = Date.now();
  let db = false;
  try {
    await getDb().execute(sql`select 1`);
    db = true;
  } catch {
    db = false;
  }
  const cfg = getConfig();
  return NextResponse.json({ ok: db, database: db, latencyMs: Date.now() - started, storage: cfg.storageDriver, demo: cfg.demoEnabled, version: "0.1.0" }, { status: db ? 200 : 503, headers: { "cache-control": "no-store" } });
}
