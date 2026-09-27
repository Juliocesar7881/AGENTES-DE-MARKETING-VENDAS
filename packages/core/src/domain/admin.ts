import {
  agents,
  and,
  brandKits,
  businessProfiles,
  eq,
  gt,
  isNull,
  leads,
  postingSlots,
  products,
  profiles,
  sql,
  workerInstances,
  workspaceMembers,
  workspaces,
} from "@revenueos/database";
import {
  AGENT_ROLES,
  AuthorizationError,
  AutopilotPermissionsSchema,
  AVAILABLE_FONTS,
  LEAD_STAGES,
  PRODUCT_TYPES,
  RetentionSettingsSchema,
  SalesSettingsSchema,
  slugify,
  ValidationError,
  WorkspaceSchedulingSchema,
  type AgentRole,
  type LeadStage,
} from "@revenueos/shared";
import { z } from "zod";
import { db, now } from "../deps";
import { enqueueJob } from "../jobs/queue";
import { audit, notify, recordActivity } from "../records";
import { getGlobalSettings, saveGlobalSettings } from "../settings";
import { ensureSlots } from "./content";
import { markDoNotContact, recomputeLeadScore } from "./leads";
import { assertMember, getWorkspace } from "./workspaces";

/* All functions here assume an authenticated user and re-check membership server-side. */

async function member(userId: string, workspaceId: string) {
  await assertMember(userId, workspaceId);
  return getWorkspace(workspaceId);
}

async function profile(userId: string) {
  const [p] = await db().select().from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (!p) throw new AuthorizationError("Unknown user.");
  return p;
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #1A2B3C");
const list = (max = 30) => z.array(z.string().trim().min(1).max(300)).max(max);

/* ─────────────────────────── Workspace settings ─────────────────────────── */

export const WorkspaceGeneralSchema = z.object({
  name: z.string().trim().min(2).max(80),
  industry: z.string().trim().max(80).default(""),
  website: z.string().trim().url().max(300).nullable().or(z.literal("")).transform((v) => v || null),
  description: z.string().trim().max(2000).default(""),
  color: hex,
  whatsappNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || (v.length >= 10 && v.length <= 15), "Use the full number with country code, e.g. 5511999999999")
    .transform((v) => v || null)
    .nullable(),
  currency: z.enum(["BRL", "USD", "EUR"]).default("BRL"),
});

export async function updateWorkspaceGeneral(workspaceId: string, userId: string, input: unknown): Promise<void> {
  await member(userId, workspaceId);
  const d = WorkspaceGeneralSchema.parse(input);
  await db().update(workspaces).set(d).where(eq(workspaces.id, workspaceId));
  await audit({ workspaceId, actorType: "USER", actorId: userId, action: "workspace.updated", details: { fields: Object.keys(d) } });
}

/** Posting schedule / buffer / platforms. Future empty slots are rebuilt from the new schedule. */
export async function updateWorkspaceScheduling(workspaceId: string, userId: string, input: unknown): Promise<void> {
  await member(userId, workspaceId);
  const d = WorkspaceSchedulingSchema.parse(input);
  if (d.postingSchedule.length < Math.min(d.postsPerDay, 12)) throw new ValidationError(`Add at least ${d.postsPerDay} posting times for ${d.postsPerDay} posts per day.`);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: d.timezone });
  } catch {
    throw new ValidationError("Unknown time zone.");
  }
  const sorted = [...new Set(d.postingSchedule)].sort();
  await db()
    .update(workspaces)
    .set({ ...d, postingSchedule: sorted })
    .where(eq(workspaces.id, workspaceId));
  await db().delete(postingSlots).where(and(eq(postingSlots.workspaceId, workspaceId), eq(postingSlots.status, "OPEN"), isNull(postingSlots.contentId), gt(postingSlots.scheduledFor, now())));
  await ensureSlots(await getWorkspace(workspaceId), 3);
  await audit({ workspaceId, actorType: "USER", actorId: userId, action: "workspace.scheduling", details: { ...d, postingSchedule: sorted } });
  await recordActivity({ workspaceId, type: "SCHEDULE_UPDATED", title: `Posting schedule updated: ${sorted.join(", ")} (${d.timezone})`, actorType: "USER", actorId: userId });
}

