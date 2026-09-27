"use server";
import { revalidatePath } from "next/cache";
import { anonymizeLead, createCheckout, createManualLead, markCheckoutSent, moveLeadStage, recordManualSale, sendMessage, setConversationMode, setLeadDoNotContact, updateLeadNotes } from "@revenueos/core";
import { and, conversations, desc, eq, leads, withUser, workspaces } from "@revenueos/database";
import { AppError, AuthorizationError, LEAD_STAGES, type LeadStage } from "@revenueos/shared";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { run } from "../action";
import { kick } from "../runner";
import { requireUser } from "../session";

async function ownedLead(leadId: string) {
  const user = await requireUser();
  const [row] = await withUser(user.id, (tx) => tx.select({ l: leads, slug: workspaces.slug }).from(leads).innerJoin(workspaces, eq(workspaces.id, leads.workspaceId)).where(eq(leads.id, leadId)).limit(1));
  if (!row) throw new AuthorizationError("Lead not found.");
  return { user, lead: row.l, slug: row.slug };
}

function refresh(slug: string, leadId?: string) {
  revalidatePath(`/w/${slug}/crm`);
  if (leadId) revalidatePath(`/w/${slug}/crm/${leadId}`);
  revalidatePath(`/w/${slug}/inbox`);
  revalidatePath(`/w/${slug}`);
}

export async function moveLeadAction(leadId: string, stage: LeadStage, lostReason?: string) {
  return run(async () => {
    if (!LEAD_STAGES.includes(stage)) throw new AppError({ code: "BAD_STAGE", userMessage: "Unknown stage." });
    const { user, slug } = await ownedLead(leadId);
    await moveLeadStage(leadId, stage, user.id, lostReason);
    refresh(slug, leadId);
    return null;
  }, "Lead moved");
}

export async function createLeadAction(workspaceId: string, input: unknown) {
  return run(async () => {
    const user = await requireUser();
    const id = await createManualLead(workspaceId, user.id, input);
    const [ws] = await withUser(user.id, (tx) => tx.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1));
    if (ws) refresh(ws.slug);
    return { id };
  }, "Lead added");
}

export async function updateNotesAction(leadId: string, notes: string) {
  return run(async () => {
    const { user, slug } = await ownedLead(leadId);
    await updateLeadNotes(leadId, user.id, notes);
    refresh(slug, leadId);
    return null;
  }, "Notes saved");
}

export async function doNotContactAction(leadId: string, reason: string) {
  return run(async () => {
    const { user, slug } = await ownedLead(leadId);
    await setLeadDoNotContact(leadId, user.id, reason);
    refresh(slug, leadId);
    return null;
  }, "Marked DO NOT CONTACT — no more automatic messages");
}

/** LGPD deletion: personal data is erased; payments stay for accounting, detached from the person. */
export async function anonymizeLeadAction(leadId: string, reason: string) {
  return run(async () => {
    const { user, lead, slug } = await ownedLead(leadId);
    await anonymizeLead(lead.workspaceId, leadId, { userId: user.id, reason: reason || "Data subject request" });
    refresh(slug, leadId);
    return null;
  }, "Personal data deleted (anonymized)");
}

