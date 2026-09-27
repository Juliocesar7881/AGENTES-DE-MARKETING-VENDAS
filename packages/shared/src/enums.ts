/**
 * Canonical enumerations shared by database, core, worker and web.
 * Every status machine in RevenueOS is declared here so that the UI,
 * the database check constraints and the business logic never drift.
 */

export const CONTENT_STATUSES = [
  "IDEA",
  "PLANNING",
  "SCRIPTING",
  "GENERATING",
  "READY_TO_RENDER",
  "RENDERING",
  "RENDERED",
  "READY",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "ARCHIVED",
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** Content that counts as "in the buffer" (ready or on its way to being ready). */
export const BUFFER_READY_STATUSES: readonly ContentStatus[] = ["READY", "SCHEDULED"];
export const BUFFER_IN_PROGRESS_STATUSES: readonly ContentStatus[] = [
  "IDEA",
  "PLANNING",
  "SCRIPTING",
  "GENERATING",
  "READY_TO_RENDER",
  "RENDERING",
  "RENDERED",
];

export const SOCIAL_POST_STATUSES = [
  "QUEUED",
  "UPLOADING",
  "PROCESSING",
  "PUBLISHED",
  /** Sent to the creator's drafts/inbox (e.g. TikTok upload without Direct Post). Never shown as public. */
  "DRAFT",
  "FAILED",
  "CANCELLED",
] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];

export const PLATFORMS = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "MOCK"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const REAL_PLATFORMS = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"] as const;
export type RealPlatform = (typeof REAL_PLATFORMS)[number];

