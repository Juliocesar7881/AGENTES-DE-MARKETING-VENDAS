import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  AutopilotPermissions,
  OperatingMode,
  Platform,
  RetentionSettings,
  SalesSettings,
  WorkspaceEnvironment,
} from "@revenueos/shared";
import { createdAt, pk, ts, updatedAt } from "./_common";

export const profiles = pgTable("profiles", {
  id: pk(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  avatarUrl: text("avatar_url"),
  isAdmin: boolean("is_admin").notNull().default(false),
  isDemo: boolean("is_demo").notNull().default(false),
  locale: text("locale").notNull().default("pt-BR"),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull().default(0),
});

export const workspaces = pgTable(
  "workspaces",
  {
    id: pk(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    industry: text("industry").notNull().default(""),
    website: text("website"),
    description: text("description").notNull().default(""),
    color: text("color").notNull().default("#2EE6A6"),
    environment: text("environment").$type<WorkspaceEnvironment>().notNull().default("LIVE"),
    status: text("status").$type<"ACTIVE" | "PAUSED" | "ARCHIVED">().notNull().default("ACTIVE"),
    operatingMode: text("operating_mode").$type<OperatingMode>().notNull().default("ASSISTED"),
    autopilotEnabled: boolean("autopilot_enabled").notNull().default(false),
    autopilotPermissions: jsonb("autopilot_permissions").$type<AutopilotPermissions>().notNull(),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    postsPerDay: integer("posts_per_day").notNull().default(2),
    postingSchedule: jsonb("posting_schedule").$type<string[]>().notNull().default(["09:00", "18:00"]),
    targetReadyBuffer: integer("target_ready_buffer").notNull().default(4),
    maxContentGeneratedPerDay: integer("max_content_generated_per_day").notNull().default(4),
    maxContentPublishedPerDay: integer("max_content_published_per_day").notNull().default(2),
    targetPlatforms: jsonb("target_platforms").$type<Platform[]>().notNull().default(["INSTAGRAM", "TIKTOK", "YOUTUBE"]),
    dailyAiBudgetUsd: numeric("daily_ai_budget_usd", { precision: 12, scale: 4, mode: "number" }),
    monthlyAiBudgetUsd: numeric("monthly_ai_budget_usd", { precision: 12, scale: 4, mode: "number" }),
    salesSettings: jsonb("sales_settings").$type<SalesSettings>().notNull(),
    retention: jsonb("retention").$type<RetentionSettings>().notNull(),
    currency: text("currency").notNull().default("BRL"),
    locale: text("locale").notNull().default("pt-BR"),
    whatsappNumber: text("whatsapp_number"),
    lastPerformanceReviewAt: ts("last_performance_review_at"),
    lastWeeklyStrategyAt: ts("last_weekly_strategy_at"),
    weeklyStrategy: jsonb("weekly_strategy").$type<Record<string, unknown> | null>(),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("workspaces_status_idx").on(t.status)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: pk(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: text("role").$type<"OWNER" | "ADMIN" | "MEMBER">().notNull().default("OWNER"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("workspace_members_ws_user_uq").on(t.workspaceId, t.userId),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: updatedAt(),
});

export const oauthStates = pgTable(
  "oauth_states",
  {
    id: pk(),
    stateHash: text("state_hash").notNull().unique(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    /** Encrypted JSON blob ({verifier, extra}) — never plaintext. */
    sealed: jsonb("sealed").$type<{ ciphertext: string; iv: string; tag: string } | null>(),
    redirectTo: text("redirect_to"),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("oauth_states_expires_idx").on(t.expiresAt)],
);

export const workerInstances = pgTable("worker_instances", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  machine: text("machine").notNull().default(""),
  platform: text("platform").notNull().default(""),
  version: text("version").notNull().default("0.0.0"),
  status: text("status").$type<"ONLINE" | "OFFLINE" | "PAUSED">().notNull().default("ONLINE"),
  paused: boolean("paused").notNull().default(false),
  lastHeartbeatAt: ts("last_heartbeat_at").notNull().defaultNow(),
  startedAt: ts("started_at").notNull().defaultNow(),
  capabilities: jsonb("capabilities").$type<Record<string, unknown>>().notNull().default({}),
  health: jsonb("health").$type<Record<string, unknown>>().notNull().default({}),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  currentJobs: jsonb("current_jobs").$type<{ id: string; type: string; startedAt: string }[]>().notNull().default([]),
  stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
  localUiUrl: text("local_ui_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const secrets = pgTable("secrets", {
  id: pk(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  createdAt: createdAt(),
  rotatedAt: ts("rotated_at"),
});

export const integrations = pgTable(
  "integrations",
  {
    id: pk(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    status: text("status").notNull().default("NOT_CONFIGURED"),
    mode: text("mode").$type<"LIVE" | "DEMO">().notNull().default("LIVE"),
    /** Non-secret configuration only (client ids, phone number id, public keys…). */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastTestedAt: ts("last_tested_at"),
    testResult: jsonb("test_result").$type<Record<string, unknown> | null>(),
    actionRequired: jsonb("action_required").$type<Record<string, unknown> | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("integrations_ws_key_uq").on(t.workspaceId, t.key).nullsNotDistinct()],
);

export const integrationCredentialsMetadata = pgTable(
  "integration_credentials_metadata",
  {
    id: pk(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id"),
    credentialType: text("credential_type").notNull(),
    secretId: uuid("secret_id")
      .notNull()
      .references(() => secrets.id, { onDelete: "cascade" }),
    last4: text("last4"),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("icm_integration_type_uq").on(t.integrationId, t.credentialType).where(sql`integration_id is not null`),
    uniqueIndex("icm_social_type_uq").on(t.socialAccountId, t.credentialType).where(sql`social_account_id is not null`),
    index("icm_ws_idx").on(t.workspaceId),
  ],
);