const ManualSaleSchema = z.object({
  amountCents: z.number().int().min(1).max(100_000_000),
  productId: z.string().uuid().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  contentId: z.string().uuid().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** Sales received outside the system (cash, PIX to another account…). Always labeled source MANUAL. */
export async function manualSaleAction(workspaceId: string, input: unknown) {
  return run(async () => {
    const user = await requireUser();
    const d = ManualSaleSchema.parse(input);
    const [ws] = await withUser(user.id, (tx) => tx.select({ slug: workspaces.slug, currency: workspaces.currency }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1));
    if (!ws) throw new AuthorizationError("Business not found.");
    if (d.leadId) {
      const [l] = await withUser(user.id, (tx) => tx.select({ id: leads.id }).from(leads).where(and(eq(leads.id, d.leadId!), eq(leads.workspaceId, workspaceId))).limit(1));
      if (!l) throw new AuthorizationError("Lead not found.");
    }
    const id = await recordManualSale({ workspaceId, userId: user.id, amountCents: d.amountCents, currency: ws.currency, leadId: d.leadId ?? null, productId: d.productId ?? null, contentId: d.contentId ?? null, note: d.note ?? null });
    kick([workspaceId]);
    refresh(ws.slug, d.leadId ?? undefined);
    revalidatePath(`/w/${ws.slug}/sales`);
    return { id };
  }, "Manual sale recorded");
}

/** Human creates a checkout link and (optionally) sends it in the lead's conversation. */
export async function sendCheckoutAction(leadId: string, productId: string, discountPct: number, send: boolean) {
  return run(async () => {
    const { user, lead, slug } = await ownedLead(leadId);
    const chk = await createCheckout({ workspaceId: lead.workspaceId, leadId, productId, discountPct, createdBy: "HUMAN", userId: user.id });
    if (send) {
      const [conv] = await withUser(user.id, (tx) => tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.leadId, leadId)).orderBy(desc(conversations.lastMessageAt)).limit(1));
      if (!conv) throw new AppError({ code: "NO_CONVERSATION", userMessage: "This lead has no conversation to send the link to. Copy the link instead." });
      await sendMessage({ conversationId: conv.id, text: `Aqui está o link para finalizar: ${chk.url}`, sender: "HUMAN", userId: user.id, idempotencyKey: `human_checkout:${chk.id}` });
      await markCheckoutSent(chk.id);
    }
    refresh(slug, leadId);
    return { url: chk.url };
  }, send ? "Checkout link sent" : "Checkout link created");
}

export async function sendHumanMessageAction(conversationId: string, text: string) {
  return run(async () => {
    const user = await requireUser();
    const body = text.trim();
    if (!body) throw new AppError({ code: "EMPTY", userMessage: "Write a message first." });
    if (body.length > 4000) throw new AppError({ code: "TOO_LONG", userMessage: "Message is too long." });
    const [conv] = await withUser(user.id, (tx) => tx.select({ c: conversations, slug: workspaces.slug }).from(conversations).innerJoin(workspaces, eq(workspaces.id, conversations.workspaceId)).where(eq(conversations.id, conversationId)).limit(1));
    if (!conv) throw new AuthorizationError("Conversation not found.");
    const r = await sendMessage({ conversationId, text: body, sender: "HUMAN", userId: user.id, idempotencyKey: `human:${conversationId}:${randomUUID()}` });
    if (!r.sent) throw new AppError({ code: "NOT_SENT", userMessage: r.reason ?? "The message could not be sent." });
    revalidatePath(`/w/${conv.slug}/inbox`);
    return null;
  });
}

/** PAUSE AI / TAKE OVER / RETURN TO AI */
export async function conversationModeAction(conversationId: string, mode: "AI" | "PAUSED" | "HUMAN") {
  return run(async () => {
    const user = await requireUser();
    const [conv] = await withUser(user.id, (tx) => tx.select({ c: conversations, slug: workspaces.slug }).from(conversations).innerJoin(workspaces, eq(workspaces.id, conversations.workspaceId)).where(eq(conversations.id, conversationId)).limit(1));
    if (!conv) throw new AuthorizationError("Conversation not found.");
    await setConversationMode(conversationId, mode, user.id);
    if (mode === "AI") kick([conv.c.workspaceId]);
    revalidatePath(`/w/${conv.slug}/inbox`);
    return null;
  }, mode === "AI" ? "Returned to the Sales Agent" : mode === "HUMAN" ? "You took over this conversation" : "AI paused for this conversation");
}

export async function markConversationReadAction(conversationId: string) {
  return run(async () => {
    const user = await requireUser();
    await withUser(user.id, (tx) => tx.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, conversationId)));
    return null;
  });
}
