import { and, authSessions, count, eq, gt, lt, profiles, rateLimits, sql, workspaceMembers } from "@revenueos/database";
import { AppError, ValidationError } from "@revenueos/shared";
import { hashPassword, randomToken, sha256Hex, verifyPassword } from "@revenueos/shared/server";
import { z } from "zod";
import { getConfig } from "../config";
import { db, now } from "../deps";
import { audit } from "../records";

export const SESSION_TTL_DAYS = 30;
const SESSION_TOUCH_MS = 10 * 60 * 1000;

export type SessionUser = Omit<typeof profiles.$inferSelect, "passwordHash">;

export const SignUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid e-mail").max(200),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid e-mail").max(200),
  password: z.string().min(1, "Enter your password").max(200),
});

/**
 * Fixed-window rate limiter backed by Postgres (works on serverless and on a
 * single machine). Throws a user-friendly 429 AppError when exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const t = now();
  const windowStart = new Date(Math.floor(t.getTime() / (windowSec * 1000)) * windowSec * 1000);
  const rows = (await db().execute(sql`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start = EXCLUDED.window_start THEN rate_limits.count + 1 ELSE 1 END,
      window_start = EXCLUDED.window_start
    RETURNING count
  `)) as unknown as { count: number }[];
  const n = Number(rows[0]?.count ?? 0);
  if (n > limit) {
    const retryAfterSec = Math.max(1, Math.ceil((windowStart.getTime() + windowSec * 1000 - t.getTime()) / 1000));
    throw new AppError({ code: "RATE_LIMITED", userMessage: `Too many attempts. Try again in ${retryAfterSec}s.`, httpStatus: 429, retryable: true, retryAfterSec });
  }
}

export async function purgeRateLimits(): Promise<void> {
  await db().delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now().getTime() - 24 * 3600 * 1000)));
}

export async function userCount(): Promise<number> {
  const [r] = await db().select({ n: count() }).from(profiles).where(eq(profiles.isDemo, false));
  return Number(r?.n ?? 0);
}

function strip(p: typeof profiles.$inferSelect): SessionUser {
  const { passwordHash: _omit, ...rest } = p;
  return rest;
}

/** The first real account becomes the system admin (integrations, AI settings, worker). */
export async function signUp(input: unknown, meta: { ip: string }): Promise<SessionUser> {
  await rateLimit(`signup:${sha256Hex(meta.ip).slice(0, 16)}`, 5, 3600);
  const data = SignUpSchema.parse(input);
  const existing = await db().select({ id: profiles.id }).from(profiles).where(eq(profiles.email, data.email)).limit(1);
  if (existing[0]) throw new ValidationError("An account with this e-mail already exists. Sign in instead.");
  const first = (await userCount()) === 0;
  const [user] = await db()
    .insert(profiles)
    .values({ email: data.email, name: data.name, passwordHash: await hashPassword(data.password), isAdmin: first })
    .returning();
  await audit({ workspaceId: null, actorType: "USER", actorId: user!.id, action: "auth.signup", details: { admin: first } });
  return strip(user!);
}

export async function createSession(userId: string, meta: { userAgent?: string | null; ip?: string | null }): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(now().getTime() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
  await db()
    .insert(authSessions)
    .values({ userId, tokenHash: sha256Hex(token), expiresAt, userAgent: meta.userAgent?.slice(0, 300) ?? null, ipHash: meta.ip ? sha256Hex(meta.ip).slice(0, 32) : null });
  await db().update(profiles).set({ lastLoginAt: now() }).where(eq(profiles.id, userId));
  return { token, expiresAt };
}

export async function login(input: unknown, meta: { ip: string; userAgent?: string | null }): Promise<{ token: string; expiresAt: Date; user: SessionUser }> {
  const data = LoginSchema.parse(input);
  await rateLimit(`login:${sha256Hex(meta.ip).slice(0, 16)}`, 20, 900);
  await rateLimit(`login-email:${sha256Hex(data.email).slice(0, 16)}`, 8, 900);
  const [user] = await db().select().from(profiles).where(eq(profiles.email, data.email)).limit(1);
  // Always run a hash comparison to keep timing similar for unknown e-mails.
  const ok = user ? await verifyPassword(data.password, user.passwordHash) : await verifyPassword(data.password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!user || !ok) throw new AppError({ code: "INVALID_LOGIN", userMessage: "E-mail or password is incorrect.", httpStatus: 401 });
  if (user.isDemo) throw new AppError({ code: "DEMO_LOGIN", userMessage: "Use the “Explore Demo” button to open the demo.", httpStatus: 400 });
  const session = await createSession(user.id, meta);
  await audit({ workspaceId: null, actorType: "USER", actorId: user.id, action: "auth.login", details: {} });
  return { ...session, user: strip(user) };
}

/** Resolves a session cookie. Sliding expiry is refreshed at most every 10 minutes. */
export async function sessionUser(token: string | null | undefined): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const rows = await db()
    .select({ s: authSessions, u: profiles })
    .from(authSessions)
    .innerJoin(profiles, eq(profiles.id, authSessions.userId))
    .where(and(eq(authSessions.tokenHash, sha256Hex(token)), gt(authSessions.expiresAt, now())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (now().getTime() - row.s.lastSeenAt.getTime() > SESSION_TOUCH_MS) {
    await db()
      .update(authSessions)
      .set({ lastSeenAt: now(), expiresAt: new Date(now().getTime() + SESSION_TTL_DAYS * 24 * 3600 * 1000) })
      .where(eq(authSessions.id, row.s.id));
  }
  return strip(row.u);
}

export async function logout(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await db().delete(authSessions).where(eq(authSessions.tokenHash, sha256Hex(token)));
}

export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  const [user] = await db().select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (!user || user.isDemo) throw new AppError({ code: "FORBIDDEN", userMessage: "Not allowed for this account.", httpStatus: 403 });
  if (!(await verifyPassword(current, user.passwordHash))) throw new ValidationError("Current password is incorrect.");
  if (next.length < 10) throw new ValidationError("Use at least 10 characters.");
  await db().update(profiles).set({ passwordHash: await hashPassword(next) }).where(eq(profiles.id, userId));
  await db().delete(authSessions).where(eq(authSessions.userId, userId));
  await audit({ workspaceId: null, actorType: "USER", actorId: userId, action: "auth.password_changed", details: {} });
}

/** "Explore Demo": signs in as the shared demo user (DEMO workspaces only). Disabled with DEMO_MODE_ENABLED=false. */
export async function demoLogin(meta: { ip: string; userAgent?: string | null }): Promise<{ token: string; expiresAt: Date }> {
  if (!getConfig().demoEnabled) throw new AppError({ code: "DEMO_DISABLED", userMessage: "Demo mode is disabled on this installation.", httpStatus: 403 });
  await rateLimit(`demo:${sha256Hex(meta.ip).slice(0, 16)}`, 30, 3600);
  // First visit on a fresh install: create the 3 demo businesses and simulate one day so the dashboard is alive.
  const { seedDemo } = await import("../demo/seed");
  const r = await seedDemo({ simulate: true });
  return createSession(r.userId, meta);
}

export async function userWorkspaceIds(userId: string): Promise<string[]> {
  const rows = await db().select({ id: workspaceMembers.workspaceId }).from(workspaceMembers).where(eq(workspaceMembers.userId, userId));
  return rows.map((r) => r.id);
}

export async function memberRole(userId: string, workspaceId: string): Promise<"OWNER" | "ADMIN" | "MEMBER" | null> {
  const [r] = await db()
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);
  return r?.role ?? null;
}
