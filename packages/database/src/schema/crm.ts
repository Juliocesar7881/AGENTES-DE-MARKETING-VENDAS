import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  AttributionModel,
  CheckoutStatus,
  ConversationAiMode,
  DeliveryStatus,
  LeadStage,
  MessageSender,
  MessagingChannel,
  PaymentStatus,
  Platform,
} from "@revenueos/shared";
import { createdAt, pk, ts, updatedAt } from "./_common";
import { campaigns, products } from "./business";
import { contents, socialPosts } from "./content";
import { profiles, workspaces } from "./identity";

const wsRef = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

export const leads = pgTable(
  "leads",
  {
    id: pk(),
    workspaceId: wsRef(),
    name: text("name").notNull().default(""),
    username: text("username"),
    phone: text("phone"),
    email: text("email"),
    company: text("company"),
    /** Channel-specific identity, e.g. "whatsapp:5511999999999". Unique per workspace. */
    contactKey: text("contact_key"),
    channel: text("channel").$type<MessagingChannel>(),
    sourcePlatform: text("source_platform").$type<Platform | "WEBFORM" | "WHATSAPP" | "MANUAL">(),
    sourceSocialPostId: uuid("source_social_post_id").references(() => socialPosts.id, { onDelete: "set null" }),
    sourceContentId: uuid("source_content_id").references(() => contents.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    attributionModel: text("attribution_model").$type<AttributionModel>().notNull().default("NONE"),
    refCode: text("ref_code"),
    stage: text("stage").$type<LeadStage>().notNull().default("NEW"),
    score: integer("score").notNull().default(0),
    signals: jsonb("signals").$type<string[]>().notNull().default([]),
    qualifiedAt: ts("qualified_at"),
    wonAt: ts("won_at"),
    lostAt: ts("lost_at"),
    lostReason: text("lost_reason"),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    dncAt: ts("dnc_at"),
    dncReason: text("dnc_reason"),
    aiPaused: boolean("ai_paused").notNull().default(false),
    lastContactAt: ts("last_contact_at"),
    lastInboundAt: ts("last_inbound_at"),
    lastOutboundAt: ts("last_outbound_at"),
    nextAction: text("next_action"),
    nextActionAt: ts("next_action_at"),
    followupCount: integer("followup_count").notNull().default(0),
    notes: text("notes").notNull().default(""),
    isDemo: boolean("is_demo").notNull().default(false),
    anonymizedAt: ts("anonymized_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("leads_ws_contact_uq").on(t.workspaceId, t.contactKey).where(sql`contact_key is not null`),
    index("leads_ws_stage_idx").on(t.workspaceId, t.stage),
    index("leads_ws_content_idx").on(t.workspaceId, t.sourceContentId),
    index("leads_next_action_idx").on(t.nextActionAt),
    index("leads_ws_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

export const leadTags = pgTable(
  "lead_tags",
  {
    id: pk(),
    workspaceId: wsRef(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#7C6CFF"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("lead_tags_ws_name_uq").on(t.workspaceId, t.name)],
);

export const leadTagRelations = pgTable(
  "lead_tag_relations",
  {
    workspaceId: wsRef(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => leadTags.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.tagId] })],
);

export const leadScores = pgTable(
  "lead_scores",
  {
    id: pk(),
    workspaceId: wsRef(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    previousScore: integer("previous_score"),
    breakdown: jsonb("breakdown").$type<{ factor: string; points: number }[]>().notNull().default([]),
    reason: text("reason").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("lead_scores_lead_idx").on(t.leadId, t.createdAt)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: pk(),
    workspaceId: wsRef(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    channel: text("channel").$type<MessagingChannel>().notNull(),
    externalThreadId: text("external_thread_id"),
    status: text("status").$type<"OPEN" | "CLOSED">().notNull().default("OPEN"),
    aiMode: text("ai_mode").$type<ConversationAiMode>().notNull().default("AI"),
    assignedUserId: uuid("assigned_user_id").references(() => profiles.id, { onDelete: "set null" }),
    lastMessageAt: ts("last_message_at"),
    lastInboundAt: ts("last_inbound_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("conversations_ws_lead_channel_uq").on(t.workspaceId, t.leadId, t.channel),
    index("conversations_ws_last_idx").on(t.workspaceId, t.lastMessageAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: pk(),
    workspaceId: wsRef(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    direction: text("direction").$type<"INBOUND" | "OUTBOUND">().notNull(),
    senderType: text("sender_type").$type<MessageSender>().notNull(),
    senderUserId: uuid("sender_user_id").references(() => profiles.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    contentType: text("content_type").notNull().default("text"),
    externalMessageId: text("external_message_id"),
    deliveryStatus: text("delivery_status").$type<DeliveryStatus>().notNull().default("PENDING"),
    error: text("error"),
    agentRunId: uuid("agent_run_id"),
    jobId: uuid("job_id"),
    idempotencyKey: text("idempotency_key"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_ws_external_uq").on(t.workspaceId, t.externalMessageId).where(sql`external_message_id is not null`),
    uniqueIndex("messages_idempotency_uq").on(t.idempotencyKey).where(sql`idempotency_key is not null`),
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
  ],
);

export const conversationSummaries = pgTable("conversation_summaries", {
  id: pk(),
  workspaceId: wsRef(),
  conversationId: uuid("conversation_id")
    .notNull()
    .unique()
    .references(() => conversations.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  facts: jsonb("facts").$type<string[]>().notNull().default([]),
  needs: jsonb("needs").$type<string[]>().notNull().default([]),
  objections: jsonb("objections").$type<string[]>().notNull().default([]),
  budget: text("budget"),
  intent: text("intent"),
  lastState: text("last_state"),
  messagesCovered: integer("messages_covered").notNull().default(0),
  lastMessageId: uuid("last_message_id"),
  updatedAt: updatedAt(),
});

export const opportunities = pgTable(
  "opportunities",
  {
    id: pk(),
    workspaceId: wsRef(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    contentId: uuid("content_id").references(() => contents.id, { onDelete: "set null" }),
    socialPostId: uuid("social_post_id").references(() => socialPosts.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    stage: text("stage").$type<"OPEN" | "CHECKOUT" | "WON" | "LOST">().notNull().default("OPEN"),
    valueCents: integer("value_cents").notNull().default(0),
    currency: text("currency").notNull().default("BRL"),
    wonAt: ts("won_at"),
    lostReason: text("lost_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("opportunities_ws_idx").on(t.workspaceId, t.stage), index("opportunities_lead_idx").on(t.leadId)],
);

export const checkouts = pgTable(
  "checkouts",
  {
    id: pk(),
    workspaceId: wsRef(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    contentId: uuid("content_id").references(() => contents.id, { onDelete: "set null" }),
    socialPostId: uuid("social_post_id").references(() => socialPosts.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    providerCheckoutId: text("provider_checkout_id"),
    url: text("url"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("BRL"),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
    status: text("status").$type<CheckoutStatus>().notNull().default("CREATED"),
    externalReference: text("external_reference").notNull().unique(),
    expiresAt: ts("expires_at"),
    sentAt: ts("sent_at"),
    paidAt: ts("paid_at"),
    createdBy: text("created_by").$type<"AI" | "HUMAN">().notNull().default("AI"),
    approvalRequestId: uuid("approval_request_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("checkouts_ws_idx").on(t.workspaceId, t.status), index("checkouts_lead_idx").on(t.leadId)],
);

export const customers = pgTable(
  "customers",
  {
    id: pk(),
    workspaceId: wsRef(),
    leadId: uuid("lead_id")
      .notNull()
      .unique()
      .references(() => leads.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    email: text("email"),
    phone: text("phone"),
    firstPurchaseAt: ts("first_purchase_at"),
    totalRevenueCents: bigint("total_revenue_cents", { mode: "number" }).notNull().default(0),
    onboardingStatus: text("onboarding_status").$type<"PENDING" | "SENT" | "DONE">().notNull().default("PENDING"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("customers_ws_idx").on(t.workspaceId)],
);

export const payments = pgTable(
  "payments",
  {
    id: pk(),
    workspaceId: wsRef(),
    checkoutId: uuid("checkout_id").references(() => checkouts.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    contentId: uuid("content_id").references(() => contents.id, { onDelete: "set null" }),
    socialPostId: uuid("social_post_id").references(() => socialPosts.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    status: text("status").$type<PaymentStatus>().notNull().default("PENDING"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("BRL"),
    source: text("source").$type<"PROVIDER" | "MANUAL">().notNull().default("PROVIDER"),
    approvedAt: ts("approved_at"),
    refundedAt: ts("refunded_at"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    recordedBy: uuid("recorded_by").references(() => profiles.id, { onDelete: "set null" }),
    note: text("note"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payments_provider_id_uq").on(t.provider, t.providerPaymentId),
    index("payments_ws_status_idx").on(t.workspaceId, t.status, t.approvedAt),
    index("payments_content_idx").on(t.contentId),
  ],
);

export const attributionEvents = pgTable(
  "attribution_events",
  {
    id: pk(),
    workspaceId: wsRef(),
    eventType: text("event_type").notNull(),
    model: text("model").$type<AttributionModel>().notNull().default("NONE"),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    checkoutId: uuid("checkout_id").references(() => checkouts.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    contentId: uuid("content_id").references(() => contents.id, { onDelete: "set null" }),
    socialPostId: uuid("social_post_id").references(() => socialPosts.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    trackedLinkId: uuid("tracked_link_id"),
    amountCents: integer("amount_cents"),
    currency: text("currency"),
    visitorHash: text("visitor_hash"),
    path: jsonb("path").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("attribution_ws_type_idx").on(t.workspaceId, t.eventType, t.occurredAt),
    index("attribution_content_idx").on(t.contentId, t.eventType),
    uniqueIndex("attribution_payment_type_uq").on(t.paymentId, t.eventType).where(sql`payment_id is not null`),
    uniqueIndex("attribution_lead_type_uq").on(t.leadId, t.eventType).where(sql`event_type in ('LEAD','QUALIFIED')`),
  ],
);