export async function updateSalesSettings(workspaceId: string, userId: string, input: unknown): Promise<void> {
  const ws = await member(userId, workspaceId);
  const d = SalesSettingsSchema.parse({ ...ws.salesSettings, ...(input as object) });
  await db().update(workspaces).set({ salesSettings: d }).where(eq(workspaces.id, workspaceId));
  await audit({ workspaceId, actorType: "USER", actorId: userId, action: "workspace.sales_settings", details: d as unknown as Record<string, unknown> });
}

export async function updateRetention(workspaceId: string, userId: string, input: unknown): Promise<void> {
  const ws = await member(userId, workspaceId);
  const d = RetentionSettingsSchema.parse({ ...ws.retention, ...(input as object) });
  await db().update(workspaces).set({ retention: d }).where(eq(workspaces.id, workspaceId));
  await audit({ workspaceId, actorType: "USER", actorId: userId, action: "workspace.retention", details: d as unknown as Record<string, unknown> });
}

export async function updateAutopilotPermissions(workspaceId: string, userId: string, input: unknown): Promise<void> {
  const ws = await member(userId, workspaceId);
  const d = AutopilotPermissionsSchema.parse({ ...ws.autopilotPermissions, ...(input as object) });
  await db().update(workspaces).set({ autopilotPermissions: d }).where(eq(workspaces.id, workspaceId));
  await audit({ workspaceId, actorType: "USER", actorId: userId, action: "workspace.autopilot_permissions", details: d as unknown as Record<string, unknown> });
  await recordActivity({ workspaceId, type: "AUTOPILOT_UPDATED", title: "Autopilot permissions updated", actorType: "USER", actorId: userId });
}

export const BudgetSchema = z.object({
  dailyAiBudgetUsd: z.number().min(0).max(10_000).nullable(),
  monthlyAiBudgetUsd: z.number().min(0).max(100_000).nullable(),
});

export async function updateWorkspaceBudget(workspaceId: string, userId: string, input: unknown): Promise<void> {
  await member(userId, workspaceId);
  const d = BudgetSchema.parse(input);
  await db().update(workspaces).set(d).where(eq(workspaces.id, workspaceId));
  await audit({ workspaceId, actorType: "USER", actorId: userId, action: "workspace.budget", details: d });
}

export async function setWorkspaceStatus(workspaceId: string, userId: string, status: "ACTIVE" | "PAUSED"): Promise<void> {
  await member(userId, workspaceId);
  await db().update(workspaces).set({ status }).where(eq(workspaces.id, workspaceId));
  await audit({ workspaceId, actorType: "USER", actorId: userId, action: status === "PAUSED" ? "workspace.paused" : "workspace.resumed", details: {} });
  await recordActivity({ workspaceId, type: status === "PAUSED" ? "WORKSPACE_PAUSED" : "WORKSPACE_RESUMED", title: status === "PAUSED" ? "Business paused — no automatic actions" : "Business resumed", actorType: "USER", actorId: userId });
}

export async function setAgentPaused(workspaceId: string, role: AgentRole, paused: boolean, userId: string): Promise<void> {
  await member(userId, workspaceId);
  if (!AGENT_ROLES.includes(role)) throw new ValidationError("Unknown agent.");
  await db()
    .update(agents)
    .set({ paused, status: paused ? "PAUSED" : "IDLE" })
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.role, role)));
  await recordActivity({ workspaceId, type: paused ? "AGENT_PAUSED" : "AGENT_RESUMED", title: `${role.replace("_", " ").toLowerCase()} agent ${paused ? "paused" : "resumed"}`, actorType: "USER", actorId: userId, agentRole: role });
}

