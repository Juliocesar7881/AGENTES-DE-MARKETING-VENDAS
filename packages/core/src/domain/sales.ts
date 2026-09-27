import { and, approvalRequests, asc, conversationSummaries, conversations, desc, eq, gt, leads, messages, products, workspaces } from "@revenueos/database";
import { EMPTY_MEMORY, salesReply, type SalesInput } from "@revenueos/agents";
import {
  AppError,
  isWithinBusinessHours,
  LEAD_SIGNALS,
  nextBusinessHoursStart,
  serializeError,
  type ConversationMemory,
  type LeadSignal,
  type SalesIntent,
} from "@revenueos/shared";
import { db, now } from "../deps";
import { emitEvent } from "../events";
import { RescheduleSignal, type JobOrigin } from "../jobs/queue";
import { messagingProviderFor, resolveAI, type Workspace } from "../providers";
import { audit, notify, recordActivity } from "../records";
import { recordAgentFailure, recordAgentRun, setAgentStatus } from "./agent-runs";
import { createCheckout, markCheckoutSent, type Checkout } from "./checkout";
import { loadBusinessContext } from "./context";
import { markDoNotContact, recomputeLeadScore } from "./leads";
import { nextLeadStage } from "./state-machines";
import { policy } from "./workspaces";
import { attributionEvents } from "@revenueos/database";

/**
 * Sends an outbound message through the conversation's channel and stores it.
 * Idempotent per `idempotencyKey` (a retried job never sends twice).
 */
export async function sendMessage(opts: {
  conversationId: string;
  text: string;
  sender: "AI" | "HUMAN" | "SYSTEM";
  userId?: string | null;
  idempotencyKey: string;
  agentRunId?: string | null;
  jobId?: string | null;
  allowTemplate?: boolean;
}): Promise<{ messageId: string; sent: boolean; reason?: string }> {
  const dup = await db().select().from(messages).where(eq(messages.idempotencyKey, opts.idempotencyKey)).limit(1);
  if (dup[0]) return { messageId: dup[0].id, sent: dup[0].deliveryStatus !== "FAILED" };
  const [conv] = await db().select().from(conversations).where(eq(conversations.id, opts.conversationId)).limit(1);
  if (!conv) throw new AppError({ code: "NOT_FOUND", userMessage: "Conversation not found." });
  const [lead] = await db().select().from(leads).where(eq(leads.id, conv.leadId)).limit(1);
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, conv.workspaceId)).limit(1);
  if (!lead || !ws) throw new AppError({ code: "NOT_FOUND", userMessage: "Lead not found." });
  if (lead.doNotContact && opts.sender !== "HUMAN") {
    return { messageId: "", sent: false, reason: "Lead is marked DO NOT CONTACT" };
  }
  const provider = await messagingProviderFor(ws, conv.channel);
  const windowOpen = provider.canSendFreeform(conv.lastInboundAt ?? lead.lastInboundAt ?? null, now());
  let externalId: string | null = null;
  let status: "SENT" | "DELIVERED" | "FAILED" = "SENT";
  let error: string | null = null;
  try {
    if (!windowOpen) {
      const tpl = ws.salesSettings.whatsappFollowupTemplate;
      if (conv.channel === "WHATSAPP" && tpl && opts.allowTemplate) {
        const r = await provider.sendTemplate({ to: conv.externalThreadId ?? lead.phone ?? "", templateName: tpl, language: ws.salesSettings.whatsappTemplateLanguage, variables: [lead.name || "cliente"], idempotencyKey: opts.idempotencyKey });
        externalId = r.externalMessageId;
        status = r.status === "DELIVERED" ? "DELIVERED" : "SENT";
      } else {
        throw new AppError({
          code: "MESSAGING_WINDOW_CLOSED",
          userMessage: "The 24-hour messaging window is closed for this lead. Only approved templates can be sent now — configure a follow-up template in Settings → Sales or reply manually.",
          retryable: false,
        });
      }
    } else {
      const r = await provider.sendText({ to: conv.externalThreadId ?? lead.phone ?? lead.username ?? "", text: opts.text, idempotencyKey: opts.idempotencyKey });
      externalId = r.externalMessageId;
      status = r.status === "DELIVERED" ? "DELIVERED" : "SENT";
    }
  } catch (e) {
    status = "FAILED";
    error = serializeError(e).userMessage;
    if (e instanceof AppError && !e.retryable) {
      // Keep a failed message record so the inbox shows what happened.
    } else {
      throw e;
    }
  }
  const [msg] = await db()
    .insert(messages)
    .values({
      workspaceId: ws.id,
      conversationId: conv.id,
      leadId: lead.id,
      direction: "OUTBOUND",
      senderType: opts.sender,
      senderUserId: opts.userId ?? null,
      body: opts.text,
      externalMessageId: externalId,
      deliveryStatus: status,
      error,
      agentRunId: opts.agentRunId ?? null,
      jobId: opts.jobId ?? null,
      idempotencyKey: opts.idempotencyKey,
    })
    .returning();
  if (status !== "FAILED") {
    await db().update(conversations).set({ lastMessageAt: now(), unreadCount: 0 }).where(eq(conversations.id, conv.id));
    await db()
      .update(leads)
      .set({ lastOutboundAt: now(), lastContactAt: now(), stage: lead.stage === "NEW" ? "CONTACTED" : lead.stage })
      .where(eq(leads.id, lead.id));
  }
  await audit({
    workspaceId: ws.id,
    actorType: opts.sender === "AI" ? "AGENT" : opts.sender === "HUMAN" ? "USER" : "SYSTEM",
    actorId: opts.userId ?? (opts.sender === "AI" ? "SALES" : null),
    action: opts.sender === "AI" ? "message.ai_sent" : "message.human_sent",
    entityType: "lead",
    entityId: lead.id,
    details: { channel: conv.channel, status, error },
  });
  return { messageId: msg!.id, sent: status !== "FAILED", reason: error ?? undefined };
}

