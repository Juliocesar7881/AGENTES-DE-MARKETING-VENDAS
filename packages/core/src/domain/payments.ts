import { randomUUID } from "node:crypto";
import {
  and,
  attributionEvents,
  checkouts,
  customers,
  eq,
  leads,
  opportunities,
  payments,
  products,
  sql,
  webhookEvents,
  workspaces,
} from "@revenueos/database";
import type { PaymentWebhookRequest } from "@revenueos/providers/payment";
import { AppError, formatMoney, redact, type PaymentStatus } from "@revenueos/shared";
import { db, now } from "../deps";
import { emitEvent } from "../events";
import { paymentProviderFor } from "../providers";
import { audit, notify, recordActivity } from "../records";
import { recomputeLeadScore } from "./leads";

export type Payment = typeof payments.$inferSelect;

export interface WebhookOutcome {
  status: "processed" | "duplicate" | "invalid_signature" | "ignored" | "failed";
  message: string;
  paymentId?: string;
}

/**
 * Payment webhook pipeline (same path for Mercado Pago, Stripe and the DEMO
 * mock): 1) verify signature, 2) idempotency via UNIQUE(provider, event id),
 * 3) query the provider's official API for the real status, 4) upsert payment,
 * 5) emit PAYMENT_APPROVED once. Browser redirects are never trusted.
 */
export async function processPaymentWebhook(providerId: "MERCADOPAGO" | "STRIPE" | "MOCK", workspaceId: string, req: PaymentWebhookRequest): Promise<WebhookOutcome> {
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) return { status: "ignored", message: "unknown workspace" };
  const provider = await paymentProviderFor(ws, providerId);
  const verification = provider.verifyWebhook(req);
  let body: unknown = null;
  try {
    body = JSON.parse(req.rawBody || "null");
  } catch {
    body = { raw: req.rawBody.slice(0, 2000) };
  }
  const parsed = verification.valid ? provider.parseWebhook(req) : null;
  const eventId = parsed?.eventId ?? `unverified:${randomUUID()}`;
  const inserted = await db()
    .insert(webhookEvents)
    .values({ provider: providerId, providerEventId: eventId, eventType: parsed?.eventType ?? "unknown", workspaceId, signatureValid: verification.valid, payload: redact(body), status: "RECEIVED" })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (!inserted[0]) return { status: "duplicate", message: "event already processed" };
  const whId = inserted[0].id;
  if (!verification.valid) {
    await db().update(webhookEvents).set({ status: "FAILED", error: `Invalid signature: ${verification.reason}` }).where(eq(webhookEvents.id, whId));
    await audit({ workspaceId, actorType: "WEBHOOK", action: "payment.webhook_invalid_signature", details: { provider: providerId, reason: verification.reason } });
    return { status: "invalid_signature", message: verification.reason ?? "invalid signature" };
  }
  if (!parsed?.resourceId) {
    await db().update(webhookEvents).set({ status: "IGNORED", processedAt: now() }).where(eq(webhookEvents.id, whId));
    return { status: "ignored", message: "event type not relevant" };
  }
  try {
    const info = await provider.getPayment(parsed.resourceId);
    const paymentId = await applyPaymentStatus(ws.id, providerId, info);
    await db().update(webhookEvents).set({ status: "PROCESSED", processedAt: now(), attempts: 1 }).where(eq(webhookEvents.id, whId));
    return { status: "processed", message: `payment ${info.status}`, paymentId: paymentId ?? undefined };
  } catch (e) {
    await db().update(webhookEvents).set({ status: "FAILED", error: e instanceof AppError ? e.userMessage : String(e), attempts: 1 }).where(eq(webhookEvents.id, whId));
    // Allow the provider to retry the delivery (they re-send on non-2xx).
    await db().delete(webhookEvents).where(eq(webhookEvents.id, whId));
    throw e;
  }
}

