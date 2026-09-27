import {
  and,
  attributionEvents,
  checkouts,
  conversations,
  desc,
  eq,
  gte,
  leadScores,
  leads,
  messages,
  socialPosts,
  sql,
  trackedLinks,
  workspaces,
  type DbExecutor,
} from "@revenueos/database";
import {
  computeLeadScore,
  detectOptOut,
  type AttributionModel,
  type LeadSignal,
  type LeadStage,
  type MessagingChannel,
  type Platform,
} from "@revenueos/shared";
import { sha256Hex as hash } from "@revenueos/shared/server";
import { db, now } from "../deps";
import { emitEvent } from "../events";
import type { JobOrigin } from "../jobs/queue";
import type { Workspace } from "../providers";
import { audit, notify, recordActivity } from "../records";

export type Lead = typeof leads.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;

const REF_RE = /\b([A-HJ-NP-Z2-9]{6})\b/g;

export interface AttributionResolution {
  model: AttributionModel;
  socialPostId: string | null;
  contentId: string | null;
  campaignId: string | null;
  productId: string | null;
  refCode: string | null;
  platform: Platform | null;
}

const NONE: AttributionResolution = { model: "NONE", socialPostId: null, contentId: null, campaignId: null, productId: null, refCode: null, platform: null };

/**
 * Links a new lead to the content that brought it:
 *  1. ref code from a tracked link / caption (exact)
 *  2. platform referral id (click-to-message)
 *  3. INFERRED_RECENT: most recent publication in the last 72h (labeled as inferred)
 * Attribution is observational — never presented as causation.
 */
export async function resolveAttribution(workspaceId: string, text: string, referral?: { sourceId?: string | null } | null, exec: DbExecutor = db()): Promise<AttributionResolution> {
  const codes = [...new Set([...text.toUpperCase().matchAll(REF_RE)].map((m) => m[1]!))];
  for (const code of codes) {
    const [link] = await exec.select().from(trackedLinks).where(and(eq(trackedLinks.code, code), eq(trackedLinks.workspaceId, workspaceId))).limit(1);
    if (link) {
      const post = link.socialPostId ? (await exec.select().from(socialPosts).where(eq(socialPosts.id, link.socialPostId)).limit(1))[0] : undefined;
      return { model: "REF_CODE", socialPostId: link.socialPostId, contentId: link.contentId, campaignId: link.campaignId, productId: link.productId, refCode: code, platform: post?.platform ?? null };
    }
  }
  if (referral?.sourceId) {
    const [post] = await exec
      .select()
      .from(socialPosts)
      .where(and(eq(socialPosts.workspaceId, workspaceId), eq(socialPosts.platformPostId, referral.sourceId)))
      .limit(1);
    if (post) {
      const [link] = post.trackedLinkCode ? await exec.select().from(trackedLinks).where(eq(trackedLinks.code, post.trackedLinkCode)).limit(1) : [];
      return { model: "PLATFORM_REFERRAL", socialPostId: post.id, contentId: post.contentId, campaignId: link?.campaignId ?? null, productId: link?.productId ?? null, refCode: null, platform: post.platform };
    }
  }
  const [recent] = await exec
    .select()
    .from(socialPosts)
    .where(and(eq(socialPosts.workspaceId, workspaceId), eq(socialPosts.status, "PUBLISHED"), gte(socialPosts.publishedAt, new Date(now().getTime() - 72 * 3600 * 1000))))
    .orderBy(desc(socialPosts.publishedAt))
    .limit(1);
  if (recent) {
    const [link] = recent.trackedLinkCode ? await exec.select().from(trackedLinks).where(eq(trackedLinks.code, recent.trackedLinkCode)).limit(1) : [];
    return { model: "INFERRED_RECENT", socialPostId: recent.id, contentId: recent.contentId, campaignId: link?.campaignId ?? null, productId: link?.productId ?? null, refCode: null, platform: recent.platform };
  }
  return NONE;
}

/** Tracked link click (/r/:code): records the click without storing personal data (hashed, daily). */
export async function recordClick(code: string, visitor: { ip: string; userAgent: string }): Promise<{ url: string } | null> {
  const [link] = await db().select().from(trackedLinks).where(eq(trackedLinks.code, code.toUpperCase())).limit(1);
  if (!link) return null;
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, link.workspaceId)).limit(1);
  if (!ws) return null;
  const visitorHash = hash(`${visitor.ip}|${visitor.userAgent}|${now().toISOString().slice(0, 10)}`).slice(0, 32);
  const dup = await db()
    .select({ id: attributionEvents.id })
    .from(attributionEvents)
    .where(and(eq(attributionEvents.trackedLinkId, link.id), eq(attributionEvents.visitorHash, visitorHash)))
    .limit(1);
  if (!dup[0]) {
    await db().insert(attributionEvents).values({
      workspaceId: link.workspaceId,
      eventType: "CLICK",
      model: "TRACKED_LINK",
      socialPostId: link.socialPostId,
      contentId: link.contentId,
      campaignId: link.campaignId,
      productId: link.productId,
      trackedLinkId: link.id,
      visitorHash,
      path: { code: link.code },
    });
    await db().update(trackedLinks).set({ clicks: sql`${trackedLinks.clicks} + 1` }).where(eq(trackedLinks.id, link.id));
  }
  const text = encodeURIComponent(`Olá! Vim pelo vídeo e quero saber mais (código ${link.code})`);
  if (ws.whatsappNumber) return { url: `https://wa.me/${ws.whatsappNumber.replace(/\D/g, "")}?text=${text}` };
  return { url: `/l/${ws.slug}?ref=${link.code}` };
}