function mergeMemory(prev: ConversationMemory, next: ConversationMemory): ConversationMemory {
  const uniq = (a: string[], b: string[], max: number) => [...new Set([...a, ...b])].slice(-max);
  return {
    summary: next.summary || prev.summary,
    facts: uniq(prev.facts, next.facts, 15),
    needs: uniq(prev.needs, next.needs, 10),
    objections: uniq(prev.objections, next.objections, 10),
    budget: next.budget ?? prev.budget,
    intent: next.intent,
    lastState: next.lastState,
  };
}

/**
 * Sales Agent run for one conversation. Guardrails before and after the AI:
 * DNC/opt-out, human takeover, operating mode, business hours, price guard,
 * discount limit, checkout policy and approval thresholds.
 */
export async function runSalesReply(opts: { conversationId: string; jobId: string; origin: JobOrigin; followUp?: boolean; triggerMessageId?: string | null }): Promise<Record<string, unknown>> {
  const [conv] = await db().select().from(conversations).where(eq(conversations.id, opts.conversationId)).limit(1);
  if (!conv) return { skipped: "conversation not found" };
  const [lead] = await db().select().from(leads).where(eq(leads.id, conv.leadId)).limit(1);
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, conv.workspaceId)).limit(1);
  if (!lead || !ws) return { skipped: "missing lead/workspace" };
  if (lead.doNotContact) return { skipped: "do not contact" };
  if (conv.aiMode !== "AI" || lead.aiPaused) return { skipped: `AI is ${conv.aiMode === "HUMAN" ? "handed over to a human" : "paused"} for this conversation` };
  const action = opts.followUp ? "followUp" : "replyLeads";
  const decision = policy(ws, action, opts.origin);
  if (decision !== "ALLOW" || !ws.salesSettings.autoReply) {
    await notify({ workspaceId: ws.id, type: "ACTION_REQUIRED", severity: "INFO", title: `New message from ${lead.name || "a lead"} waiting for reply`, body: "Automatic replies are off for this business.", link: `/w/${ws.slug}/inbox?c=${conv.id}`, dedupeKey: `reply_needed:${conv.id}:${conv.lastInboundAt?.getTime() ?? 0}` });
    return { skipped: "auto-reply disabled by mode/permissions" };
  }
  const bh = ws.salesSettings.businessHours;
  if (opts.origin !== "SIMULATION" && !isWithinBusinessHours(now(), ws.timezone, bh)) {
    const next = nextBusinessHoursStart(now(), ws.timezone, bh);
    throw new RescheduleSignal(Math.max(60, Math.round((next.getTime() - now().getTime()) / 1000)), "Outside business hours — reply scheduled for opening time.");
  }
  const recent = await db().select().from(messages).where(eq(messages.conversationId, conv.id)).orderBy(desc(messages.createdAt)).limit(12);
  const ordered = recent.reverse();
  const lastInbound = [...ordered].reverse().find((m) => m.direction === "INBOUND");
  const lastMsg = ordered[ordered.length - 1];
  if (!opts.followUp) {
    if (!lastMsg || lastMsg.direction === "OUTBOUND") return { skipped: "already replied to the latest message" };
    if (opts.triggerMessageId && lastInbound && lastInbound.id !== opts.triggerMessageId) {
      const newer = await db().select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, conv.id), eq(messages.direction, "INBOUND"), gt(messages.createdAt, lastInbound.createdAt))).limit(1);
      void newer; // a newer inbound message exists: this run answers the latest one (coalescing)
    }
  }
  const [summaryRow] = await db().select().from(conversationSummaries).where(eq(conversationSummaries.conversationId, conv.id)).limit(1);
  const memory: ConversationMemory = summaryRow
    ? { summary: summaryRow.summary, facts: summaryRow.facts, needs: summaryRow.needs, objections: summaryRow.objections, budget: summaryRow.budget, intent: (summaryRow.intent as SalesIntent) ?? "OTHER", lastState: summaryRow.lastState ?? "" }
    : EMPTY_MEMORY;
  const business = await loadBusinessContext(ws);
  const productList = await db().select().from(products).where(and(eq(products.workspaceId, ws.id), eq(products.active, true)));
  const input: SalesInput = {
    business,
    products: business.products,
    lead: { id: lead.id, name: lead.name, stage: lead.stage, productId: lead.productId, source: lead.sourcePlatform, score: lead.score },
    memory,
    messages: ordered.map((m) => ({ sender: m.senderType, body: m.body, at: m.createdAt.toISOString() })),
    rules: { maxDiscountPct: ws.salesSettings.maxDiscountPct, allowCheckout: ws.salesSettings.allowCheckout && productList.length > 0 },
    followUp: opts.followUp ? { attempt: lead.followupCount + 1, hoursSinceLastContact: (now().getTime() - (lead.lastContactAt ?? lead.createdAt).getTime()) / 3600_000 } : null,
  };
  const ai = await resolveAI(ws, "sales");
  await setAgentStatus(ws.id, "SALES", "WORKING", { task: `Replying to ${lead.name || "lead"}`, jobId: opts.jobId });
  let out;
  let runId: string;
  try {
    const res = await salesReply(ai.runtime, input);
    runId = await recordAgentRun({ workspaceId: ws.id, jobId: opts.jobId, isDemo: ai.isMock, result: res });
    out = res.result.data;
  } catch (e) {
    await recordAgentFailure({ workspaceId: ws.id, jobId: opts.jobId, agent: "SALES", task: "sales.reply", provider: ai.providerId, model: ai.runtime.model.model, promptVersion: "sales", error: e });
    await setAgentStatus(ws.id, "SALES", "ERROR", { error: serializeError(e).userMessage });
    throw e;
  }

  // Memory (summary instead of resending the full history next time)
  const merged = mergeMemory(memory, out.memory);
  await db()
    .insert(conversationSummaries)
    .values({ workspaceId: ws.id, conversationId: conv.id, ...merged, messagesCovered: ordered.length, lastMessageId: lastMsg?.id ?? null })
    .onConflictDoUpdate({ target: conversationSummaries.conversationId, set: { ...merged, messagesCovered: ordered.length, lastMessageId: lastMsg?.id ?? null, updatedAt: now() } });

  if (out.intent === "OPT_OUT") {
    await markDoNotContact(lead.id, "Sales Agent detected an opt-out request", { type: "AGENT", id: "SALES" });
    await setAgentStatus(ws.id, "SALES", "IDLE");
    return { optOut: true };
  }

  // Signals, qualification, stage (forward-only; WON only via confirmed payment)
  const signals = [...new Set([...(lead.signals as LeadSignal[]), ...out.signals.filter((s) => (LEAD_SIGNALS as readonly string[]).includes(s))])];
  const newStage = nextLeadStage(lead.stage, out.suggestedStage, { automatic: true });
  const becameQualified = out.qualified && !lead.qualifiedAt && policy(ws, "qualifyLeads", opts.origin) === "ALLOW";
  await db()
    .update(leads)
    .set({
      signals,
      stage: becameQualified && newStage !== "CHECKOUT" ? (newStage === "NEW" || newStage === "CONTACTED" || newStage === "ENGAGED" ? "QUALIFIED" : newStage) : newStage,
      qualifiedAt: becameQualified ? now() : lead.qualifiedAt,
      nextAction: out.followUpInHours ? (opts.followUp ? "Follow-up" : "Follow-up if no reply") : null,
      nextActionAt: out.followUpInHours ? new Date(now().getTime() + out.followUpInHours * 3600_000) : null,
      followupCount: opts.followUp ? lead.followupCount + 1 : lead.followupCount,
    })
    .where(eq(leads.id, lead.id));
  if (becameQualified) {
    await db().insert(attributionEvents).values({ workspaceId: ws.id, eventType: "QUALIFIED", model: lead.attributionModel, leadId: lead.id, contentId: lead.sourceContentId, socialPostId: lead.sourceSocialPostId, campaignId: lead.campaignId, productId: lead.productId }).onConflictDoNothing();
    await emitEvent({ type: "LEAD_QUALIFIED", workspaceId: ws.id, idempotencyKey: `lead_qualified:${lead.id}`, payload: { leadId: lead.id } });
    await recordActivity({ workspaceId: ws.id, leadId: lead.id, type: "LEAD_QUALIFIED", title: `${lead.name || "Lead"} qualified`, agentRole: "SALES", entityType: "lead", entityId: lead.id });
    await notify({ workspaceId: ws.id, type: "LEAD_QUALIFIED", severity: "SUCCESS", title: `Lead qualified: ${lead.name || "new lead"}`, link: `/w/${ws.slug}/crm/${lead.id}`, dedupeKey: `qualified:${lead.id}` });
  }

  let reply = out.reply.trim();
  let checkout: Checkout | null = null;
  let checkoutNote: string | null = null;

  // Checkout request → policy, discount limit, approval threshold
  if (out.requestCheckout && ws.salesSettings.allowCheckout) {
    const gen = policy(ws, "generateCheckout", opts.origin);
    if (gen === "ALLOW") {
      if (out.requestCheckout.discountPct > ws.salesSettings.maxDiscountPct) {
        await createApproval(ws, "DISCOUNT", `Discount ${out.requestCheckout.discountPct}% requested for ${lead.name || "lead"}`, { leadId: lead.id, conversationId: conv.id, ...out.requestCheckout }, lead.id);
        checkoutNote = "discount approval requested";
      } else {
        try {
          checkout = await createCheckout({ workspaceId: ws.id, leadId: lead.id, productId: out.requestCheckout.productId, discountPct: out.requestCheckout.discountPct, conversationId: conv.id, createdBy: "AI" });
          const send = policy(ws, "sendCheckout", opts.origin);
          if (send === "ALLOW" && checkout.amountCents <= ws.salesSettings.humanApprovalThresholdCents) {
            reply = `${reply}\n\n🔒 Link seguro de pagamento: ${checkout.url}`;
            await markCheckoutSent(checkout.id);
          } else {
            await createApproval(ws, "SEND_CHECKOUT", `Send checkout to ${lead.name || "lead"}`, { checkoutId: checkout.id, conversationId: conv.id, leadId: lead.id }, checkout.id);
            checkoutNote = "checkout awaiting approval";
          }
        } catch (e) {
          checkoutNote = serializeError(e).userMessage;
          await notify({ workspaceId: ws.id, type: "ACTION_REQUIRED", severity: "WARNING", title: "Could not create checkout", body: checkoutNote, link: `/w/${ws.slug}/integrations`, dedupeKey: `checkout_fail:${lead.id}:${now().toISOString().slice(0, 13)}` });
        }
      }
    }
  }

  if (out.handoffToHuman) {
    await db().update(conversations).set({ aiMode: "PAUSED" }).where(eq(conversations.id, conv.id));
    await notify({ workspaceId: ws.id, type: "ACTION_REQUIRED", severity: "WARNING", title: `Human needed: ${lead.name || "lead"}`, body: out.handoffReason ?? "The Sales Agent handed this conversation to a human.", link: `/w/${ws.slug}/inbox?c=${conv.id}`, dedupeKey: `handoff:${conv.id}:${lastInbound?.id ?? ""}` });
  }

  let sent = false;
  if (reply) {
    if (out.sensitive) {
      await createApproval(ws, "SENSITIVE_MESSAGE", `Review sensitive reply to ${lead.name || "lead"}`, { conversationId: conv.id, text: reply, agentRunId: runId }, lastInbound?.id ?? null);
    } else {
      const r = await sendMessage({ conversationId: conv.id, text: reply, sender: "AI", idempotencyKey: `ai-reply:${opts.jobId}`, agentRunId: runId, jobId: opts.jobId, allowTemplate: opts.followUp });
      sent = r.sent;
      if (sent) {
        await recordActivity({ workspaceId: ws.id, leadId: lead.id, type: opts.followUp ? "FOLLOW_UP_SENT" : "AI_REPLIED", title: `Sales Agent ${opts.followUp ? "followed up with" : "replied to"} ${lead.name || "lead"}${checkout && reply.includes(checkout.url ?? "--") ? " with checkout link" : ""}`, agentRole: "SALES", entityType: "conversation", entityId: conv.id });
        if (checkout && reply.includes(checkout.url ?? "--")) {
          await recordActivity({ workspaceId: ws.id, leadId: lead.id, type: "CHECKOUT_SENT", title: `Checkout sent to ${lead.name || "lead"}`, agentRole: "SALES", entityType: "checkout", entityId: checkout.id });
        }
      } else if (r.reason) {
        await notify({ workspaceId: ws.id, type: "ACTION_REQUIRED", severity: "WARNING", title: `Message not sent to ${lead.name || "lead"}`, body: r.reason, link: `/w/${ws.slug}/inbox?c=${conv.id}`, dedupeKey: `send_fail:${conv.id}:${now().toISOString().slice(0, 13)}` });
      }
    }
  }
  await recomputeLeadScore(lead.id, "sales conversation");
  await setAgentStatus(ws.id, "SALES", "IDLE");
  return { sent, intent: out.intent, qualified: out.qualified, checkoutId: checkout?.id ?? null, checkoutNote };
}

