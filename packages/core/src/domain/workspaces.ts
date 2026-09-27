import {
  agents,
  and,
  brandKits,
  businessProfiles,
  eq,
  products,
  socialAccounts,
  workspaceMembers,
  workspaces,
  type DbExecutor,
} from "@revenueos/database";
import {
  AGENT_ROLES,
  AuthorizationError,
  DEFAULT_AUTOPILOT_PERMISSIONS,
  DEFAULT_SALES_SETTINGS,
  RetentionSettingsSchema,
  slugify,
  type AutopilotPermissionKey,
  type FontFamily,
  type OperatingMode,
  type Platform,
  type ProductType,
  type WorkspaceEnvironment,
} from "@revenueos/shared";
import { randomBytes } from "node:crypto";
import { db } from "../deps";
import { emitEvent } from "../events";
import type { JobOrigin } from "../jobs/queue";
import type { Workspace } from "../providers";
import { saveCredential } from "../secrets";
import { audit, recordActivity } from "../records";

export interface CreateWorkspaceInput {
  name: string;
  industry: string;
  website?: string | null;
  description?: string;
  environment?: WorkspaceEnvironment;
  timezone?: string;
  postsPerDay?: number;
  postingSchedule?: string[];
  targetPlatforms?: Platform[];
  operatingMode?: OperatingMode;
  whatsappNumber?: string | null;
  color?: string;
  audience?: { targetAudience?: string; problems?: string[]; goals?: string[]; valueProposition?: string; differentiators?: string[] };
  brand?: Partial<{
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
    fontHeading: FontFamily;
    fontBody: FontFamily;
    tone: string;
    style: string;
    voice: string;
    handle: string;
    keywords: string[];
    forbiddenWords: string[];
    ctaPreferences: string[];
  }>;
  products?: { name: string; description?: string; priceCents: number; type?: ProductType; benefits?: string[]; features?: string[]; faq?: { q: string; a: string }[]; offer?: string; limitations?: string[] }[];
}

async function uniqueSlug(name: string, exec: DbExecutor): Promise<string> {
  const base = slugify(name) || "business";
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const rows = await exec.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
    if (!rows[0]) return slug;
  }
  return `${base}-${randomBytes(3).toString("hex")}`;
}

/**
 * Creates a fully initialized workspace (business profile, brand kit, five
 * agents, safe defaults: 2 posts/day, buffer 4, max 4 generated/day). The
 * creator becomes OWNER. DEMO workspaces also get clearly-labeled mock
 * social accounts.
 */
