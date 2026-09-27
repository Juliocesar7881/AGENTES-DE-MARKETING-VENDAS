import { z } from "zod";
import { AI_PROVIDER_IDS, MODEL_SLOTS, REAL_PLATFORMS } from "../enums";

export const AUTOPILOT_PERMISSION_KEYS = [
  "createStrategies",
  "generateContent",
  "renderVideos",
  "scheduleContent",
  "publishContent",
  "replyLeads",
  "qualifyLeads",
  "followUp",
  "generateCheckout",
  "sendCheckout",
  "onboardCustomer",
] as const;
export type AutopilotPermissionKey = (typeof AUTOPILOT_PERMISSION_KEYS)[number];

export const AUTOPILOT_PERMISSION_LABELS: Record<AutopilotPermissionKey, string> = {
  createStrategies: "Create strategies",
  generateContent: "Generate content",
  renderVideos: "Render videos",
  scheduleContent: "Schedule content",
  publishContent: "Publish content",
  replyLeads: "Reply leads",
  qualifyLeads: "Qualify leads",
  followUp: "Follow-up",
  generateCheckout: "Generate checkout",
  sendCheckout: "Send checkout",
  onboardCustomer: "Onboard customer",
};

export const AutopilotPermissionsSchema = z.object(
  Object.fromEntries(AUTOPILOT_PERMISSION_KEYS.map((k) => [k, z.boolean().default(true)])) as Record<
    AutopilotPermissionKey,
    z.ZodDefault<z.ZodBoolean>
  >,
);
export type AutopilotPermissions = z.infer<typeof AutopilotPermissionsSchema>;

export const DEFAULT_AUTOPILOT_PERMISSIONS: AutopilotPermissions = Object.fromEntries(
  AUTOPILOT_PERMISSION_KEYS.map((k) => [k, true]),
) as AutopilotPermissions;

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

export const PostingScheduleSchema = z.array(timeOfDay).min(1).max(12);

export const BusinessHoursSchema = z.object({
  enabled: z.boolean().default(true),
  /** 0 = Sunday … 6 = Saturday */
  days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
  start: timeOfDay.default("08:00"),
  end: timeOfDay.default("20:00"),
});
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

export const SalesSettingsSchema = z.object({
  autoReply: z.boolean().default(true),
  businessHours: BusinessHoursSchema.default({ enabled: true, days: [1, 2, 3, 4, 5, 6], start: "08:00", end: "20:00" }),
  maxFollowups: z.number().int().min(0).max(10).default(3),
  minFollowupIntervalHours: z.number().min(1).max(24 * 14).default(24),
  maxDiscountPct: z.number().min(0).max(90).default(10),
  allowCheckout: z.boolean().default(true),
  /** Checkouts above this amount (in cents) require human approval even in AUTOPILOT. */
  humanApprovalThresholdCents: z.number().int().min(0).default(100_000),
  /** Name of an approved WhatsApp template for messages outside the 24h window. */
  whatsappFollowupTemplate: z.string().max(100).optional(),
  whatsappTemplateLanguage: z.string().max(10).default("pt_BR"),
  leadScoringWeights: z.record(z.string(), z.number()).optional(),
});
export type SalesSettings = z.infer<typeof SalesSettingsSchema>;
export const DEFAULT_SALES_SETTINGS: SalesSettings = SalesSettingsSchema.parse({});

export const WorkspaceSchedulingSchema = z.object({
  timezone: z.string().min(1).default("America/Sao_Paulo"),
  postsPerDay: z.number().int().min(0).max(12).default(2),
  postingSchedule: PostingScheduleSchema.default(["09:00", "18:00"]),
  targetReadyBuffer: z.number().int().min(0).max(30).default(4),
  maxContentGeneratedPerDay: z.number().int().min(0).max(24).default(4),
  maxContentPublishedPerDay: z.number().int().min(0).max(24).default(2),
  targetPlatforms: z.array(z.enum([...REAL_PLATFORMS, "MOCK"])).default(["INSTAGRAM", "TIKTOK", "YOUTUBE"]),
});
export type WorkspaceScheduling = z.infer<typeof WorkspaceSchedulingSchema>;

