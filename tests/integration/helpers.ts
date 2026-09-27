import { randomUUID } from "node:crypto";
import { configureCore, createWorkspace, JobRunner, registerCoreHandlers, runCreative, runStrategyPlan, simulateRender, storeSocialCredentials, type CoreOverrides } from "@revenueos/core";
import { getDb, profiles, socialAccounts } from "@revenueos/database";
import { MockAIProvider, type AIProvider } from "@revenueos/providers/ai";
import { MockMessagingProvider, type MessagingProvider } from "@revenueos/providers/messaging";
import { MockPaymentProvider, type PaymentProvider } from "@revenueos/providers/payment";
import { MockSocialProvider, type SocialProvider } from "@revenueos/providers/social";
import type { Platform } from "@revenueos/shared";
import { hashPassword } from "@revenueos/shared/server";

/**
 * Test doubles for EXTERNAL platforms only (Claude, Instagram, TikTok, WhatsApp,
 * payment provider). Everything else — database, RLS, jobs, orchestrator,
 * attribution — is the real code.
 */
export const doubles: {
  ai: AIProvider;
  social: Partial<Record<Platform, SocialProvider>>;
  messaging: MessagingProvider;
  payment: PaymentProvider;
} = {
  ai: new MockAIProvider(),
  social: {},
  messaging: new MockMessagingProvider("WHATSAPP"),
  payment: new MockPaymentProvider("test-mock-secret", "http://localhost:3999"),
};

export function useDoubles(): void {
  const overrides: CoreOverrides = {
    ai: () => doubles.ai,
    social: ({ platform }) => doubles.social[platform] ?? new MockSocialProvider({ platform }),
    messaging: () => doubles.messaging,
    payment: () => doubles.payment,
  };
  configureCore({ overrides, runnerId: "test-runner" });
  registerCoreHandlers();
}

export function runner(): JobRunner {
  return new JobRunner({ runnerId: `test-${randomUUID().slice(0, 6)}`, runners: ["LOCAL", "ANY"], concurrency: { ai: 2, io: 4, render: 1 } });
}

export async function makeUser(prefix = "u") {
  const [u] = await getDb()
    .insert(profiles)
    .values({ email: `${prefix}-${randomUUID()}@test.dev`, name: prefix, passwordHash: await hashPassword("password-123456") })
    .returning();
  return u!;
}

/** A LIVE business with connected (test-double) Instagram and TikTok accounts. */
export async function makeLiveBusiness(name: string, opts: { mode?: "MANUAL" | "ASSISTED" | "AUTOPILOT" } = {}) {
  const user = await makeUser(name.toLowerCase().replace(/\W/g, ""));
  const ws = await createWorkspace(
    {
      name,
      industry: "servicos",
      operatingMode: opts.mode ?? "AUTOPILOT",
      targetPlatforms: ["INSTAGRAM", "TIKTOK"],
      whatsappNumber: "5511999990000",
      products: [{ name: `${name} Plano`, priceCents: 9900, description: "Plano mensal", benefits: ["Atendimento rápido"] }],
    },
    user.id,
  );
  for (const platform of ["INSTAGRAM", "TIKTOK"] as const) {
    const [acc] = await getDb()
      .insert(socialAccounts)
      .values({ workspaceId: ws.id, platform, externalAccountId: `${platform}-${randomUUID().slice(0, 8)}`, username: `${name}_${platform}`.toLowerCase(), status: "CONNECTED", scopes: ["publish"], isDemo: false })
      .returning();
    await storeSocialCredentials(acc!, { accessToken: `token-${randomUUID()}`, expiresAt: new Date(Date.now() + 30 * 86400_000) });
  }
  return { user, ws };
}

/** Strategy + creative through the real pipeline (test-double Claude), then a simulated render. */
export async function makeReadyContent(ws: Awaited<ReturnType<typeof makeLiveBusiness>>["ws"], count = 1): Promise<string[]> {
  const plan = await runStrategyPlan(ws, { count, jobId: randomUUID(), origin: "HUMAN" });
  for (const id of plan.contentIds) {
    await runCreative(ws, id, { jobId: randomUUID(), origin: "HUMAN" });
    await simulateRender(id);
  }
  return plan.contentIds;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