export async function createWorkspace(input: CreateWorkspaceInput, userId: string): Promise<Workspace> {
  return db().transaction(async (tx) => {
    const slug = await uniqueSlug(input.name, tx);
    const environment = input.environment ?? "LIVE";
    const schedule = input.postingSchedule?.length ? input.postingSchedule : ["09:00", "18:00"];
    const postsPerDay = input.postsPerDay ?? schedule.length;
    const mode = input.operatingMode ?? "ASSISTED";
    const [ws] = await tx
      .insert(workspaces)
      .values({
        name: input.name,
        slug,
        industry: input.industry,
        website: input.website ?? null,
        description: input.description ?? "",
        environment,
        color: input.color ?? input.brand?.primaryColor ?? "#2EE6A6",
        operatingMode: mode,
        autopilotEnabled: mode === "AUTOPILOT",
        autopilotPermissions: DEFAULT_AUTOPILOT_PERMISSIONS,
        timezone: input.timezone ?? "America/Sao_Paulo",
        postsPerDay,
        postingSchedule: schedule.slice(0, Math.max(1, postsPerDay)),
        targetReadyBuffer: 4,
        maxContentGeneratedPerDay: 4,
        maxContentPublishedPerDay: Math.max(2, postsPerDay),
        targetPlatforms: input.targetPlatforms?.length ? input.targetPlatforms : ["INSTAGRAM", "TIKTOK", "YOUTUBE"],
        salesSettings: DEFAULT_SALES_SETTINGS,
        retention: RetentionSettingsSchema.parse({}),
        whatsappNumber: input.whatsappNumber ?? null,
        createdBy: userId,
      })
      .returning();
    const w = ws!;
    await tx.insert(workspaceMembers).values({ workspaceId: w.id, userId, role: "OWNER" });
    await tx.insert(businessProfiles).values({
      workspaceId: w.id,
      targetAudience: input.audience?.targetAudience ?? "",
      problems: input.audience?.problems ?? [],
      goals: input.audience?.goals ?? [],
      valueProposition: input.audience?.valueProposition ?? "",
      differentiators: input.audience?.differentiators ?? [],
      keywords: input.brand?.keywords ?? [],
    });
    await tx.insert(brandKits).values({
      workspaceId: w.id,
      businessName: input.name,
      website: input.website ?? null,
      description: input.description ?? "",
      targetAudience: input.audience?.targetAudience ?? "",
      ...(input.brand ?? {}),
    });
    await tx.insert(agents).values(AGENT_ROLES.map((role) => ({ workspaceId: w.id, role })));
    for (const [i, p] of (input.products ?? []).entries()) {
      await tx.insert(products).values({
        workspaceId: w.id,
        name: p.name,
        slug: `${slugify(p.name) || "product"}-${i + 1}`,
        description: p.description ?? "",
        priceCents: p.priceCents,
        type: p.type ?? "DIGITAL",
        benefits: p.benefits ?? [],
        features: p.features ?? [],
        faq: p.faq ?? [],
        limitations: p.limitations ?? [],
        offer: p.offer ?? "",
        sort: i,
      });
    }
    if (environment === "DEMO") {
      for (const platform of w.targetPlatforms) {
        const [acc] = await tx
          .insert(socialAccounts)
          .values({
            workspaceId: w.id,
            platform,
            externalAccountId: `mock_${platform.toLowerCase()}_${w.slug}`,
            username: `${w.slug.replace(/-/g, "")}.demo`,
            displayName: `${w.name} (DEMO)`,
            status: "CONNECTED",
            scopes: ["demo"],
            isDemo: true,
            connectedBy: userId,
            tokenExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
          })
          .returning();
        await saveCredential({ workspaceId: w.id, socialAccountId: acc!.id }, "ACCESS_TOKEN", `mock-token-${acc!.id}`, null, tx);
      }
    }
    await emitEvent({ type: "WORKSPACE_CREATED", workspaceId: w.id, idempotencyKey: `workspace_created:${w.id}`, payload: { name: w.name } }, tx);
    await recordActivity({ workspaceId: w.id, type: "WORKSPACE_CREATED", title: `Workspace ${w.name} created`, actorType: "USER", actorId: userId }, tx);
    await audit({ workspaceId: w.id, actorType: "USER", actorId: userId, action: "workspace.create", entityType: "workspace", entityId: w.id, details: { environment } }, tx);
    return w;
  });
}

export async function getWorkspace(id: string, exec: DbExecutor = db()): Promise<Workspace> {
  const rows = await exec.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  if (!rows[0]) throw new AuthorizationError("Workspace not found.");
  return rows[0];
}

export async function assertMember(userId: string, workspaceId: string): Promise<void> {
  const rows = await db()
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);
  if (!rows[0]) throw new AuthorizationError();
}

export type PolicyDecision = "ALLOW" | "APPROVAL" | "DENY";

/**
 * Single place where operating modes and autopilot permissions are enforced.
 * MANUAL: nothing automatic. ASSISTED: AI creates, humans approve publishing
 * and checkout links. AUTOPILOT: acts alone within the enabled permissions.
 * Human-initiated actions are always allowed (the human is the approval).
 */
export function policy(ws: Pick<Workspace, "operatingMode" | "autopilotPermissions" | "status">, action: AutopilotPermissionKey, origin: JobOrigin): PolicyDecision {
  if (origin === "HUMAN" || origin === "SIMULATION") return "ALLOW";
  if (ws.status !== "ACTIVE") return "DENY";
  if (ws.operatingMode === "MANUAL") return "DENY";
  const allowed = ws.autopilotPermissions[action] !== false;
  const approvalActions: AutopilotPermissionKey[] = ["publishContent", "sendCheckout"];
  if (!allowed) return approvalActions.includes(action) ? "APPROVAL" : "DENY";
  if (ws.operatingMode === "ASSISTED" && approvalActions.includes(action)) return "APPROVAL";
  return "ALLOW";
}

export async function setOperatingMode(workspaceId: string, mode: OperatingMode, userId: string): Promise<void> {
  await db().update(workspaces).set({ operatingMode: mode, autopilotEnabled: mode === "AUTOPILOT" }).where(eq(workspaces.id, workspaceId));
  await audit({ workspaceId, actorType: "USER", actorId: userId, action: "workspace.mode", details: { mode } });
  await recordActivity({ workspaceId, type: "MODE_CHANGED", title: `Operating mode set to ${mode}`, actorType: "USER", actorId: userId });
}
