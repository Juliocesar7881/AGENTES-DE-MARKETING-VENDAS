"use server";
import { revalidatePath } from "next/cache";
import {
  createWorkspace,
  requestContent,
  setAgentPaused,
  setOperatingMode,
  setWorkspaceStatus,
  simulateDay,
  updateAutopilotPermissions,
  updateBrandKit,
  updateBusinessProfile,
  updateRetention,
  updateSalesSettings,
  updateWorkspaceBudget,
  updateWorkspaceGeneral,
  updateWorkspaceScheduling,
  assertMember,
  getWorkspace,
  saveProduct,
  analyzeWebsite,
  type CreateWorkspaceInput,
} from "@revenueos/core";
import { AuthorizationError, OPERATING_MODES, type AgentRole, type OperatingMode } from "@revenueos/shared";
import { z } from "zod";
import { run } from "../action";
import { kick } from "../runner";
import { requireUser } from "../session";

async function member(workspaceId: string) {
  const user = await requireUser();
  await assertMember(user.id, workspaceId);
  const ws = await getWorkspace(workspaceId);
  return { user, ws };
}

function refresh(slug: string) {
  revalidatePath(`/w/${slug}`, "layout");
  revalidatePath("/overview");
}

export async function requestContentAction(workspaceId: string, input: { count: number; focus?: string | null; publishAsap?: boolean }) {
  return run(async () => {
    const { user, ws } = await member(workspaceId);
    const id = await requestContent(workspaceId, user.id, input);
    refresh(ws.slug);
    return { jobId: id };
  }, "Content requested — the Strategist is planning it (the local worker generates and renders).");
}

export async function setWorkspaceStatusAction(workspaceId: string, status: "ACTIVE" | "PAUSED") {
  return run(async () => {
    const { user, ws } = await member(workspaceId);
    await setWorkspaceStatus(workspaceId, user.id, status);
    refresh(ws.slug);
    return null;
  }, status === "PAUSED" ? "Business paused" : "Business resumed");
}

export async function setModeAction(workspaceId: string, mode: OperatingMode) {
  return run(async () => {
    if (!OPERATING_MODES.includes(mode)) throw new AuthorizationError("Unknown mode.");
    const { user, ws } = await member(workspaceId);
    await setOperatingMode(workspaceId, mode, user.id);
    refresh(ws.slug);
    revalidatePath("/autopilot");
    return null;
  }, `Mode set to ${mode.toLowerCase()}`);
}

export async function setAgentPausedAction(workspaceId: string, role: AgentRole, paused: boolean) {
  return run(async () => {
    const { user, ws } = await member(workspaceId);
    await setAgentPaused(workspaceId, role, paused, user.id);
    refresh(ws.slug);
    revalidatePath("/agents");
    return null;
  }, paused ? "Agent paused" : "Agent resumed");
}

export async function simulateWorkspaceDayAction(workspaceId: string) {
  return run(async () => {
    const { user, ws } = await member(workspaceId);
    if (ws.environment !== "DEMO") throw new AuthorizationError("Simulate Day only runs on DEMO businesses.");
    const r = await simulateDay({ workspaceIds: [workspaceId], contentsPerWorkspace: 2, userId: user.id });
    refresh(ws.slug);
    return r;
  });
}

type Section = "general" | "scheduling" | "sales" | "retention" | "permissions" | "budget" | "brand" | "business";

export async function updateWorkspaceSection(workspaceId: string, section: Section, input: unknown) {
  return run(async () => {
    const { user, ws } = await member(workspaceId);
    const fn = {
      general: updateWorkspaceGeneral,
      scheduling: updateWorkspaceScheduling,
      sales: updateSalesSettings,
      retention: updateRetention,
      permissions: updateAutopilotPermissions,
      budget: updateWorkspaceBudget,
      brand: updateBrandKit,
      business: updateBusinessProfile,
    }[section];
    await fn(workspaceId, user.id, input);
    refresh(ws.slug);
    if (section === "general") revalidatePath("/", "layout");
    return null;
  }, "Saved");
}

export async function saveProductAction(workspaceId: string, input: unknown, productId?: string | null) {
  return run(async () => {
    const { user, ws } = await member(workspaceId);
    const id = await saveProduct(workspaceId, user.id, input, productId);
    refresh(ws.slug);
    return { id };
  }, "Product saved");
}