export const RetentionSettingsSchema = z.object({
  /** 7 / 30 / 90 or 0 (forever). Unpublished videos are never deleted. */
  localVideoRetentionDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)]).default(30),
  /** Leads inactive for this many days are anonymized. 0 = keep. */
  leadRetentionDays: z.number().int().min(0).max(3650).default(0),
  messageRetentionDays: z.number().int().min(0).max(3650).default(0),
});
export type RetentionSettings = z.infer<typeof RetentionSettingsSchema>;

export const ModelConfigSchema = z.object({
  model: z.string().min(1),
  /** "default" = do not send an effort parameter. */
  effort: z.enum(["default", "low", "medium", "high"]).default("default"),
  maxTokens: z.number().int().min(256).max(64000),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ModelPriceSchema = z.object({
  inputPerMTok: z.number().min(0),
  outputPerMTok: z.number().min(0),
  cacheReadPerMTok: z.number().min(0).optional(),
  cacheWritePerMTok: z.number().min(0).optional(),
});
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

export const AISettingsSchema = z.object({
  provider: z.enum(AI_PROVIDER_IDS).default("anthropic"),
  /** Provider used by DEMO workspaces. Mock by default so the demo is free. */
  demoProvider: z.enum(["mock", "same"]).default("mock"),
  models: z.object(
    Object.fromEntries(MODEL_SLOTS.map((s) => [s, ModelConfigSchema])) as Record<(typeof MODEL_SLOTS)[number], typeof ModelConfigSchema>,
  ),
  prices: z.record(z.string(), ModelPriceSchema).default({}),
  promptCaching: z.boolean().default(true),
  requestTimeoutMs: z.number().int().min(10_000).max(600_000).default(180_000),
  claudeCliPath: z.string().max(400).optional(),
  availableModels: z.array(z.object({ id: z.string(), displayName: z.string().optional() })).default([]),
  modelsRefreshedAt: z.string().nullable().default(null),
});
export type AISettings = z.infer<typeof AISettingsSchema>;

/**
 * Default model assignment. Smartest model for strategy/creation, cheaper models for
 * high-volume conversation and classification. Every value is editable in Settings → AI.
 */
export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: "anthropic",
  demoProvider: "mock",
  models: {
    strategist: { model: "claude-opus-5", effort: "medium", maxTokens: 16000 },
    creative: { model: "claude-opus-5", effort: "medium", maxTokens: 16000 },
    sales: { model: "claude-sonnet-5", effort: "low", maxTokens: 4000 },
    classification: { model: "claude-haiku-4-5", effort: "default", maxTokens: 2000 },
  },
  prices: {},
  promptCaching: true,
  requestTimeoutMs: 180_000,
  availableModels: [],
  modelsRefreshedAt: null,
};

/** Economy preset: roughly 60% cheaper per generated video. */
export const ECONOMY_MODEL_PRESET: AISettings["models"] = {
  strategist: { model: "claude-sonnet-5", effort: "medium", maxTokens: 16000 },
  creative: { model: "claude-sonnet-5", effort: "medium", maxTokens: 16000 },
  sales: { model: "claude-haiku-4-5", effort: "default", maxTokens: 4000 },
  classification: { model: "claude-haiku-4-5", effort: "default", maxTokens: 2000 },
};

/** Default USD prices per million tokens (first-party API list prices). Editable in Settings → AI. */
export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 0.25, cacheWritePerMTok: 12.5 },
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 1, cacheWritePerMTok: 12.5 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
};

export const BudgetSettingsSchema = z.object({
  dailyAiBudgetUsd: z.number().min(0).nullable().default(null),
  monthlyAiBudgetUsd: z.number().min(0).nullable().default(null),
});

export const GlobalSettingsSchema = z.object({
  emergencyStop: z.boolean().default(false),
  emergencyStopAt: z.string().nullable().default(null),
  emergencyStopBy: z.string().nullable().default(null),
  globalMonthlyAiBudgetUsd: z.number().min(0).nullable().default(null),
  deliveryLeadHours: z.number().min(1).max(72).default(24),
  workerOfflineAfterSec: z.number().int().min(30).max(3600).default(120),
});
export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>;
