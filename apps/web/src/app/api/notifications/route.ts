import { NextResponse } from "next/server";
import { notificationFeed } from "@/server/queries";
import { getUser } from "@/server/session";

export async function GET() {
  if (!(await getUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const feed = await notificationFeed(30);
  return NextResponse.json(feed, { headers: { "cache-control": "no-store" } });
}