export async function applyPaymentStatus(
  workspaceId: string,
  providerId: string,
  info: { providerPaymentId: string; status: PaymentStatus; amountCents: number; currency: string; externalReference: string | null; approvedAt?: Date | null; raw: Record<string, unknown> },
): Promise<string | null> {
  const [chk] = info.externalReference ? await db().select().from(checkouts).where(eq(checkouts.externalReference, info.externalReference)).limit(1) : [];
  if (chk && chk.workspaceId !== workspaceId) {
    throw new AppError({ code: "PAYMENT_WORKSPACE_MISMATCH", userMessage: "Payment reference belongs to another workspace — ignored." });
  }
  const existing = (await db().select().from(payments).where(and(eq(payments.provider, providerId), eq(payments.providerPaymentId, info.providerPaymentId))).limit(1))[0];
  let payment: Payment;
  if (existing) {
    [payment] = (await db()
      .update(payments)
      .set({
        status: info.status,
        amountCents: info.amountCents,
        raw: info.raw,
        approvedAt: info.status === "APPROVED" ? (existing.approvedAt ?? info.approvedAt ?? now()) : existing.approvedAt,
        refundedAt: info.status === "REFUNDED" ? (existing.refundedAt ?? now()) : existing.refundedAt,
      })
      .where(eq(payments.id, existing.id))
      .returning()) as [Payment];
  } else {
    [payment] = (await db()
      .insert(payments)
      .values({
        workspaceId,
        checkoutId: chk?.id ?? null,
        leadId: chk?.leadId ?? null,
        opportunityId: chk?.opportunityId ?? null,
        productId: chk?.productId ?? null,
        contentId: chk?.contentId ?? null,
        socialPostId: chk?.socialPostId ?? null,
        campaignId: chk?.campaignId ?? null,
        provider: providerId,
        providerPaymentId: info.providerPaymentId,
        status: info.status,
        amountCents: info.amountCents,
        currency: info.currency,
        source: "PROVIDER",
        approvedAt: info.status === "APPROVED" ? (info.approvedAt ?? now()) : null,
        raw: info.raw,
        isDemo: providerId === "MOCK",
      })
      .onConflictDoNothing()
      .returning()) as [Payment];
    if (!payment) payment = (await db().select().from(payments).where(and(eq(payments.provider, providerId), eq(payments.providerPaymentId, info.providerPaymentId))).limit(1))[0]!;
  }
  if (info.status === "APPROVED") {
    if (chk) await db().update(checkouts).set({ status: "PAID", paidAt: now() }).where(eq(checkouts.id, chk.id));
    await emitEvent({ type: "PAYMENT_APPROVED", workspaceId, idempotencyKey: `payment_approved:${payment.id}`, payload: { paymentId: payment.id } }, db(), "WEBHOOK");
  } else if (info.status === "REFUNDED") {
    await emitEvent({ type: "PAYMENT_REFUNDED", workspaceId, idempotencyKey: `payment_refunded:${payment.id}`, payload: { paymentId: payment.id } }, db(), "WEBHOOK");
  }
  return payment.id;
}

/**
 * Revenue attribution for an approved payment: Payment → Checkout →
 * Opportunity → Lead → Content → Social Post → Campaign. Idempotent: the
 * PURCHASE attribution event is unique per payment.
 */