/**
 * GLOBAL EMERGENCY STOP: stops every outbound action (publishing, messages,
 * checkouts) in all workspaces. Payment webhooks and attribution keep working.
 * Demo users can only stop their own DEMO workspaces.
 */
export async function setEmergencyStop(on: boolean, userId: string): Promise<{ scope: "GLOBAL" | "DEMO_WORKSPACES" }> {
  const p = await profile(userId);
  if (p.isDemo) {
    const ids = (await db().select({ id: workspaceMembers.workspaceId }).from(workspaceMembers).where(eq(workspaceMembers.userId, userId))).map((r) => r.id);
    for (const id of ids) await db().update(workspaces).set({ status: on ? "PAUSED" : "ACTIVE" }).where(eq(workspaces.id, id));
    return { scope: "DEMO_WORKSPACES" };
  }
  if (!on && !p.isAdmin) throw new AuthorizationError("Only the administrator can lift the emergency stop.");
  await saveGlobalSettings({ emergencyStop: on, emergencyStopAt: on ? now().toISOString() : null, emergencyStopBy: on ? userId : null }, userId);
  await audit({ workspaceId: null, actorType: "USER", actorId: userId, action: on ? "system.emergency_stop" : "system.emergency_resume", details: {} });
  await notify({ workspaceId: null, type: "ACTION_REQUIRED", severity: on ? "ERROR" : "SUCCESS", title: on ? "EMERGENCY STOP activated — all outbound actions halted" : "Emergency stop lifted — automation resumed", body: on ? `By ${p.name}. Payment webhooks and attribution keep running.` : `By ${p.name}.`, link: "/autopilot", dedupeKey: `estop:${on}:${now().toISOString()}` });
  return { scope: "GLOBAL" };
}

export async function emergencyStatus() {
  const g = await getGlobalSettings();
  return { active: g.emergencyStop, at: g.emergencyStopAt, by: g.emergencyStopBy };
}

/** Pause/resume a local worker from the dashboard (applied at its next heartbeat, ~15s). */
export async function requestWorkerPause(workerId: string, paused: boolean, userId: string): Promise<void> {
  const p = await profile(userId);
  if (!p.isAdmin) throw new AuthorizationError("Only the administrator can control workers.");
  await db()
    .update(workerInstances)
    .set({ paused, status: paused ? "PAUSED" : "ONLINE", config: sql`jsonb_set(${workerInstances.config}, '{remotePause}', ${JSON.stringify({ paused, at: now().toISOString() })}::jsonb)` })
    .where(eq(workerInstances.id, workerId));
  await audit({ workspaceId: null, actorType: "USER", actorId: userId, action: paused ? "worker.pause" : "worker.resume", details: { workerId } });
}

/* ─────────────────────────── Brand & business ─────────────────────────── */

export const BrandKitSchema = z.object({
  businessName: z.string().trim().min(1).max(80),
  primaryColor: hex,
  secondaryColor: hex,
  accentColor: hex,
  backgroundColor: hex,
  textColor: hex,
  fontHeading: z.enum(AVAILABLE_FONTS),
  fontBody: z.enum(AVAILABLE_FONTS),
  tone: z.string().trim().max(200),
  style: z.string().trim().max(200),
  voice: z.string().trim().max(1000),
  handle: z.string().trim().max(60).nullable().optional(),
  website: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().max(2000),
  targetAudience: z.string().trim().max(1000),
  keywords: list(),
  forbiddenWords: list(50),
  ctaPreferences: list(10),
  logoAssetId: z.string().uuid().nullable().optional(),
  iconAssetId: z.string().uuid().nullable().optional(),
});

export async function updateBrandKit(workspaceId: string, userId: string, input: unknown): Promise<void> {
  await member(userId, workspaceId);
  const d = BrandKitSchema.partial().parse(input);
  await db()
    .update(brandKits)
    .set({ ...d, version: sql`${brandKits.version} + 1` })
    .where(eq(brandKits.workspaceId, workspaceId));
  await audit({ workspaceId, actorType: "USER", actorId: userId, action: "brand.updated", details: { fields: Object.keys(d) } });
  await recordActivity({ workspaceId, type: "BRAND_UPDATED", title: "Brand Kit updated — new videos use the new identity", actorType: "USER", actorId: userId });
}

