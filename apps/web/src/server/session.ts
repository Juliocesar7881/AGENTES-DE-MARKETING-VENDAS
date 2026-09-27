import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { memberRole, sessionUser, type SessionUser } from "@revenueos/core";
import { asc, eq, withUser, workspaces } from "@revenueos/database";
import "./boot";

export const SESSION_COOKIE = "rvos_session";

export type Workspace = typeof workspaces.$inferSelect;

/** Current user from the session cookie (validated against the database, once per request). */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return sessionUser(token);
});

export async function requireUser(): Promise<SessionUser> {
  let user: SessionUser | null;
  try {
    user = await getUser();
  } catch (e) {
    // Not installed yet (or the database is gone): send the browser to the installer/diagnostics.
    const { needsInstall } = await import("./install");
    if (await needsInstall().catch(() => true)) redirect("/install");
    throw e;
  }
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/overview");
  return user;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const secure = (process.env.APP_URL ?? "").startsWith("https://") || process.env.NODE_ENV === "production";
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "lax", path: "/", expires: expiresAt });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

/** Workspaces visible to the user — read through Row Level Security (database-enforced isolation). */
export const listWorkspaces = cache(async (): Promise<Workspace[]> => {
  const user = await requireUser();
  return withUser(user.id, (tx) => tx.select().from(workspaces).orderBy(asc(workspaces.createdAt)));
});

/** Resolves /w/[slug] for the current user. Another tenant's slug is indistinguishable from a missing one (404). */
export const requireWorkspace = cache(async (slug: string): Promise<{ user: SessionUser; ws: Workspace; role: "OWNER" | "ADMIN" | "MEMBER" }> => {
  const user = await requireUser();
  const rows = await withUser(user.id, (tx) => tx.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1));
  const ws = rows[0];
  if (!ws) notFound();
  const role = await memberRole(user.id, ws.id);
  if (!role) notFound();
  return { user, ws, role };
});
