import { NextResponse } from "next/server";
import { CONNECTABLE_PLATFORMS, getConfig, startSocialConnect } from "@revenueos/core";
import { eq, isUuid, withUser, workspaces } from "@revenueos/database";
import { AppError, type Platform } from "@revenueos/shared";
import { getUser } from "@/server/session";

/** Starts the official OAuth flow for a social platform (we never ask for passwords). */
export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const base = getConfig().appUrl;
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${base}/login`);
  const platform = (await ctx.params).platform.toUpperCase() as Platform;
  const workspaceId = new URL(req.url).searchParams.get("workspaceId") ?? "";
  if (!isUuid(workspaceId) || !CONNECTABLE_PLATFORMS.includes(platform)) return NextResponse.redirect(`${base}/overview`);
  const [ws] = await withUser(user.id, (tx) => tx.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1));
  if (!ws) return NextResponse.redirect(`${base}/overview`);
  try {
    const url = await startSocialConnect({ userId: user.id, workspaceId, platform });
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = e instanceof AppError ? e.userMessage : "Could not start the connection.";
    return NextResponse.redirect(`${base}/w/${ws.slug}/connections?error=${encodeURIComponent(msg)}`);
  }
}