export const SOCIAL_ACCOUNT_STATUSES = [
  "CONNECTED",
  "NEEDS_ACTION",
  "EXPIRED",
  "REVOKED",
  "ERROR",
] as const;
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export const LEAD_STAGES = [
  "NEW",
  "CONTACTED",
  "ENGAGED",
  "QUALIFIED",
  "CHECKOUT",
  "WON",
  "LOST",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_STAGE_ORDER: Record<LeadStage, number> = {
  NEW: 0,
  CONTACTED: 1,
  ENGAGED: 2,
  QUALIFIED: 3,
  CHECKOUT: 4,
  WON: 5,
  LOST: -1,
};

export const JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "RETRYING",
  "CANCELLED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Where a job may run. LOCAL jobs require the local worker (Remotion, FFmpeg, local files). */
export const JOB_RUNNERS = ["ANY", "LOCAL"] as const;
export type JobRunner = (typeof JOB_RUNNERS)[number];

export const JOB_TYPES = [
  "STRATEGY_PLAN",
  "CREATIVE_GENERATE",
  "RENDER_VIDEO",
  "PREPARE_DELIVERY",
  "SCHEDULE_CONTENT",
  "PUBLISH_POST",
  "SYNC_METRICS",
  "SALES_REPLY",
  "FOLLOW_UP",
  "PERFORMANCE_REVIEW",
  "WEEKLY_STRATEGY",
  "LEARNING_UPDATE",
  "ATTRIBUTE_REVENUE",
  "TOKEN_HEALTH",
  "CLEANUP_LOCAL_RENDERS",
  "CLEANUP_DELIVERY",
  "PROCESS_ASSET",
  "WEBSITE_SCREENSHOT",
  "VALIDATE_COMPOSITION",
  "SIMULATE_DAY",
  "ANALYTICS_ROLLUP",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** AI-heavy jobs that are considered non-essential when budgets are exceeded. */
export const NON_ESSENTIAL_AI_JOBS: readonly JobType[] = [
  "STRATEGY_PLAN",
  "CREATIVE_GENERATE",
  "PERFORMANCE_REVIEW",
  "WEEKLY_STRATEGY",
  "VALIDATE_COMPOSITION",
];

/** Jobs that send something to the outside world; stopped by the global emergency stop. */
export const OUTBOUND_JOBS: readonly JobType[] = [
  "PUBLISH_POST",
  "SALES_REPLY",
  "FOLLOW_UP",
  "PREPARE_DELIVERY",
];

/** Bookkeeping jobs that keep running even under emergency stop (they never contact anyone). */
export const EMERGENCY_SAFE_JOBS: readonly JobType[] = [
  "ATTRIBUTE_REVENUE",
  "ANALYTICS_ROLLUP",
  "LEARNING_UPDATE",
];

export const EVENT_TYPES = [
  "WORKSPACE_CREATED",
  "CONTENT_NEEDED",
  "STRATEGY_CREATED",
  "CONTENT_CREATED",
  "RENDER_REQUESTED",
  "RENDER_COMPLETED",
  "RENDER_FAILED",
  "CONTENT_READY",
  "POST_SCHEDULED",
  "POST_PUBLISHED",
  "POST_FAILED",
  "LEAD_CREATED",
  "MESSAGE_RECEIVED",
  "LEAD_QUALIFIED",
  "CHECKOUT_CREATED",
  "PAYMENT_APPROVED",
  "PAYMENT_REFUNDED",
  "REVENUE_ATTRIBUTED",
  "PERFORMANCE_REVIEW",
  "WEEKLY_STRATEGY_DUE",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const AGENT_ROLES = [
  "STRATEGIST",
  "CREATIVE",
  "GROWTH",
  "SALES",
  "CUSTOMER_SUCCESS",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Model slots configured in Settings → AI. */
export const MODEL_SLOTS = ["strategist", "creative", "sales", "classification"] as const;
export type ModelSlot = (typeof MODEL_SLOTS)[number];

export const AGENT_STATUSES = ["IDLE", "WORKING", "WAITING", "ERROR", "PAUSED"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const OPERATING_MODES = ["MANUAL", "ASSISTED", "AUTOPILOT"] as const;
export type OperatingMode = (typeof OPERATING_MODES)[number];

export const WORKSPACE_ENVIRONMENTS = ["LIVE", "DEMO"] as const;
export type WorkspaceEnvironment = (typeof WORKSPACE_ENVIRONMENTS)[number];

export const PAYMENT_STATUSES = ["PENDING", "APPROVED", "FAILED", "CANCELLED", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PROVIDERS = ["MERCADOPAGO", "STRIPE", "MOCK", "MANUAL"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export const CHECKOUT_STATUSES = ["CREATED", "SENT", "PAID", "EXPIRED", "CANCELLED"] as const;
export type CheckoutStatus = (typeof CHECKOUT_STATUSES)[number];

export const MESSAGING_CHANNELS = ["WHATSAPP", "INSTAGRAM", "MOCK", "WEBFORM"] as const;
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

export const MESSAGE_SENDERS = ["LEAD", "AI", "HUMAN", "SYSTEM"] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

export const DELIVERY_STATUSES = ["PENDING", "SENT", "DELIVERED", "READ", "FAILED", "RECEIVED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const CONVERSATION_AI_MODES = ["AI", "PAUSED", "HUMAN"] as const;
export type ConversationAiMode = (typeof CONVERSATION_AI_MODES)[number];

export const MEMORY_CATEGORIES = ["BRAND", "AUDIENCE", "CONTENT", "SALES", "PERFORMANCE"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const CONFIDENCE_LEVELS = ["LOW_DATA", "PROMISING", "CONSISTENT", "STRONG_EVIDENCE"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const INSIGHT_DIMENSIONS = [
  "HOOK_TYPE",
  "TEMPLATE",
  "CTA_TYPE",
  "ANGLE",
  "DURATION",
  "POSTING_HOUR",
  "PLATFORM",
] as const;
export type InsightDimension = (typeof INSIGHT_DIMENSIONS)[number];

export const INSIGHT_METRICS = ["LEAD_RATE", "REVENUE_PER_1K", "SALE_RATE", "REVENUE_PER_LEAD"] as const;
export type InsightMetric = (typeof INSIGHT_METRICS)[number];

export const APPROVAL_TYPES = [
  "PUBLISH_CONTENT",
  "SEND_CHECKOUT",
  "DISCOUNT",
  "SENSITIVE_MESSAGE",
  "PRICE_CHANGE",
  "PRODUCT_CHANGE",
  "CUSTOM_COMPOSITION",
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXPIRED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "SALE",
  "LEAD_QUALIFIED",
  "NEW_LEAD",
  "RENDER_COMPLETE",
  "PUBLISH_FAILED",
  "TOKEN_EXPIRED",
  "WORKER_OFFLINE",
  "APPROVAL_REQUIRED",
  "BUDGET_EXCEEDED",
  "JOB_FAILED",
  "ACTION_REQUIRED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const SEVERITIES = ["INFO", "SUCCESS", "WARNING", "ERROR"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ACTOR_TYPES = ["USER", "AGENT", "SYSTEM", "WORKER", "WEBHOOK"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const ASSET_KINDS = [
  "LOGO",
  "ICON",
  "SCREENSHOT",
  "PHOTO",
  "VIDEO",
  "PRODUCT_SHOT",
  "MOCKUP",
  "AUDIO",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const PRODUCT_TYPES = ["DIGITAL", "SERVICE", "PHYSICAL", "SUBSCRIPTION", "COURSE", "APPOINTMENT"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const INTEGRATION_KEYS = [
  "anthropic",
  "claude_code_cli",
  "meta",
  "instagram",
  "tiktok",
  "google",
  "whatsapp",
  "mercadopago",
  "stripe",
  "storage",
] as const;
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

export const INTEGRATION_STATUSES = ["NOT_CONFIGURED", "CONNECTED", "NEEDS_ACTION", "READY", "ERROR"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const ATTRIBUTION_EVENT_TYPES = [
  "CLICK",
  "LEAD",
  "QUALIFIED",
  "CHECKOUT",
  "PURCHASE",
  "REFUND",
] as const;
export type AttributionEventType = (typeof ATTRIBUTION_EVENT_TYPES)[number];

/** How a lead/payment was linked to content. Displayed to users; never implies causality. */
export const ATTRIBUTION_MODELS = ["TRACKED_LINK", "REF_CODE", "PLATFORM_REFERRAL", "INFERRED_RECENT", "MANUAL", "NONE"] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

export const POSTING_SLOT_STATUSES = ["OPEN", "FILLED", "PUBLISHED", "MISSED", "SKIPPED"] as const;
export type PostingSlotStatus = (typeof POSTING_SLOT_STATUSES)[number];

export const RENDER_STATUSES = ["QUEUED", "RENDERING", "COMPLETED", "FAILED", "SIMULATED"] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

export const QA_STATUSES = ["PENDING", "PASSED", "WARNINGS", "FAILED"] as const;
export type QaStatus = (typeof QA_STATUSES)[number];

export const AI_PROVIDER_IDS = ["anthropic", "claude-code-cli", "mock"] as const;
export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

export const RETENTION_OPTIONS = [7, 30, 90, 0] as const; // 0 = forever
export type RetentionDays = (typeof RETENTION_OPTIONS)[number];