async function createApproval(ws: Workspace, type: "DISCOUNT" | "SEND_CHECKOUT" | "SENSITIVE_MESSAGE", title: string, payload: Record<string, unknown>, entityId: string | null): Promise<void> {
  await db()
    .insert(approvalRequests)
    .values({ workspaceId: ws.id, type, title, payload, entityType: type === "SEND_CHECKOUT" ? "checkout" : "lead", entityId, requestedBy: "SALES" })
    .onConflictDoNothing();
  await notify({ workspaceId: ws.id, type: "APPROVAL_REQUIRED", severity: "WARNING", title, body: "Review in Autopilot → Approvals.", link: `/w/${ws.slug}/autopilot`, dedupeKey: `approval:${type}:${entityId ?? title}` });
}

/** Executes an approved/rejected approval request. */
export async function decideApproval(approvalId: string, decision: "APPROVED" | "REJECTED", userId: string, note?: string): Promise<void> {
  const [req] = await db().select().from(approvalRequests).where(eq(approvalRequests.id, approvalId)).limit(1);
  if (!req || req.status !== "PENDING") throw new AppError({ code: "APPROVAL_NOT_PENDING", userMessage: "This approval was already decided." });
  await db().update(approvalRequests).set({ status: decision, decidedBy: userId, decidedAt: now(), decisionNote: note ?? null }).where(eq(approvalRequests.id, approvalId));
  await audit({ workspaceId: req.workspaceId, actorType: "USER", actorId: userId, action: `approval.${decision.toLowerCase()}`, entityType: "approval", entityId: approvalId, details: { type: req.type } });
  if (decision === "REJECTED") return;
  const p = req.payload as Record<string, string | number>;
  switch (req.type) {
    case "PUBLISH_CONTENT": {
      const { approveContent } = await import("./content");
      await approveContent(String(p.contentId), userId);
      break;
    }
    case "SEND_CHECKOUT": {
      const [conv] = await db().select().from(conversations).where(eq(conversations.id, String(p.conversationId))).limit(1);
      const { checkouts } = await import("@revenueos/database");
      const [chk] = await db().select().from(checkouts).where(eq(checkouts.id, String(p.checkoutId))).limit(1);
      if (conv && chk?.url) {
        await sendMessage({ conversationId: conv.id, text: `Aqui está o seu link seguro de pagamento: ${chk.url}`, sender: "HUMAN", userId, idempotencyKey: `approved-checkout:${chk.id}` });
        await markCheckoutSent(chk.id);
      }
      break;
    }
    case "DISCOUNT": {
      const chk = await createCheckout({ workspaceId: req.workspaceId, leadId: String(p.leadId), productId: String(p.productId), discountPct: Number(p.discountPct), conversationId: String(p.conversationId), createdBy: "HUMAN", userId });
      await sendMessage({ conversationId: String(p.conversationId), text: `Consegui a condição especial para você! Link seguro: ${chk.url}`, sender: "HUMAN", userId, idempotencyKey: `approved-discount:${chk.id}` });
      await markCheckoutSent(chk.id);
      break;
    }
    case "SENSITIVE_MESSAGE":
      await sendMessage({ conversationId: String(p.conversationId), text: String(p.text), sender: "AI", userId, idempotencyKey: `approved-msg:${approvalId}` });
      break;
    default:
      break;
  }
}

/** Inbox controls: PAUSE AI / TAKE OVER / RETURN TO AI. */
export async function setConversationMode(conversationId: string, mode: "AI" | "PAUSED" | "HUMAN", userId: string): Promise<void> {
  const [conv] = await db().update(conversations).set({ aiMode: mode, assignedUserId: mode === "HUMAN" ? userId : null }).where(eq(conversations.id, conversationId)).returning();
  if (!conv) return;
  await db().update(leads).set({ aiPaused: mode !== "AI" }).where(eq(leads.id, conv.leadId));
  const labels = { AI: "returned the conversation to AI", PAUSED: "paused the AI", HUMAN: "took over the conversation" } as const;
  await recordActivity({ workspaceId: conv.workspaceId, leadId: conv.leadId, type: "CONVERSATION_MODE", title: `Human ${labels[mode]}`, actorType: "USER", actorId: userId, entityType: "conversation", entityId: conv.id });
  await audit({ workspaceId: conv.workspaceId, actorType: "USER", actorId: userId, action: mode === "HUMAN" ? "conversation.human_takeover" : `conversation.${mode.toLowerCase()}`, entityType: "conversation", entityId: conv.id });
}

export async function conversationMessages(conversationId: string) {
  return db().select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
}