export async function recomputeLeadScore(leadId: string, reason: string, exec: DbExecutor = db()): Promise<number> {
  const [lead] = await exec.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return 0;
  const [ws] = await exec.select().from(workspaces).where(eq(workspaces.id, lead.workspaceId)).limit(1);
  const inbound = await exec
    .select({ n: sql<number>`count(*)` })
    .from(messages)
    .where(and(eq(messages.leadId, leadId), eq(messages.direction, "INBOUND")));
  const chk = await exec.select({ n: sql<number>`count(*)` }).from(checkouts).where(eq(checkouts.leadId, leadId));
  const result = computeLeadScore(
    {
      hasPhone: Boolean(lead.phone),
      hasEmail: Boolean(lead.email),
      inboundMessages: Number(inbound[0]?.n ?? 0),
      qualified: Boolean(lead.qualifiedAt),
      checkoutCreated: Number(chk[0]?.n ?? 0) > 0,
      attributed: lead.attributionModel !== "NONE",
      signals: lead.signals as LeadSignal[],
    },
    ws?.salesSettings.leadScoringWeights,
  );
  if (result.score !== lead.score) {
    await exec.update(leads).set({ score: result.score }).where(eq(leads.id, leadId));
    await exec.insert(leadScores).values({ workspaceId: lead.workspaceId, leadId, score: result.score, previousScore: lead.score, breakdown: result.breakdown, reason });
  }
  return result.score;
}

export async function markDoNotContact(leadId: string, reason: string, actor: { type: "USER" | "AGENT" | "SYSTEM"; id?: string | null }): Promise<void> {
  const [lead] = await db()
    .update(leads)
    .set({ doNotContact: true, dncAt: now(), dncReason: reason, aiPaused: true, nextAction: null, nextActionAt: null })
    .where(eq(leads.id, leadId))
    .returning();
  if (!lead) return;
  await db().update(conversations).set({ aiMode: "PAUSED" }).where(eq(conversations.leadId, leadId));
  await recordActivity({ workspaceId: lead.workspaceId, leadId, type: "DO_NOT_CONTACT", title: `${lead.name || "Lead"} opted out — marked DO NOT CONTACT`, actorType: actor.type, actorId: actor.id ?? null, entityType: "lead", entityId: leadId, details: { reason } });
  await audit({ workspaceId: lead.workspaceId, actorType: actor.type, actorId: actor.id ?? null, action: "lead.do_not_contact", entityType: "lead", entityId: leadId, details: { reason } });
}

export interface InboundInput {
  workspaceId: string;
  channel: MessagingChannel;
  from: string;
  fromName?: string | null;
  text: string;
  externalMessageId: string;
  timestamp?: Date;
  referral?: { sourceId?: string | null } | null;
  email?: string | null;
  phone?: string | null;
  refCode?: string | null;
  /** Who triggers the reply job: real webhooks (default) or the demo simulation. */
  origin?: JobOrigin;
}

/**
 * Entry point for every inbound message (WhatsApp/Instagram webhooks, web
 * forms, demo simulation). Idempotent per external message id. Creates the
 * lead with attribution, stores the message, detects opt-out and emits
 * MESSAGE_RECEIVED (→ Sales Agent).
 */
