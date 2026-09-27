import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { assertMember, createWorkspace, resolveAI, saveCredential, socialProviderFor, startSocialConnect, upsertIntegration } from "@revenueos/core";
import { eq, getDb, leads, products, profiles, sql, withUser, workspaces } from "@revenueos/database";
import { hashPassword } from "@revenueos/shared/server";

/** Drizzle wraps driver errors ("Failed query…"); the Postgres reason is in `cause`. */
const denied = (e: unknown) => /permission denied/.test(String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message));

async function user(email: string) {
  const [u] = await getDb().insert(profiles).values({ email, name: email.split("@")[0]!, passwordHash: await hashPassword("password-123456") }).returning();
  return u!;
}

describe("tenant isolation (Row Level Security)", () => {
  let a: Awaited<ReturnType<typeof user>>;
  let b: Awaited<ReturnType<typeof user>>;
  let wsA: Awaited<ReturnType<typeof createWorkspace>>;
  let wsB: Awaited<ReturnType<typeof createWorkspace>>;

  beforeAll(async () => {
    a = await user(`a-${randomUUID()}@test.dev`);
    b = await user(`b-${randomUUID()}@test.dev`);
    wsA = await createWorkspace({ name: "Alpha Store", industry: "retail", products: [{ name: "Alpha Kit", priceCents: 1000 }] }, a.id);
    wsB = await createWorkspace({ name: "Beta Clinic", industry: "health", products: [{ name: "Beta Consult", priceCents: 2000 }] }, b.id);
    await getDb().insert(leads).values({ workspaceId: wsB.id, name: "Secret Lead", phone: "5511988887777", contactKey: `whatsapp:${randomUUID()}` });
  });

  it("a user only sees their own workspaces", async () => {
    const rows = await withUser(a.id, (tx) => tx.select({ id: workspaces.id }).from(workspaces));
    expect(rows.map((r) => r.id)).toEqual([wsA.id]);
  });

  it("another tenant's rows are invisible even when queried by id", async () => {
    const rows = await withUser(a.id, (tx) => tx.select().from(leads).where(eq(leads.workspaceId, wsB.id)));
    expect(rows).toHaveLength(0);
    const p = await withUser(a.id, (tx) => tx.select().from(products).where(eq(products.workspaceId, wsB.id)));
    expect(p).toHaveLength(0);
  });

  it("cross-tenant updates affect nothing and inserts are rejected", async () => {
    const upd = await withUser(a.id, (tx) => tx.update(products).set({ priceCents: 1 }).where(eq(products.workspaceId, wsB.id)).returning());
    expect(upd).toHaveLength(0);
    const [still] = await getDb().select().from(products).where(eq(products.workspaceId, wsB.id));
    expect(still!.priceCents).toBe(2000);
    await expect(withUser(a.id, (tx) => tx.insert(leads).values({ workspaceId: wsB.id, name: "Injected" }))).rejects.toThrow();
  });

  it("secrets, sessions and password hashes are not reachable by the app role", async () => {
    await expect(withUser(a.id, (tx) => tx.execute(sql`select * from secrets`))).rejects.toSatisfy(denied);
    await expect(withUser(a.id, (tx) => tx.execute(sql`select * from auth_sessions`))).rejects.toSatisfy(denied);
    await expect(withUser(a.id, (tx) => tx.execute(sql`select password_hash from profiles`))).rejects.toSatisfy(denied);
    const me = await withUser(a.id, (tx) => tx.execute(sql`select id, email from profiles`));
    expect((me as unknown as { id: string }[]).map((r) => r.id)).toEqual([a.id]);
  });

  it("server-side membership checks block cross-tenant actions", async () => {
    await expect(assertMember(a.id, wsB.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startSocialConnect({ userId: a.id, workspaceId: wsB.id, platform: "INSTAGRAM" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("credentials are stored encrypted, never in plain text", async () => {
    const integ = await upsertIntegration("whatsapp", wsA.id, { config: { phoneNumberId: "123456" } });
    await saveCredential({ workspaceId: wsA.id, integrationId: integ.id }, "ACCESS_TOKEN", "EAAsupersecrettoken1234567890");
    const raw = (await getDb().execute(sql`select ciphertext from secrets`)) as unknown as { ciphertext: string }[];
    expect(raw.length).toBeGreaterThan(0);
    expect(JSON.stringify(raw)).not.toContain("supersecret");
  });
});

describe("production never silently falls back to mocks", () => {
  it("LIVE workspaces require real Claude and real platform apps", async () => {
    const u = await user(`c-${randomUUID()}@test.dev`);
    const live = await createWorkspace({ name: "Live Biz", industry: "services" }, u.id);
    await expect(resolveAI(live, "creative")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(socialProviderFor("INSTAGRAM", { workspaceId: live.id, isDemo: false })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    const demo = await createWorkspace({ name: "Demo Biz", industry: "services", environment: "DEMO" }, u.id);
    const ai = await resolveAI(demo, "creative");
    expect(ai.isMock).toBe(true);
  });
});
