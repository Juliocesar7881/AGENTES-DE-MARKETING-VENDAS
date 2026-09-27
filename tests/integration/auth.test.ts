import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { changePassword, demoLogin, login, logout, sessionUser, signUp, userCount, userWorkspaceIds } from "@revenueos/core";
import { authSessions, eq, getDb, inArray, profiles, workspaces } from "@revenueos/database";

const ip = () => `198.51.100.${Math.floor(Math.random() * 250)}-${randomUUID().slice(0, 4)}`;
const email = () => `auth-${randomUUID().slice(0, 8)}@test.dev`;

describe("authentication and sessions", () => {
  it("only the very first real account becomes admin; passwords are stored hashed", async () => {
    const before = await userCount();
    const a = await signUp({ name: "Primeira", email: email(), password: "correct horse battery" }, { ip: ip() });
    const b = await signUp({ name: "Segunda", email: email(), password: "correct horse battery" }, { ip: ip() });
    expect(a.isAdmin).toBe(before === 0);
    expect(b.isAdmin).toBe(false);
    expect("passwordHash" in a).toBe(false);
    const [row] = await getDb().select().from(profiles).where(eq(profiles.id, b.id));
    expect(row!.passwordHash).toMatch(/^scrypt\$/);
    expect(row!.passwordHash).not.toContain("correct horse");
  });

  it("rejects duplicate e-mails and weak passwords", async () => {
    const e = email();
    await signUp({ name: "Dup", email: e, password: "long-enough-pass" }, { ip: ip() });
    await expect(signUp({ name: "Dup", email: e.toUpperCase(), password: "long-enough-pass" }, { ip: ip() })).rejects.toThrow(/already exists/);
    await expect(signUp({ name: "Weak", email: email(), password: "123" }, { ip: ip() })).rejects.toThrow();
  });

  it("login issues an opaque session token (only its hash is stored); logout revokes it", async () => {
    const e = email();
    const u = await signUp({ name: "Login", email: e, password: "a-good-password" }, { ip: ip() });
    await expect(login({ email: e, password: "wrong-password" }, { ip: ip() })).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    await expect(login({ email: "nobody-" + e, password: "whatever" }, { ip: ip() })).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    const s = await login({ email: e, password: "a-good-password" }, { ip: ip(), userAgent: "vitest" });
    expect(s.token.length).toBeGreaterThanOrEqual(40);
    const stored = await getDb().select().from(authSessions).where(eq(authSessions.userId, u.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toBe(s.token);
    expect((await sessionUser(s.token))?.id).toBe(u.id);
    expect(await sessionUser("x".repeat(43))).toBeNull();
    await logout(s.token);
    expect(await sessionUser(s.token)).toBeNull();
  });

  it("rate-limits repeated login attempts for the same e-mail", async () => {
    const e = email();
    await signUp({ name: "Brute", email: e, password: "a-good-password" }, { ip: ip() });
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      codes.push(await login({ email: e, password: `guess-${i}` }, { ip: ip() }).then(() => "OK", (err: { code: string }) => err.code));
    }
    expect(codes.slice(0, 8).every((c) => c === "INVALID_LOGIN")).toBe(true);
    expect(codes.slice(8)).toEqual(["RATE_LIMITED", "RATE_LIMITED"]);
  });

  it("changing the password revokes every existing session", async () => {
    const e = email();
    const u = await signUp({ name: "Change", email: e, password: "first-password" }, { ip: ip() });
    const s1 = await login({ email: e, password: "first-password" }, { ip: ip() });
    const s2 = await login({ email: e, password: "first-password" }, { ip: ip() });
    await expect(changePassword(u.id, "not-the-password", "second-password")).rejects.toThrow(/incorrect/);
    await changePassword(u.id, "first-password", "second-password");
    expect(await sessionUser(s1.token)).toBeNull();
    expect(await sessionUser(s2.token)).toBeNull();
    await expect(login({ email: e, password: "first-password" }, { ip: ip() })).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    expect((await login({ email: e, password: "second-password" }, { ip: ip() })).user.id).toBe(u.id);
  });

  it("Explore Demo signs in as the demo user, who can only see DEMO workspaces and cannot use a password", async () => {
    const s = await demoLogin({ ip: ip(), userAgent: "vitest" });
    const demo = await sessionUser(s.token);
    expect(demo?.isDemo).toBe(true);
    expect(demo?.isAdmin).toBe(false);
    const ids = await userWorkspaceIds(demo!.id);
    expect(ids.length).toBe(3);
    const rows = await getDb().select({ environment: workspaces.environment }).from(workspaces).where(inArray(workspaces.id, ids));
    expect(rows.every((r) => r.environment === "DEMO")).toBe(true);
    await expect(login({ email: demo!.email, password: "anything" }, { ip: ip() })).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_LOGIN|DEMO_LOGIN/) });
  }, 300_000);
});