export const BusinessProfileSchema = z.object({
  targetAudience: z.string().trim().max(1000),
  problems: list(),
  goals: list(),
  valueProposition: z.string().trim().max(1000),
  differentiators: list(),
  competitors: list(),
  keywords: list(),
});

export async function updateBusinessProfile(workspaceId: string, userId: string, input: unknown): Promise<void> {
  await member(userId, workspaceId);
  const d = BusinessProfileSchema.partial().parse(input);
  await db().update(businessProfiles).set(d).where(eq(businessProfiles.workspaceId, workspaceId));
  await audit({ workspaceId, actorType: "USER", actorId: userId, action: "business_profile.updated", details: { fields: Object.keys(d) } });
}

/* ─────────────────────────── Products (Product Knowledge) ─────────────────────────── */

export const ProductInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(3000).default(""),
  type: z.enum(PRODUCT_TYPES).default("SERVICE"),
  priceCents: z.number().int().min(0).max(100_000_000),
  currency: z.enum(["BRL", "USD", "EUR"]).default("BRL"),
  benefits: list().default([]),
  features: list().default([]),
  faq: z.array(z.object({ q: z.string().trim().min(1).max(300), a: z.string().trim().min(1).max(1500) })).max(30).default([]),
  limitations: list().default([]),
  offer: z.string().trim().max(500).default(""),
  checkoutUrl: z.string().trim().url().max(500).nullable().or(z.literal("")).transform((v) => v || null).default(null),
  support: z.string().trim().max(500).default(""),
  terms: z.string().trim().max(2000).default(""),
  active: z.boolean().default(true),
});

/** The Sales Agent may only quote prices that exist here (unknown prices are blocked). */
export async function saveProduct(workspaceId: string, userId: string, input: unknown, productId?: string | null): Promise<string> {
  await member(userId, workspaceId);
  const d = ProductInputSchema.parse(input);
  if (productId) {
    const [row] = await db()
      .update(products)
      .set(d)
      .where(and(eq(products.id, productId), eq(products.workspaceId, workspaceId)))
      .returning({ id: products.id });
    if (!row) throw new AuthorizationError("Product not found.");
    await audit({ workspaceId, actorType: "USER", actorId: userId, action: "product.updated", entityType: "product", entityId: productId, details: { priceCents: d.priceCents } });
    return row.id;
  }
  let slug = slugify(d.name) || "product";
  const clash = await db().select({ id: products.id }).from(products).where(and(eq(products.workspaceId, workspaceId), eq(products.slug, slug))).limit(1);
  if (clash[0]) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const [row] = await db().insert(products).values({ ...d, workspaceId, slug }).returning({ id: products.id });
  await audit({ workspaceId, actorType: "USER", actorId: userId, action: "product.created", entityType: "product", entityId: row!.id, details: { priceCents: d.priceCents } });
  return row!.id;
}

/* ─────────────────────────── CRM ─────────────────────────── */

export async function moveLeadStage(leadId: string, stage: LeadStage, userId: string, lostReason?: string | null): Promise<void> {
  if (!LEAD_STAGES.includes(stage)) throw new ValidationError("Unknown stage.");
  const [lead] = await db().select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new AuthorizationError("Lead not found.");
  await assertMember(userId, lead.workspaceId);
  if (stage === "WON" && lead.stage !== "WON") {
    throw new ValidationError("Leads become WON only when a payment is confirmed. Use “Record manual sale” for payments received outside the system.");
  }
  await db()
    .update(leads)
    .set({
      stage,
      qualifiedAt: stage === "QUALIFIED" && !lead.qualifiedAt ? now() : lead.qualifiedAt,
      lostAt: stage === "LOST" ? now() : null,
      lostReason: stage === "LOST" ? (lostReason?.slice(0, 300) ?? "Marked lost manually") : null,
    })
    .where(eq(leads.id, leadId));
  await recomputeLeadScore(leadId, `stage changed to ${stage}`);
  await recordActivity({ workspaceId: lead.workspaceId, leadId, type: "LEAD_STAGE", title: `${lead.name || "Lead"} moved ${lead.stage} → ${stage}`, actorType: "USER", actorId: userId, entityType: "lead", entityId: leadId });
}

