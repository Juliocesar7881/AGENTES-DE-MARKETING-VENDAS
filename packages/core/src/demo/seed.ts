import { and, eq, profiles, workspaceMembers, workspaces } from "@revenueos/database";
import { hashPassword } from "@revenueos/shared/server";
import { createWorkspace } from "../domain/workspaces";
import { db } from "../deps";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_WORKSPACES } from "./data";

export interface SeedResult {
  userId: string;
  email: string;
  password: string;
  workspaces: { id: string; slug: string; name: string }[];
  created: boolean;
}

/** Creates (idempotently) the demo account and the three DEMO businesses. */
export async function ensureDemoAccount(): Promise<SeedResult> {
  let [user] = await db().select().from(profiles).where(eq(profiles.email, DEMO_EMAIL)).limit(1);
  let created = false;
  if (!user) {
    [user] = await db()
      .insert(profiles)
      .values({ email: DEMO_EMAIL, name: "Demo Owner", passwordHash: await hashPassword(DEMO_PASSWORD), isDemo: true, isAdmin: false })
      .onConflictDoNothing()
      .returning();
    if (!user) [user] = await db().select().from(profiles).where(eq(profiles.email, DEMO_EMAIL)).limit(1);
    created = true;
  }
  const out: SeedResult["workspaces"] = [];
  for (const input of DEMO_WORKSPACES) {
    const existing = await db()
      .select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name })
      .from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(and(eq(workspaceMembers.userId, user!.id), eq(workspaces.name, input.name), eq(workspaces.environment, "DEMO")))
      .limit(1);
    if (existing[0]) {
      out.push(existing[0]);
      continue;
    }
    const ws = await createWorkspace(input, user!.id);
    out.push({ id: ws.id, slug: ws.slug, name: ws.name });
    created = true;
  }
  return { userId: user!.id, email: DEMO_EMAIL, password: DEMO_PASSWORD, workspaces: out, created };
}

/** Seed + (optionally) one simulated day so the dashboard is alive on first open. */
export async function seedDemo(opts: { simulate?: boolean } = {}): Promise<SeedResult> {
  const result = await ensureDemoAccount();
  if (opts.simulate && result.created) {
    const { simulateDay } = await import("./simulate");
    await simulateDay({ workspaceIds: result.workspaces.map((w) => w.id), contentsPerWorkspace: 2, userId: result.userId });
  }
  return result;
}
