import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createCheckout, processInboundMessage, processPaymentWebhook, recordManualSale, runSalesReply, scheduleContent, totals } from "@revenueos/core";
import { and, attributionEvents, conversations, eq, getDb, leads, payments, products, socialPosts, webhookEvents } from "@revenueos/database";
import { MockPaymentProvider } from "@revenueos/providers/payment";
import { doubles, makeLiveBusiness, makeReadyContent, runner, sleep, useDoubles } from "./helpers";

describe("payments, attribution and revenue integrity", () => {
  let ws: Awaited<ReturnType<typeof makeLiveBusiness>>["ws"];
  let user: Awaited<ReturnType<typeof makeLiveBusiness>>["user"];
  let contentId: string;
  let leadId: string;
  let productId: string;

  beforeAll(async () => {
    useDoubles();
    ({ ws, user } = await makeLiveBusiness("PayCo"));
    await getDb().update((await import("@revenueos/database")).workspaces).set({ salesSettings: { ...ws.salesSettings, businessHours: { ...ws.salesSettings.businessHours, enabled: false } } }).where(eq((await import("@revenueos/database")).workspaces.id, ws.id));
    [contentId] = (await makeReadyContent(ws)) as [string];
    await scheduleContent(contentId, "HUMAN", { at: new Date(Date.now() + 1000) });
    await sleep(1200);
    await runner().drain({ timeoutMs: 60_000 });
    const [post] = await getDb().select().from(socialPosts).where(and(eq(socialPosts.contentId, contentId), eq(socialPosts.status, "PUBLISHED")));
    const r = await processInboundMessage({ workspaceId: ws.id, channel: "WHATSAPP", from: "5511912345678", fromName: "Bia", text: `Oi, vi o vídeo! (código ${post!.trackedLinkCode})`, externalMessageId: `wamid.${randomUUID()}`, origin: "WEBHOOK" });
    leadId = r.leadId;
    [{ id: productId }] = (await getDb().select({ id: products.id }).from(products).where(eq(products.workspaceId, ws.id))) as [{ id: string }];
  });

  it("attributes the lead to the video through its tracked reference code", async () => {
    const [lead] = await getDb().select().from(leads).where(eq(leads.id, leadId));
    expect(lead!.sourceContentId).toBe(contentId);
    expect(lead!.attributionModel).toBe("REF_CODE");
  });

  it("the AI saying 'sold' never creates revenue", async () => {
    await processInboundMessage({ workspaceId: ws.id, channel: "WHATSAPP", from: "5511912345678", text: "Paguei já! Pode confirmar?", externalMessageId: `wamid.${randomUUID()}`, origin: "WEBHOOK" });
    await runner().drain({ timeoutMs: 30_000 });
    const [conv] = await getDb().select().from(conversations).where(eq(conversations.leadId, leadId));
    await runSalesReply({ conversationId: conv!.id, jobId: randomUUID(), origin: "AUTOMATION" }).catch(() => null);
    expect(await getDb().select().from(payments).where(eq(payments.workspaceId, ws.id))).toHaveLength(0);
    const [lead] = await getDb().select().from(leads).where(eq(leads.id, leadId));
    expect(lead!.stage).not.toBe("WON");
  });

  it("a verified webhook records the payment once and attributes it to the content", async () => {
    const chk = await createCheckout({ workspaceId: ws.id, leadId, productId, createdBy: "HUMAN", userId: user.id });
    const mock = doubles.payment as MockPaymentProvider;
    const req = mock.buildWebhook({ eventId: `evt_${randomUUID()}`, externalReference: chk.externalReference, providerPaymentId: `pay_${randomUUID()}`, status: "APPROVED", amountCents: chk.amountCents, currency: "BRL" });
    expect((await processPaymentWebhook("MOCK", ws.id, req)).status).toBe("processed");
    expect((await processPaymentWebhook("MOCK", ws.id, req)).status).toBe("duplicate");
    await runner().drain({ timeoutMs: 30_000 });
    const pays = await getDb().select().from(payments).where(eq(payments.workspaceId, ws.id));
    expect(pays).toHaveLength(1);
    expect(pays[0]!.contentId).toBe(contentId);
    expect(pays[0]!.leadId).toBe(leadId);
    const purchase = await getDb().select().from(attributionEvents).where(and(eq(attributionEvents.workspaceId, ws.id), eq(attributionEvents.eventType, "PURCHASE")));
    expect(purchase).toHaveLength(1);
    expect(purchase[0]!.contentId).toBe(contentId);
    const [lead] = await getDb().select().from(leads).where(eq(leads.id, leadId));
    expect(lead!.stage).toBe("WON");
    const t = await totals([ws.id], new Date(Date.now() - 86400_000));
    expect(t.revenueCents).toBe(9900);
  });

  it("rejects forged webhooks (bad signature) without touching revenue", async () => {
    const forger = new MockPaymentProvider("attacker-secret", "http://x");
    const req = forger.buildWebhook({ eventId: `evt_${randomUUID()}`, externalReference: "rv_fake", providerPaymentId: `pay_${randomUUID()}`, status: "APPROVED", amountCents: 100000, currency: "BRL" });
    expect((await processPaymentWebhook("MOCK", ws.id, req)).status).toBe("invalid_signature");
    const rows = await getDb().select().from(webhookEvents).where(and(eq(webhookEvents.workspaceId, ws.id), eq(webhookEvents.signatureValid, false)));
    expect(rows.length).toBeGreaterThan(0);
    expect(await getDb().select().from(payments).where(eq(payments.workspaceId, ws.id))).toHaveLength(1);
  });

  it("a webhook sent to another business cannot claim this business's checkout", async () => {
    const other = await makeLiveBusiness("OtherPayCo");
    const chk = await createCheckout({ workspaceId: ws.id, leadId, productId, createdBy: "HUMAN", userId: user.id });
    const req = (doubles.payment as MockPaymentProvider).buildWebhook({ eventId: `evt_${randomUUID()}`, externalReference: chk.externalReference, providerPaymentId: `pay_${randomUUID()}`, status: "APPROVED", amountCents: chk.amountCents, currency: "BRL" });
    await expect(processPaymentWebhook("MOCK", other.ws.id, req)).rejects.toMatchObject({ code: "PAYMENT_WORKSPACE_MISMATCH" });
    expect(await getDb().select().from(payments).where(eq(payments.workspaceId, other.ws.id))).toHaveLength(0);
  });

  it("refunds remove attributed revenue", async () => {
    const [p] = await getDb().select().from(payments).where(eq(payments.workspaceId, ws.id));
    const req = (doubles.payment as MockPaymentProvider).buildWebhook({ eventId: `evt_${randomUUID()}`, externalReference: (await getDb().select().from((await import("@revenueos/database")).checkouts).where(eq((await import("@revenueos/database")).checkouts.id, p!.checkoutId!)))[0]!.externalReference, providerPaymentId: p!.providerPaymentId!, status: "REFUNDED", amountCents: p!.amountCents, currency: "BRL" });
    expect((await processPaymentWebhook("MOCK", ws.id, req)).status).toBe("processed");
    await runner().drain({ timeoutMs: 30_000 });
    const t = await totals([ws.id], new Date(Date.now() - 86400_000));
    expect(t.revenueCents).toBe(0);
  });

  it("manual sales are labeled MANUAL and audited", async () => {
    const id = await recordManualSale({ workspaceId: ws.id, userId: user.id, amountCents: 5000, leadId, productId, note: "Pagou em dinheiro" });
    const [p] = await getDb().select().from(payments).where(eq(payments.id, id));
    expect(p!.source).toBe("MANUAL");
    expect(p!.status).toBe("APPROVED");
  });
});