export const ManualLeadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || (v.length >= 10 && v.length <= 15), "Use the full number with country code")
    .transform((v) => v || null)
    .nullable()
    .optional(),
  email: z.string().trim().email().max(200).nullable().or(z.literal("")).transform((v) => v || null).optional(),
  notes: z.string().trim().max(2000).default(""),
  productId: z.string().uuid().nullable().optional(),
});

export async function createManualLead(workspaceId: string, userId: string, input: unknown): Promise<string> {
  const ws = await member(userId, workspaceId);
  const d = ManualLeadSchema.parse(input);
  const contactKey = d.phone ? `whatsapp:${d.phone}` : d.email ? `email:${d.email.toLowerCase()}` : null;
  if (contactKey) {
    const [dup] = await db().select({ id: leads.id }).from(leads).where(and(eq(leads.workspaceId, workspaceId), eq(leads.contactKey, contactKey))).limit(1);
    if (dup) throw new ValidationError("A lead with this contact already exists.");
  }
  const [row] = await db()
    .insert(leads)
    .values({ workspaceId, name: d.name, phone: d.phone ?? null, email: d.email ?? null, notes: d.notes, productId: d.productId ?? null, contactKey, channel: d.phone ? "WHATSAPP" : null, sourcePlatform: "MANUAL", attributionModel: "MANUAL", isDemo: ws.environment === "DEMO" })
    .returning({ id: leads.id });
  await recordActivity({ workspaceId, leadId: row!.id, type: "LEAD_CREATED", title: `Lead added manually: ${d.name}`, actorType: "USER", actorId: userId, entityType: "lead", entityId: row!.id });
  return row!.id;
}

export async function updateLeadNotes(leadId: string, userId: string, notes: string): Promise<void> {
  const [lead] = await db().select({ ws: leads.workspaceId }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new AuthorizationError("Lead not found.");
  await assertMember(userId, lead.ws);
  await db().update(leads).set({ notes: notes.slice(0, 5000) }).where(eq(leads.id, leadId));
}

export async function setLeadDoNotContact(leadId: string, userId: string, reason: string): Promise<void> {
  const [lead] = await db().select({ ws: leads.workspaceId }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new AuthorizationError("Lead not found.");
  await assertMember(userId, lead.ws);
  await markDoNotContact(leadId, reason.slice(0, 300) || "Marked by user", { type: "USER", id: userId });
}

/* ─────────────────────────── Content requests ─────────────────────────── */

export const ContentRequestSchema = z.object({
  count: z.number().int().min(1).max(4),
  focus: z.string().trim().max(500).nullable().optional(),
});

/** Human request for new content (bypasses automatic buffer limits but still respects the daily generation cap). */
export async function requestContent(workspaceId: string, userId: string, input: unknown): Promise<string> {
  const ws = await member(userId, workspaceId);
  const d = ContentRequestSchema.parse(input);
  if (ws.status !== "ACTIVE") throw new ValidationError("This business is paused. Resume it to create content.");
  const id = await enqueueJob({ type: "STRATEGY_PLAN", workspaceId, payload: { count: d.count, focus: d.focus ?? null, requestedBy: userId }, origin: "HUMAN" });
  await recordActivity({ workspaceId, type: "CONTENT_REQUESTED", title: `${d.count} new video${d.count > 1 ? "s" : ""} requested${d.focus ? ` — focus: ${d.focus}` : ""}`, actorType: "USER", actorId: userId, agentRole: "STRATEGIST" });
  return id;
}
