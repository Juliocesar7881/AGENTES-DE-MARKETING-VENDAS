import { randomUUID } from "node:crypto";
import { and, attributionEvents, checkouts, eq, leads, opportunities, products, workspaces } from "@revenueos/database";
import { AppError, formatMoney } from "@revenueos/shared";
import { getConfig } from "../config";
import { db, now } from "../deps";
import { emitEvent } from "../events";
import { paymentProviderFor } from "../providers";
import { audit, recordActivity } from "../records";
import { recomputeLeadScore } from "./leads";

export type Checkout = typeof checkouts.$inferSelect;

/**
 * Creates a checkout link for a lead + product, linked to the full attribution
 * path (content, post, campaign, opportunity). Payment is only considered
 * approved later, via a verified webhook + official provider query.
 */
export async function createCheckout(opts: {
  workspaceId: string;
  leadId: string;
  productId: string;
  discountPct?: number;
  conversationId?: string | null;
  createdBy: "AI" | "HUMAN";
  userId?: string | null;
}): Promise<Checkout> {
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, opts.workspaceId)).limit(1);
  const [lead] = await db().select().from(leads).where(and(eq(leads.id, opts.leadId), eq(leads.workspaceId, opts.workspaceId))).limit(1);
  const [product] = await db().select().from(products).where(and(eq(products.id, opts.productId), eq(products.workspaceId, opts.workspaceId))).limit(1);
  if (!ws || !lead || !product) throw new AppError({ code: "NOT_FOUND", userMessage: "Lead or product not found in this workspace." });
  const discount = Math.max(0, Math.min(opts.discountPct ?? 0, 90));
  if (opts.createdBy === "AI" && discount > ws.salesSettings.maxDiscountPct) {
    throw new AppError({ code: "DISCOUNT_ABOVE_LIMIT", userMessage: `Discount ${discount}% exceeds the configured maximum of ${ws.salesSettings.maxDiscountPct}%.` });
  }
  const amount = Math.round(product.priceCents * (1 - discount / 100));
  let [opp] = await db()
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.leadId, lead.id), eq(opportunities.productId, product.id), eq(opportunities.stage, "OPEN")))
    .limit(1);
  if (!opp) {
    [opp] = await db()
      .insert(opportunities)
      .values({ workspaceId: ws.id, leadId: lead.id, productId: product.id, contentId: lead.sourceContentId, socialPostId: lead.sourceSocialPostId, campaignId: lead.campaignId, valueCents: amount, currency: product.currency })
      .returning();
  }
  const checkoutId = randomUUID();
  const externalReference = `rv_${checkoutId}`;
  const provider = await paymentProviderFor(ws);
  const appUrl = getConfig().appUrl;
  const result = await provider.createCheckout({
    externalReference,
    title: product.name,
    description: product.description.slice(0, 240),
    amountCents: amount,
    currency: product.currency,
    payer: { name: lead.name, email: lead.email, phone: lead.phone },
    notificationUrl: `${appUrl}/api/webhooks/${provider.id.toLowerCase()}/${ws.id}`,
    successUrl: `${appUrl}/checkout/thanks?ref=${externalReference}`,
    failureUrl: `${appUrl}/checkout/thanks?ref=${externalReference}&status=failed`,
    expiresAt: new Date(now().getTime() + 72 * 3600 * 1000),
    idempotencyKey: checkoutId,
    metadata: { workspace_id: ws.id, lead_id: lead.id, product_id: product.id },
  });
  const [chk] = await db()
    .insert(checkouts)
    .values({
      id: checkoutId,
      workspaceId: ws.id,
      leadId: lead.id,
      productId: product.id,
      opportunityId: opp!.id,
      campaignId: lead.campaignId,
      contentId: lead.sourceContentId,
      socialPostId: lead.sourceSocialPostId,
      conversationId: opts.conversationId ?? null,
      provider: provider.id,
      providerCheckoutId: result.providerCheckoutId,
      url: result.url,
      amountCents: amount,
      currency: product.currency,
      discountPct: discount,
      status: "CREATED",
      externalReference,
      expiresAt: result.expiresAt ?? null,
      createdBy: opts.createdBy,
      isDemo: provider.isMock,
    })
    .returning();
  await db().update(opportunities).set({ stage: "CHECKOUT", valueCents: amount }).where(eq(opportunities.id, opp!.id));
  if (lead.stage !== "WON") await db().update(leads).set({ stage: "CHECKOUT" }).where(eq(leads.id, lead.id));
  await db().insert(attributionEvents).values({
    workspaceId: ws.id,
    eventType: "CHECKOUT",
    model: lead.attributionModel,
    leadId: lead.id,
    checkoutId: chk!.id,
    opportunityId: opp!.id,
    contentId: lead.sourceContentId,
    socialPostId: lead.sourceSocialPostId,
    campaignId: lead.campaignId,
    productId: product.id,
    amountCents: amount,
    currency: product.currency,
  });
  await emitEvent({ type: "CHECKOUT_CREATED", workspaceId: ws.id, idempotencyKey: `checkout_created:${chk!.id}`, payload: { checkoutId: chk!.id, leadId: lead.id } });
  await recordActivity({
    workspaceId: ws.id,
    leadId: lead.id,
    type: "CHECKOUT_CREATED",
    title: `Checkout ${formatMoney(amount, product.currency)} created for ${lead.name || "lead"} (${product.name})${provider.isMock ? " — DEMO" : ""}`,
    agentRole: opts.createdBy === "AI" ? "SALES" : null,
    actorType: opts.createdBy === "AI" ? "AGENT" : "USER",
    actorId: opts.userId ?? null,
    entityType: "checkout",
    entityId: chk!.id,
  });
  await audit({ workspaceId: ws.id, actorType: opts.createdBy === "AI" ? "AGENT" : "USER", actorId: opts.userId ?? "SALES", action: "checkout.created", entityType: "checkout", entityId: chk!.id, details: { amount, discount, provider: provider.id } });
  await recomputeLeadScore(lead.id, "checkout created");
  return chk!;
}

export async function markCheckoutSent(checkoutId: string): Promise<void> {
  await db().update(checkouts).set({ status: "SENT", sentAt: now() }).where(and(eq(checkouts.id, checkoutId), eq(checkouts.status, "CREATED")));
}