export async function attributePayment(paymentId: string, refund = false): Promise<Record<string, unknown>> {
  const [p] = await db().select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!p) return { skipped: "payment not found" };
  if (!refund && p.status !== "APPROVED") return { skipped: `payment is ${p.status}` };
  const [chk] = p.checkoutId ? await db().select().from(checkouts).where(eq(checkouts.id, p.checkoutId)).limit(1) : [];
  const leadId = p.leadId ?? chk?.leadId ?? null;
  const [lead] = leadId ? await db().select().from(leads).where(eq(leads.id, leadId)).limit(1) : [];
  const contentId = p.contentId ?? chk?.contentId ?? lead?.sourceContentId ?? null;
  const socialPostId = p.socialPostId ?? chk?.socialPostId ?? lead?.sourceSocialPostId ?? null;
  const campaignId = p.campaignId ?? chk?.campaignId ?? lead?.campaignId ?? null;
  const productId = p.productId ?? chk?.productId ?? lead?.productId ?? null;
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, p.workspaceId)).limit(1);
  if (refund) {
    await db()
      .insert(attributionEvents)
      .values({ workspaceId: p.workspaceId, eventType: "REFUND", model: lead?.attributionModel ?? "NONE", leadId, paymentId: p.id, checkoutId: chk?.id ?? null, contentId, socialPostId, campaignId, productId, amountCents: -p.amountCents, currency: p.currency })
      .onConflictDoNothing();
    await recordActivity({ workspaceId: p.workspaceId, leadId, type: "PAYMENT_REFUNDED", title: `Refund ${formatMoney(p.amountCents, p.currency)} — attributed revenue reversed`, entityType: "payment", entityId: p.id });
    return { refunded: true };
  }
  await db().update(payments).set({ leadId, contentId, socialPostId, campaignId, productId }).where(eq(payments.id, p.id));
  const inserted = await db()
    .insert(attributionEvents)
    .values({
      workspaceId: p.workspaceId,
      eventType: "PURCHASE",
      model: p.source === "MANUAL" ? "MANUAL" : (lead?.attributionModel ?? "NONE"),
      leadId,
      paymentId: p.id,
      checkoutId: chk?.id ?? null,
      opportunityId: p.opportunityId ?? chk?.opportunityId ?? null,
      contentId,
      socialPostId,
      campaignId,
      productId,
      amountCents: p.amountCents,
      currency: p.currency,
      path: { payment: p.id, checkout: chk?.id ?? null, opportunity: p.opportunityId ?? chk?.opportunityId ?? null, lead: leadId, content: contentId, socialPost: socialPostId, campaign: campaignId },
    })
    .onConflictDoNothing()
    .returning({ id: attributionEvents.id });
  if (!inserted[0]) return { skipped: "already attributed" };
  if (p.opportunityId ?? chk?.opportunityId) await db().update(opportunities).set({ stage: "WON", wonAt: now() }).where(eq(opportunities.id, (p.opportunityId ?? chk?.opportunityId)!));
  if (lead) {
    await db().update(leads).set({ stage: "WON", wonAt: lead.wonAt ?? now(), nextAction: "Onboard customer", nextActionAt: null }).where(eq(leads.id, lead.id));
    const [cust] = await db()
      .insert(customers)
      .values({ workspaceId: p.workspaceId, leadId: lead.id, name: lead.name, email: lead.email, phone: lead.phone, firstPurchaseAt: now(), totalRevenueCents: p.amountCents })
      .onConflictDoUpdate({ target: customers.leadId, set: { totalRevenueCents: sql`${customers.totalRevenueCents} + ${p.amountCents}` } })
      .returning({ id: customers.id });
    await db().update(payments).set({ customerId: cust!.id }).where(eq(payments.id, p.id));
    await recomputeLeadScore(lead.id, "payment approved");
  }
  const [product] = productId ? await db().select().from(products).where(eq(products.id, productId)).limit(1) : [];
  const money = formatMoney(p.amountCents, p.currency);
  await recordActivity({ workspaceId: p.workspaceId, leadId, type: "PAYMENT_APPROVED", title: `Payment approved: ${money}${lead ? ` from ${lead.name || "lead"}` : ""}${p.isDemo ? " (DEMO)" : ""}`, entityType: "payment", entityId: p.id });
  await recordActivity({ workspaceId: p.workspaceId, leadId, type: "REVENUE_ATTRIBUTED", title: `+${money} attributed revenue${contentId ? " to content" : ""}${product ? ` (${product.name})` : ""}`, agentRole: "CUSTOMER_SUCCESS", entityType: "payment", entityId: p.id, details: { contentId, socialPostId, campaignId } });
  if (ws) {
    await notify({ workspaceId: ws.id, type: "SALE", severity: "SUCCESS", title: `💰 Sale ${money} — ${ws.name}`, body: `${lead?.name || "A customer"} paid${product ? ` for ${product.name}` : ""}.${p.isDemo ? " (DEMO)" : ""}`, link: `/w/${ws.slug}/sales`, dedupeKey: `sale:${p.id}` });
  }
  await audit({ workspaceId: p.workspaceId, actorType: "WEBHOOK", action: "payment.approved", entityType: "payment", entityId: p.id, details: { amount: p.amountCents, provider: p.provider, source: p.source } });
  await emitEvent({ type: "REVENUE_ATTRIBUTED", workspaceId: p.workspaceId, idempotencyKey: `revenue_attributed:${p.id}`, payload: { paymentId: p.id, contentId } });
  return { attributed: true, contentId, amountCents: p.amountCents };
}

