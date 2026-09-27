import { NextResponse } from "next/server";
import { getConfig } from "@revenueos/core";
import { safeEqual } from "@revenueos/shared/server";
import { cronTick } from "@/server/runner";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Scheduler tick for serverless hosting (Vercel Cron, Supabase pg_cron, any pinger). Requires Authorization: Bearer CRON_SECRET. */
async function handle(req: Request) {
  const secret = getConfig().cronSecret;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const report = await cronTick();
  return NextResponse.json({ ok: true, ...report });
}

export const GET = handle;
export const POST = handle;