export async function processInboundMessage(input: InboundInput): Promise<{ leadId: string; conversationId: string; messageId: string; duplicate: boolean; optOut: boolean; newLead: boolean }> {
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
  if (!ws) throw new Error("workspace not found");
  const existingMsg = await db()
    .select()
    .from(messages)
    .where(and(eq(messages.workspaceId, ws.id), eq(messages.externalMessageId, input.externalMessageId)))
    .limit(1);
  if (existingMsg[0]) return { leadId: existingMsg[0].leadId, conversationId: existingMsg[0].conversationId, messageId: existingMsg[0].id, duplicate: true, optOut: false, newLead: false };

  const ts = input.timestamp ?? now();
  const contactKey = `${input.channel.toLowerCase()}:${input.from}`;
  return db().transaction(async (tx) => {
    let [lead] = await tx.select().from(leads).where(and(eq(leads.workspaceId, ws.id), eq(leads.contactKey, contactKey))).limit(1);
    let newLead = false;
    if (!lead) {
      const attr = await resolveAttribution(ws.id, `${input.refCode ?? ""} ${input.text}`, input.referral, tx);
      [lead] = await tx
        .insert(leads)
        .values({
          workspaceId: ws.id,
          name: input.fromName ?? "",
          username: input.channel === "INSTAGRAM" ? input.from : null,
          phone: input.phone ?? (input.channel === "WHATSAPP" ? input.from : null),
          email: input.email ?? null,
          contactKey,
          channel: input.channel,
          sourcePlatform: attr.platform ?? (input.channel === "WEBFORM" ? "WEBFORM" : input.channel === "WHATSAPP" ? "WHATSAPP" : null),
          sourceSocialPostId: attr.socialPostId,
          sourceContentId: attr.contentId,
          campaignId: attr.campaignId,
          productId: attr.productId,
          attributionModel: attr.model,
          refCode: attr.refCode,
          stage: "NEW",
          isDemo: ws.environment === "DEMO",
          lastInboundAt: ts,
          lastContactAt: ts,
        })
        .returning();
      newLead = true;
      await tx.insert(attributionEvents).values({
        workspaceId: ws.id,
        eventType: "LEAD",
        model: attr.model,
        leadId: lead!.id,
        contentId: attr.contentId,
        socialPostId: attr.socialPostId,
        campaignId: attr.campaignId,
        productId: attr.productId,
        path: { refCode: attr.refCode, channel: input.channel },
      }).onConflictDoNothing();
      await emitEvent({ type: "LEAD_CREATED", workspaceId: ws.id, idempotencyKey: `lead_created:${lead!.id}`, payload: { leadId: lead!.id, contentId: attr.contentId } }, tx);
      await recordActivity({ workspaceId: ws.id, leadId: lead!.id, type: "LEAD_CREATED", title: `New lead ${input.fromName || input.from}${attr.contentId ? " from content" : ""} via ${input.channel}`, entityType: "lead", entityId: lead!.id, details: { attribution: attr.model, refCode: attr.refCode } }, tx);
      await notify({ workspaceId: ws.id, type: "NEW_LEAD", severity: "INFO", title: `New lead: ${input.fromName || input.from}`, body: input.text.slice(0, 140), link: `/w/${ws.slug}/crm/${lead!.id}`, dedupeKey: `new_lead:${lead!.id}` }, tx);
    } else {
      await tx.update(leads).set({ lastInboundAt: ts, lastContactAt: ts, followupCount: 0, name: lead.name || input.fromName || "" }).where(eq(leads.id, lead.id));
    }
    let [conv] = await tx.select().from(conversations).where(and(eq(conversations.workspaceId, ws.id), eq(conversations.leadId, lead!.id), eq(conversations.channel, input.channel))).limit(1);
    if (!conv) {
      [conv] = await tx
        .insert(conversations)
        .values({ workspaceId: ws.id, leadId: lead!.id, channel: input.channel, externalThreadId: input.from, isDemo: ws.environment === "DEMO", aiMode: lead!.doNotContact ? "PAUSED" : "AI" })
        .returning();
    }
    const [msg] = await tx
      .insert(messages)
      .values({ workspaceId: ws.id, conversationId: conv!.id, leadId: lead!.id, direction: "INBOUND", senderType: "LEAD", body: input.text, externalMessageId: input.externalMessageId, deliveryStatus: "RECEIVED", createdAt: ts })
      .returning();
    await tx
      .update(conversations)
      .set({ lastMessageAt: ts, lastInboundAt: ts, unreadCount: sql`${conversations.unreadCount} + 1`, status: "OPEN" })
      .where(eq(conversations.id, conv!.id));
    const optOut = detectOptOut(input.text).optOut;
    if (!optOut && !lead!.doNotContact) {
      await emitEvent({ type: "MESSAGE_RECEIVED", workspaceId: ws.id, idempotencyKey: `message_received:${msg!.id}`, payload: { conversationId: conv!.id, messageId: msg!.id, leadId: lead!.id } }, tx, input.origin ?? "WEBHOOK");
    }
    if (lead!.stage === "NEW" && !newLead) await tx.update(leads).set({ stage: "ENGAGED" as LeadStage }).where(eq(leads.id, lead!.id));
    return { leadId: lead!.id, conversationId: conv!.id, messageId: msg!.id, duplicate: false, optOut, newLead };
  }).then(async (r) => {
    if (r.optOut) await markDoNotContact(r.leadId, "Lead asked to stop receiving messages", { type: "SYSTEM" });
    await recomputeLeadScore(r.leadId, r.newLead ? "lead created" : "inbound message");
    return r;
  });
}