/** Manual sale (source MANUAL) — the only way to record revenue without a payment provider. */
export async function recordManualSale(opts: { workspaceId: string; userId: string; amountCents: number; currency?: string; leadId?: string | null; productId?: string | null; contentId?: string | null; note?: string | null }): Promise<string> {
  if (!Number.isFinite(opts.amountCents) || opts.amountCents <= 0) throw new AppError({ code: "VALIDATION", userMessage: "Enter a positive amount." });
  const [lead] = opts.leadId ? await db().select().from(leads).where(and(eq(leads.id, opts.leadId), eq(leads.workspaceId, opts.workspaceId))).limit(1) : [];
  const [p] = await db()
    .insert(payments)
    .values({
      workspaceId: opts.workspaceId,
      leadId: lead?.id ?? null,
      productId: opts.productId ?? lead?.productId ?? null,
      contentId: opts.contentId ?? lead?.sourceContentId ?? null,
      socialPostId: lead?.sourceSocialPostId ?? null,
      campaignId: lead?.campaignId ?? null,
      provider: "MANUAL",
      providerPaymentId: `manual_${randomUUID()}`,
      status: "APPROVED",
      amountCents: Math.round(opts.amountCents),
      currency: opts.currency ?? "BRL",
      source: "MANUAL",
      approvedAt: now(),
      recordedBy: opts.userId,
      note: opts.note ?? null,
    })
    .returning();
  await audit({ workspaceId: opts.workspaceId, actorType: "USER", actorId: opts.userId, action: "payment.manual_sale", entityType: "payment", entityId: p!.id, details: { amount: p!.amountCents } });
  await emitEvent({ type: "PAYMENT_APPROVED", workspaceId: opts.workspaceId, idempotencyKey: `payment_approved:${p!.id}`, payload: { paymentId: p!.id } }, db(), "HUMAN");
  return p!.id;
}

/** Recent sales for the Sales page. */
export async function recentSales(workspaceIds: string[], limit = 20) {
  if (workspaceIds.length === 0) return [];
  return db()
    .select({
      id: payments.id,
      workspaceId: payments.workspaceId,
      amountCents: payments.amountCents,
      currency: payments.currency,
      provider: payments.provider,
      source: payments.source,
      approvedAt: payments.approvedAt,
      isDemo: payments.isDemo,
      leadName: leads.name,
      leadId: leads.id,
      productName: products.name,
      contentId: payments.contentId,
    })
    .from(payments)
    .leftJoin(leads, eq(leads.id, payments.leadId))
    .leftJoin(products, eq(products.id, payments.productId))
    .where(and(sql`${payments.workspaceId} = ANY(${sql.raw(`ARRAY[${workspaceIds.map((w) => `'${w.replace(/[^0-9a-f-]/gi, "")}'::uuid`).join(",")}]`)})`, eq(payments.status, "APPROVED")))
    .orderBy(sql`${payments.approvedAt} DESC NULLS LAST`)
    .limit(limit);
}

void notify;
