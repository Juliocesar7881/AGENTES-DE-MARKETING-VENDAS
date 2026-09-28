import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, real, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  ContentBrief,
  ContentStatus,
  Platform,
  PlatformCopy,
  PostingSlotStatus,
  QaStatus,
  RenderStatus,
  SocialAccountStatus,
  SocialPostStatus,
  VideoSpec,
} from "@revenueos/shared";
import { createdAt, pk, ts, updatedAt } from "./_common";
import { campaignExperiments, campaigns, products } from "./business";
import { profiles, workspaces } from "./identity";

const wsRef = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

export const contentPlans = pgTable(
  "content_plans",
  {
    id: pk(),
    workspaceId: wsRef(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    agentRunId: uuid("agent_run_id"),
    summary: text("summary").notNull(),
    briefs: jsonb("briefs").$type<ContentBrief[]>().notNull(),
    dataCaveats: jsonb("data_caveats").$type<string[]>().notNull().default([]),
    requestedCount: integer("requested_count").notNull().default(1),
    status: text("status").$type<"ACTIVE" | "CONSUMED">().notNull().default("ACTIVE"),
    createdAt: createdAt(),
  },
  (t) => [index("content_plans_ws_idx").on(t.workspaceId, t.createdAt)],
);

export interface QaCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export const contents = pgTable(
  "contents",
  {
    id: pk(),
    number: integer("number").generatedAlwaysAsIdentity(),
    workspaceId: wsRef(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    contentPlanId: uuid("content_plan_id").references(() => contentPlans.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    experimentId: uuid("experiment_id").references(() => campaignExperiments.id, { onDelete: "set null" }),
    parentContentId: uuid("parent_content_id"),
    variantLabel: text("variant_label"),
    title: text("title").notNull(),
    status: text("status").$type<ContentStatus>().notNull().default("IDEA"),
    brief: jsonb("brief").$type<ContentBrief | null>(),
    templateId: text("template_id"),
    format: text("format").notNull().default("9:16"),
    hook: text("hook"),
    hookType: text("hook_type"),
    angle: text("angle"),
    cta: text("cta"),
    ctaType: text("cta_type"),
    objective: text("objective").notNull().default("LEADS"),
    script: text("script"),
    copy: jsonb("copy").$type<PlatformCopy | null>(),
    targetPlatforms: jsonb("target_platforms").$type<Platform[]>().notNull().default([]),
    currentSpecId: uuid("current_spec_id"),
    slotId: uuid("slot_id"),
    scheduledFor: ts("scheduled_for"),
    durationSec: real("duration_sec"),
    similarityScore: real("similarity_score"),
    similarToContentId: uuid("similar_to_content_id"),
    qaStatus: text("qa_status").$type<QaStatus>().notNull().default("PENDING"),
    /** Publish right after it is ready instead of waiting for the next peak slot (e.g. the first video). */
    publishAsap: boolean("publish_asap").notNull().default(false),
    qaReport: jsonb("qa_report").$type<{ checks: QaCheck[]; checkedAt: string } | null>(),
    failureReason: text("failure_reason"),
    failureDetails: jsonb("failure_details").$type<Record<string, unknown> | null>(),
    approvalStatus: text("approval_status").$type<"NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED">().notNull().default("NOT_REQUIRED"),
    approvedBy: uuid("approved_by").references(() => profiles.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    createdBy: text("created_by").$type<"AGENT" | "HUMAN">().notNull().default("AGENT"),
    regenerationCount: integer("regeneration_count").notNull().default(0),
    isDemo: boolean("is_demo").notNull().default(false),
    publishedAt: ts("published_at"),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contents_ws_status_idx").on(t.workspaceId, t.status),
    index("contents_ws_scheduled_idx").on(t.workspaceId, t.scheduledFor),
    index("contents_ws_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

export const contentVariations = pgTable(
  "content_variations",
  {
    id: pk(),
    workspaceId: wsRef(),
    sourceContentId: uuid("source_content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    variationContentId: uuid("variation_content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    preserved: jsonb("preserved").$type<string[]>().notNull().default([]),
    changed: jsonb("changed").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("content_variations_pair_uq").on(t.sourceContentId, t.variationContentId)],
);

export const videoSpecs = pgTable(
  "video_specs",
  {
    id: pk(),
    workspaceId: wsRef(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    spec: jsonb("spec").$type<VideoSpec>().notNull(),
    createdBy: text("created_by").$type<"AGENT" | "HUMAN" | "MOCK">().notNull(),
    agentRunId: uuid("agent_run_id"),
    promptVersion: text("prompt_version"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("video_specs_content_version_uq").on(t.contentId, t.version)],
);

export const videoRenders = pgTable(
  "video_renders",
  {
    id: pk(),
    workspaceId: wsRef(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    videoSpecId: uuid("video_spec_id").references(() => videoSpecs.id, { onDelete: "set null" }),
    status: text("status").$type<RenderStatus>().notNull().default("QUEUED"),
    workerId: text("worker_id"),
    localPath: text("local_path"),
    fileSize: bigint("file_size", { mode: "number" }),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    fps: real("fps"),
    videoCodec: text("video_codec"),
    audioCodec: text("audio_codec"),
    hasAudio: boolean("has_audio"),
    thumbnailKey: text("thumbnail_key"),
    previewKey: text("preview_key"),
    frameKeys: jsonb("frame_keys").$type<string[]>().notNull().default([]),
    validation: jsonb("validation").$type<Record<string, unknown> | null>(),
    deliveryKey: text("delivery_key"),
    deliveryExpiresAt: ts("delivery_expires_at"),
    deliveredAt: ts("delivered_at"),
    deliveryDeletedAt: ts("delivery_deleted_at"),
    localDeletedAt: ts("local_deleted_at"),
    renderMs: integer("render_ms"),
    error: text("error"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("video_renders_content_idx").on(t.contentId, t.createdAt), index("video_renders_ws_idx").on(t.workspaceId, t.status)],
);

export const postingSlots = pgTable(
  "posting_slots",
  {
    id: pk(),
    workspaceId: wsRef(),
    scheduledFor: ts("scheduled_for").notNull(),
    localDate: text("local_date").notNull(),
    localTime: text("local_time").notNull(),
    status: text("status").$type<PostingSlotStatus>().notNull().default("OPEN"),
    contentId: uuid("content_id").references(() => contents.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("posting_slots_ws_time_uq").on(t.workspaceId, t.scheduledFor), index("posting_slots_status_idx").on(t.status, t.scheduledFor)],
);

export interface ActionRequired {
  reason: string;
  steps: string[];
  links: { label: string; url: string }[];
  missingScopes?: string[];
}

export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: pk(),
    workspaceId: wsRef(),
    platform: text("platform").$type<Platform>().notNull(),
    externalAccountId: text("external_account_id").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    status: text("status").$type<SocialAccountStatus>().notNull().default("CONNECTED"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    tokenExpiresAt: ts("token_expires_at"),
    refreshExpiresAt: ts("refresh_expires_at"),
    lastValidatedAt: ts("last_validated_at"),
    lastError: text("last_error"),
    capabilities: jsonb("capabilities").$type<Record<string, unknown>>().notNull().default({}),
    actionRequired: jsonb("action_required").$type<ActionRequired | null>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    isDemo: boolean("is_demo").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    connectedBy: uuid("connected_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("social_accounts_ws_platform_ext_uq").on(t.workspaceId, t.platform, t.externalAccountId),
    index("social_accounts_ws_idx").on(t.workspaceId),
  ],
);

export const socialPosts = pgTable(
  "social_posts",
  {
    id: pk(),
    workspaceId: wsRef(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    status: text("status").$type<SocialPostStatus>().notNull().default("QUEUED"),
    scheduledFor: ts("scheduled_for"),
    caption: text("caption").notNull().default(""),
    hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
    title: text("title"),
    privacy: text("privacy"),
    publishMode: text("publish_mode").$type<"DIRECT" | "DRAFT">().notNull().default("DIRECT"),
    aiLabel: boolean("ai_label").notNull().default(true),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    publishLock: text("publish_lock"),
    lockedAt: ts("locked_at"),
    providerState: jsonb("provider_state").$type<Record<string, unknown>>().notNull().default({}),
    platformPostId: text("platform_post_id"),
    permalink: text("permalink"),
    publishedAt: ts("published_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    errorDetails: jsonb("error_details").$type<Record<string, unknown> | null>(),
    publishedBy: text("published_by").$type<"AI" | "HUMAN">(),
    isDemo: boolean("is_demo").notNull().default(false),
    trackedLinkCode: text("tracked_link_code"),
    nextMetricsSyncAt: ts("next_metrics_sync_at"),
    lastMetricsSyncAt: ts("last_metrics_sync_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("social_posts_content_account_uq").on(t.contentId, t.socialAccountId),
    index("social_posts_ws_status_idx").on(t.workspaceId, t.status),
    index("social_posts_due_idx").on(t.status, t.scheduledFor),
    index("social_posts_metrics_idx").on(t.nextMetricsSyncAt).where(sql`status = 'PUBLISHED'`),
  ],
);

export const socialMetrics = pgTable(
  "social_metrics",
  {
    id: pk(),
    workspaceId: wsRef(),
    socialPostId: uuid("social_post_id")
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    capturedAt: ts("captured_at").notNull().defaultNow(),
    views: integer("views"),
    reach: integer("reach"),
    impressions: integer("impressions"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    clicks: integer("clicks"),
    watchTimeMs: bigint("watch_time_ms", { mode: "number" }),
    avgWatchMs: integer("avg_watch_ms"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    isSimulated: boolean("is_simulated").notNull().default(false),
  },
  (t) => [index("social_metrics_post_idx").on(t.socialPostId, t.capturedAt)],
);

export const trackedLinks = pgTable(
  "tracked_links",
  {
    id: pk(),
    workspaceId: wsRef(),
    code: text("code").notNull().unique(),
    socialPostId: uuid("social_post_id").references(() => socialPosts.id, { onDelete: "set null" }),
    contentId: uuid("content_id").references(() => contents.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    destinationType: text("destination_type").$type<"WHATSAPP" | "LANDING" | "CHECKOUT" | "URL">().notNull(),
    destinationUrl: text("destination_url"),
    clicks: integer("clicks").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("tracked_links_content_idx").on(t.contentId)],
);

export const customCompositions = pgTable(
  "custom_compositions",
  {
    id: pk(),
    workspaceId: wsRef(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    code: text("code").notNull(),
    status: text("status")
      .$type<"PROPOSED" | "VALIDATING" | "VALIDATED" | "APPROVED" | "REJECTED" | "FAILED">()
      .notNull()
      .default("PROPOSED"),
    validationReport: jsonb("validation_report").$type<Record<string, unknown> | null>(),
    agentRunId: uuid("agent_run_id"),
    approvedBy: uuid("approved_by").references(() => profiles.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("custom_compositions_ws_idx").on(t.workspaceId, t.status)],
);
