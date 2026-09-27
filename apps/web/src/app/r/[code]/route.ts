import { NextResponse } from "next/server";
import { getConfig, recordClick } from "@revenueos/core";
import "@/server/boot";

/** Tracked link in every caption: records an anonymous click (hashed, daily) and forwards to WhatsApp or the lead form. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const base = getConfig().appUrl;
  if (!/^[A-Za-z0-9]{4,12}$/.test(code)) return NextResponse.redirect(base, 302);
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "0.0.0.0").trim();
  try {
    const r = await recordClick(code, { ip, userAgent: req.headers.get("user-agent") ?? "" });
    if (!r) return new NextResponse("This link is no longer active.", { status: 404 });
    const target = r.url.startsWith("/") ? `${base}${r.url}` : r.url;
    return NextResponse.redirect(target, { status: 302, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch {
    return NextResponse.redirect(base, 302);
  }
}
