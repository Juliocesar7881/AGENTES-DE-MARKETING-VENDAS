import { NextResponse } from "next/server";
import { completeSocialConnect, getConfig } from "@revenueos/core";
import { AppError, createLogger, type Platform } from "@revenueos/shared";
import { getUser } from "@/server/session";

const log = createLogger({ component: "oauth-callback" });

/** OAuth redirect target. State is verified against the signed-in user, workspace and platform. */
export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const base = getConfig().appUrl;
  const url = new URL(req.url);
  const platform = (await ctx.params).platform.toUpperCase() as Platform;
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${base}/login`);
  const err = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (err || !code || !state) {
    return NextResponse.redirect(`${base}/overview?connectError=${encodeURIComponent(err ?? "The platform did not return an authorization code.")}`);
  }
  try {
    const r = await completeSocialConnect({ platform, state, code, userId: user.id });
    return NextResponse.redirect(`${base}${r.redirectTo}?connected=${platform.toLowerCase()}&status=${r.status}`);
  } catch (e) {
    const msg = e instanceof AppError ? e.userMessage : "Connection failed. Try again.";
    log.warn("oauth callback failed", { platform, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.redirect(`${base}/overview?connectError=${encodeURIComponent(msg)}`);
  }
}
