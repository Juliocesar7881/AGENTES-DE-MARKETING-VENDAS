import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ActorType, ApprovalStatus, ApprovalType, JobRunner, JobStatus, JobType, NotificationType, Severity } from "@revenueos/shared";
import { createdAt, pk, ts, updatedAt } from "./_common";
import { profiles, workspaces } from "./identity";

export const jobs = pgTable(
  "jobs",
  {
    id: pk(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").$type<JobType>().notNull(),
    runner: text("runner").$type<JobRunner>().notNull().default("ANY"),
    /** Lower runs first. 10 = urgent (sales replies), 100 = normal, 200 = background. */
    priority: integer("priority").notNull().default(100),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<JobStatus>().notNull().default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    scheduledAt: ts("scheduled_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    lockedBy: text("locked_by"),
    lockedAt: ts("locked_at"),
    leaseExpiresAt: ts("lease_expires_at"),
    lastError: text("last_error"),
    errorDetails: jsonb("error_details").$type<Record<string, unknown> | null>(),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    idempotencyKey: text("idempotency_key").unique(),
    eventId: uuid("event_id"),
    parentJobId: uuid("parent_job_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("jobs_claim_idx").on(t.status, t.runner, t.priority, t.scheduledAt).where(sql`status in ('QUEUED','RETRYING')`),
    index("jobs_ws_created_idx").on(t.workspaceId, t.createdAt),
    index("jobs_type_status_idx").on(t.type, t.status),
    index("jobs_lease_idx").on(t.leaseExpiresAt).where(sql`status = 'RUNNING'`),
  ],
);

export const events = pgTable(
  "events",
  {
    id: pk(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    source: text("source").notNull().default("system"),
    dispatchedJobs: integer("dispatched_jobs").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("events_ws_created_idx").on(t.workspaceId, t.createdAt), index("events_type_idx").on(t.type, t.createdAt)],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: pk(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull().default(""),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    signatureValid: boolean("signature_valid").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: text("status").$type<"RECEIVED" | "PROCESSED" | "FAILED" | "IGNORED">().notNull().default("RECEIVED"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [uniqueIndex("webhook_events_provider_event_uq").on(t.provider, t.providerEventId), index("webhook_events_received_idx").on(t.receivedAt)],
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: pk(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").$type<ApprovalType>().notNull(),
    status: text("status").$type<ApprovalStatus>().notNull().default("PENDING"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    requestedBy: text("requested_by").notNull().default("SYSTEM"),
    decidedBy: uuid("decided_by").references(() => profiles.id, { onDelete: "set null" }),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("approval_requests_ws_status_idx").on(t.workspaceId, t.status),
    uniqueIndex("approval_requests_pending_entity_uq").on(t.type, t.entityId).where(sql`status = 'PENDING' and entity_id is not null`),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: pk(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id"),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id"),
    agentRole: text("agent_role"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    createdAt: createdAt(),
  },
  (t) => [index("activities_ws_created_idx").on(t.workspaceId, t.createdAt), index("activities_lead_idx").on(t.leadId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => profiles.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    severity: text("severity").$type<Severity>().notNull().default("INFO"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    readAt: ts("read_at"),
    dedupeKey: text("dedupe_key").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_ws_created_idx").on(t.workspaceId, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: pk(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_ws_created_idx").on(t.workspaceId, t.createdAt), index("audit_logs_action_idx").on(t.action)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: pk(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    jobId: uuid("job_id"),
    agentRunId: uuid("agent_run_id"),
    agentRole: text("agent_role").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_ws_created_idx").on(t.workspaceId, t.createdAt), index("ai_usage_created_idx").on(t.createdAt)],
);

export const dailyAnalytics = pgTable(
  "daily_analytics",
  {
    id: pk(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    postsPublished: integer("posts_published").notNull().default(0),
    contentsGenerated: integer("contents_generated").notNull().default(0),
    views: bigint("views", { mode: "number" }).notNull().default(0),
    reach: bigint("reach", { mode: "number" }).notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    qualifiedLeads: integer("qualified_leads").notNull().default(0),
    checkouts: integer("checkouts").notNull().default(0),
    sales: integer("sales").notNull().default(0),
    revenueCents: bigint("revenue_cents", { mode: "number" }).notNull().default(0),
    aiCostUsd: numeric("ai_cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("daily_analytics_ws_date_uq").on(t.workspaceId, t.date)],
);