const OnboardingSchema = z.object({
  name: z.string().trim().min(2).max(80),
  industry: z.string().trim().max(80).default(""),
  website: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().max(2000).default(""),
  environment: z.enum(["LIVE", "DEMO"]).default("LIVE"),
  timezone: z.string().default("America/Sao_Paulo"),
  postsPerDay: z.number().int().min(1).max(6).default(2),
  postingSchedule: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(6),
  postingMode: z.enum(["smart", "fixed", "asap"]).default("smart"),
  targetPlatforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"])).min(1),
  operatingMode: z.enum(OPERATING_MODES).default("ASSISTED"),
  whatsappNumber: z.string().trim().max(20).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6D5BFF"),
  audience: z.object({ targetAudience: z.string().max(1000).default(""), problems: z.array(z.string().max(300)).max(20).default([]), goals: z.array(z.string().max(300)).max(20).default([]), valueProposition: z.string().max(1000).default(""), differentiators: z.array(z.string().max(300)).max(20).default([]) }),
  brand: z.object({
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    fontHeading: z.string(),
    fontBody: z.string(),
    tone: z.string().max(200),
    handle: z.string().max(60).optional(),
    keywords: z.array(z.string().max(80)).max(30).default([]),
    forbiddenWords: z.array(z.string().max(80)).max(50).default([]),
  }),
  products: z.array(z.object({ name: z.string().trim().min(2).max(120), description: z.string().max(2000).default(""), priceCents: z.number().int().min(0), type: z.enum(["DIGITAL", "SERVICE", "PHYSICAL", "SUBSCRIPTION", "COURSE", "APPOINTMENT"]).default("SERVICE"), benefits: z.array(z.string().max(300)).max(20).default([]), offer: z.string().max(500).default("") })).max(20),
});

export async function createBusinessAction(input: unknown) {
  return run(async () => {
    const user = await requireUser();
    if (user.isDemo) throw new AuthorizationError("The demo account cannot create businesses. Create your own account to start.");
    const d = OnboardingSchema.parse(input);
    const ws = await createWorkspace({ ...d, website: d.website || null, whatsappNumber: d.whatsappNumber?.replace(/\D/g, "") || null, brand: d.brand as CreateWorkspaceInput["brand"] }, user.id);
    revalidatePath("/", "layout");
    kick([ws.id]);
    return { slug: ws.slug, id: ws.id };
  }, "Business created");
}

/** Website analyzer (SSRF-protected fetch, public pages only). AI summary only when Claude is configured. */
export async function analyzeWebsiteAction(url: string, workspaceId?: string | null) {
  return run(async () => {
    const user = await requireUser();
    let ws: { id: string; environment: "LIVE" | "DEMO" } | null = null;
    if (workspaceId) {
      await assertMember(user.id, workspaceId);
      const w = await getWorkspace(workspaceId);
      ws = { id: w.id, environment: w.environment };
    }
    return analyzeWebsite(url, { useAI: true, workspace: ws });
  });
}

export async function deleteAssetAction(workspaceId: string, assetId: string) {
  return run(async () => {
    const { user, ws } = await member(workspaceId);
    const { brandAssets, brandKits, and, eq, withUser } = await import("@revenueos/database");
    const [a] = await withUser(user.id, (tx) => tx.select().from(brandAssets).where(and(eq(brandAssets.id, assetId), eq(brandAssets.workspaceId, workspaceId))).limit(1));
    if (!a) throw new AuthorizationError("Asset not found.");
    await withUser(user.id, async (tx) => {
      await tx.update(brandKits).set({ logoAssetId: null }).where(and(eq(brandKits.workspaceId, workspaceId), eq(brandKits.logoAssetId, assetId)));
      await tx.update(brandKits).set({ iconAssetId: null }).where(and(eq(brandKits.workspaceId, workspaceId), eq(brandKits.iconAssetId, assetId)));
      await tx.delete(brandAssets).where(eq(brandAssets.id, assetId));
    });
    const { storage } = await import("@revenueos/core");
    await storage().delete(a.storageKey).catch(() => undefined);
    if (a.thumbnailKey) await storage().delete(a.thumbnailKey).catch(() => undefined);
    refresh(ws.slug);
    return null;
  }, "Asset deleted");
}

/** Captures a website screenshot on the local worker (SSRF-guarded browser) and adds it as a brand asset. */
export async function screenshotAction(workspaceId: string, url: string) {
  return run(async () => {
    const { ws } = await member(workspaceId);
    const { assertPublicUrl } = await import("@revenueos/shared/server");
    await assertPublicUrl(url);
    const { enqueueJob } = await import("@revenueos/core");
    await enqueueJob({ type: "WEBSITE_SCREENSHOT", workspaceId, payload: { url }, origin: "HUMAN", idempotencyKey: `screenshot:${workspaceId}:${url}:${new Date().toISOString().slice(0, 13)}` });
    refresh(ws.slug);
    return null;
  }, "Screenshot queued on the local worker");
}
