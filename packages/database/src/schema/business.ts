import { bigint, boolean, date, index, integer, jsonb, numeric, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AgentRole, AgentStatus, AssetKind, CampaignStatus, MemoryCategory, ProductType } from "@revenueos/shared";
import { createdAt, pk, ts, updatedAt } from "./_common";
import { profiles, workspaces } from "./identity";

const wsRef = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

export const businessProfiles = pgTable("business_profiles", {
  id: pk(),
  workspaceId: wsRef().unique(),
  targetAudience: text("target_audience").notNull().default(""),
  problems: jsonb("problems").$type<string[]>().notNull().default([]),
  goals: jsonb("goals").$type<string[]>().notNull().default([]),
  valueProposition: text("value_proposition").notNull().default(""),
  differentiators: jsonb("differentiators").$type<string[]>().notNull().default([]),
  competitors: jsonb("competitors").$type<string[]>().notNull().default([]),
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
  websiteAnalysis: jsonb("website_analysis").$type<Record<string, unknown> | null>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const brandKits = pgTable("brand_kits", {
  id: pk(),
  workspaceId: wsRef().unique(),
  businessName: text("business_name").notNull(),
  logoAssetId: uuid("logo_asset_id"),
  iconAssetId: uuid("icon_asset_id"),
  primaryColor: text("primary_color").notNull().default("#2EE6A6"),
  secondaryColor: text("secondary_color").notNull().default("#7C6CFF"),
  accentColor: text("accent_color").notNull().default("#FFB547"),
  backgroundColor: text("background_color").notNull().default("#0B0F14"),
  textColor: text("text_color").notNull().default("#F5F7FA"),
  fontHeading: text("font_heading").notNull().default("Inter"),
  fontBody: text("font_body").notNull().default("Inter"),
  tone: text("tone").notNull().default("confiante, claro e próximo"),
  style: text("style").notNull().default("moderno"),
  voice: text("voice").notNull().default(""),
  website: text("website"),
  handle: text("handle"),
  description: text("description").notNull().default(""),
  targetAudience: text("target_audience").notNull().default(""),
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
  forbiddenWords: jsonb("forbidden_words").$type<string[]>().notNull().default([]),
  ctaPreferences: jsonb("cta_preferences").$type<string[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const brandAssets = pgTable(
  "brand_assets",
  {
    id: pk(),
    workspaceId: wsRef(),
    kind: text("kind").$type<AssetKind>().notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    thumbnailKey: text("thumbnail_key"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    sha256: text("sha256").notNull(),
    description: text("description").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    status: text("status").$type<"READY" | "PROCESSING" | "REJECTED">().notNull().default("READY"),
    uploadedBy: uuid("uploaded_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("brand_assets_ws_idx").on(t.workspaceId, t.kind), uniqueIndex("brand_assets_ws_sha_uq").on(t.workspaceId, t.sha256)],
);

export interface FaqItem {
  q: string;
  a: string;
}

export const products = pgTable(
  "products",
  {
    id: pk(),
    workspaceId: wsRef(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    type: text("type").$type<ProductType>().notNull().default("DIGITAL"),
    priceCents: integer("price_cents").notNull().default(0),
    currency: text("currency").notNull().default("BRL"),
    benefits: jsonb("benefits").$type<string[]>().notNull().default([]),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    faq: jsonb("faq").$type<FaqItem[]>().notNull().default([]),
    limitations: jsonb("limitations").$type<string[]>().notNull().default([]),
    offer: text("offer").notNull().default(""),
    checkoutUrl: text("checkout_url"),
    support: text("support").notNull().default(""),
    terms: text("terms").notNull().default(""),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("products_ws_slug_uq").on(t.workspaceId, t.slug), index("products_ws_idx").on(t.workspaceId)],
);

export const agents = pgTable(
  "agents",
  {
    id: pk(),
    workspaceId: wsRef(),
    role: text("role").$type<AgentRole>().notNull(),
    status: text("status").$type<AgentStatus>().notNull().default("IDLE"),
    paused: boolean("paused").notNull().default(false),
    currentJobId: uuid("current_job_id"),
    currentTask: text("current_task"),
    lastRunAt: ts("last_run_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("agents_ws_role_uq").on(t.workspaceId, t.role)],
);

export const agentConfigs = pgTable(
  "agent_configs",
  {
    id: pk(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(),
    model: text("model").notNull(),
    effort: text("effort").notNull().default("default"),
    maxTokens: integer("max_tokens").notNull().default(8000),
    promptVersion: text("prompt_version"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("agent_configs_ws_slot_uq").on(t.workspaceId, t.slot).nullsNotDistinct()],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: pk(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    agentRole: text("agent_role").$type<AgentRole>().notNull(),
    task: text("task").notNull(),
    jobId: uuid("job_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputSummary: text("input_summary").notNull().default(""),
    output: jsonb("output").$type<unknown>(),
    status: text("status").$type<"SUCCESS" | "ERROR">().notNull(),
    error: text("error"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    attempts: integer("attempts").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index("agent_runs_ws_created_idx").on(t.workspaceId, t.createdAt)],
);

export const agentMemories = pgTable(
  "agent_memories",
  {
    id: pk(),
    workspaceId: wsRef(),
    category: text("category").$type<MemoryCategory>().notNull(),
    content: text("content").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    source: text("source").$type<"AGENT" | "HUMAN" | "SYSTEM">().notNull().default("AGENT"),
    importance: integer("importance").notNull().default(5),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("agent_memories_ws_cat_idx").on(t.workspaceId, t.category)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: pk(),
    workspaceId: wsRef(),
    name: text("name").notNull(),
    objective: text("objective").notNull().default("LEADS"),
    status: text("status").$type<CampaignStatus>().notNull().default("ACTIVE"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    angle: text("angle").notNull().default(""),
    offer: text("offer").notNull().default(""),
    cta: text("cta").notNull().default(""),
    strategy: jsonb("strategy").$type<Record<string, unknown>>().notNull().default({}),
    startDate: date("start_date"),
    endDate: date("end_date"),
    createdBy: text("created_by").$type<"AGENT" | "HUMAN">().notNull().default("HUMAN"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaigns_ws_idx").on(t.workspaceId, t.status)],
);

export const campaignExperiments = pgTable(
  "campaign_experiments",
  {
    id: pk(),
    workspaceId: wsRef(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    variable: text("variable").notNull(),
    hypothesis: text("hypothesis").notNull(),
    variants: jsonb("variants").$type<{ label: string; contentId?: string; description?: string }[]>().notNull().default([]),
    status: text("status").$type<"RUNNING" | "CONCLUDED" | "CANCELLED">().notNull().default("RUNNING"),
    winner: text("winner"),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("campaign_experiments_ws_idx").on(t.workspaceId)],
);

export const creativeInsights = pgTable(
  "creative_insights",
  {
    id: pk(),
    workspaceId: wsRef(),
    dimension: text("dimension").notNull(),
    key: text("key").notNull(),
    metric: text("metric").notNull(),
    value: numeric("value", { precision: 18, scale: 6, mode: "number" }),
    baseline: numeric("baseline", { precision: 18, scale: 6, mode: "number" }),
    lift: numeric("lift", { precision: 12, scale: 6, mode: "number" }),
    sampleSize: integer("sample_size").notNull(),
    exposures: integer("exposures").notNull().default(0),
    events: integer("events").notNull().default(0),
    zScore: numeric("z_score", { precision: 10, scale: 4, mode: "number" }),
    confidence: text("confidence").notNull(),
    rule: text("rule").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    summary: text("summary").notNull(),
    periodStart: ts("period_start").notNull(),
    periodEnd: ts("period_end").notNull(),
    isLatest: boolean("is_latest").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("creative_insights_ws_latest_idx").on(t.workspaceId, t.isLatest)],
);
