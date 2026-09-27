import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@revenueos/shared";
import { request } from "../http";
import type { CheckoutInput, CheckoutResult, ParsedPaymentWebhook, PaymentInfo, PaymentProvider, PaymentWebhookRequest } from "./types";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
}

const API = "https://api.stripe.com/v1";

function describeStripe(_status: number, body: unknown) {
  const e = (body as { error?: { message?: string; type?: string } })?.error;
  if (!e) return undefined;
  if (e.type === "invalid_request_error" && /api key/i.test(e.message ?? "")) {
    return { code: "STRIPE_AUTH", userMessage: "Stripe rejected the secret key. Update it in Integrations → Payments." };
  }
  return { code: "STRIPE_ERROR", userMessage: `Stripe: ${e.message ?? e.type}` };
}

/** Stripe Checkout Sessions (REST, form-encoded) + signed webhooks + official session query. */
export class StripeProvider implements PaymentProvider {
  readonly id = "STRIPE" as const;
  readonly isMock = false;

  constructor(private readonly cfg: StripeConfig) {
    if (!cfg.secretKey) throw new AppError({ code: "STRIPE_NOT_CONFIGURED", userMessage: "Stripe is not connected. Add the secret key in Integrations → Payments." });
  }

  private auth() {
    return { Authorization: `Bearer ${this.cfg.secretKey}` };
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const form: Record<string, string> = {
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.failureUrl,
      client_reference_id: input.externalReference,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(Math.round(input.amountCents)),
      "line_items[0][price_data][product_data][name]": input.title.slice(0, 250),
      "metadata[external_reference]": input.externalReference,
      "payment_intent_data[metadata][external_reference]": input.externalReference,
    };
    if (input.description) form["line_items[0][price_data][product_data][description]"] = input.description.slice(0, 500);
    if (input.payer?.email) form.customer_email = input.payer.email;
    if (input.expiresAt) form.expires_at = String(Math.max(Math.floor(input.expiresAt.getTime() / 1000), Math.floor(Date.now() / 1000) + 1800));
    for (const [k, v] of Object.entries(input.metadata ?? {})) form[`metadata[${k}]`] = v;
    const res = await request<{ id: string; url: string; expires_at?: number }>(`${API}/checkout/sessions`, {
      provider: "Stripe",
      method: "POST",
      headers: { ...this.auth(), "Idempotency-Key": input.idempotencyKey },
      form,
      idempotent: true,
      describeError: describeStripe,
    });
    return { providerCheckoutId: res.data.id, url: res.data.url, expiresAt: res.data.expires_at ? new Date(res.data.expires_at * 1000) : null };
  }

  verifyWebhook(req: PaymentWebhookRequest, toleranceSec = 300): { valid: boolean; reason?: string } {
    const header = req.headers["stripe-signature"];
    if (!header || !this.cfg.webhookSecret) return { valid: false, reason: "missing signature or secret" };
    const items = header.split(",").map((p) => p.split("=") as [string, string]);
    const t = items.find(([k]) => k === "t")?.[1];
    const sigs = items.filter(([k]) => k === "v1").map(([, v]) => v);
    if (!t || sigs.length === 0) return { valid: false, reason: "malformed signature" };
    if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return { valid: false, reason: "timestamp outside tolerance" };
    const expected = Buffer.from(createHmac("sha256", this.cfg.webhookSecret).update(`${t}.${req.rawBody}`).digest("hex"), "hex");
    const ok = sigs.some((s) => {
      const b = Buffer.from(s, "hex");
      return b.length === expected.length && timingSafeEqual(b, expected);
    });
    return ok ? { valid: true } : { valid: false, reason: "signature mismatch" };
  }

  parseWebhook(req: PaymentWebhookRequest): ParsedPaymentWebhook | null {
    const evt = JSON.parse(req.rawBody) as { id: string; type: string; data?: { object?: { id?: string; object?: string; payment_intent?: string } } };
    const obj = evt.data?.object;
    if (!obj?.id) return null;
    if (evt.type.startsWith("checkout.session.")) return { eventId: evt.id, eventType: evt.type, resourceId: obj.id };
    if (evt.type === "charge.refunded" && obj.payment_intent) return { eventId: evt.id, eventType: evt.type, resourceId: `pi:${obj.payment_intent}` };
    return { eventId: evt.id, eventType: evt.type, resourceId: null };
  }

  async getPayment(resourceId: string): Promise<PaymentInfo> {
    let sessionId = resourceId;
    if (resourceId.startsWith("pi:")) {
      const list = await request<{ data: { id: string }[] }>(`${API}/checkout/sessions?payment_intent=${encodeURIComponent(resourceId.slice(3))}`, {
        provider: "Stripe",
        headers: this.auth(),
        describeError: describeStripe,
      });
      sessionId = list.data.data[0]?.id ?? "";
      if (!sessionId) throw new AppError({ code: "STRIPE_SESSION_NOT_FOUND", userMessage: "Stripe session for this refund was not found." });
    }
    const res = await request<{
      id: string;
      status: string;
      payment_status: string;
      amount_total: number;
      currency: string;
      client_reference_id?: string | null;
      payment_intent?: { status?: string; latest_charge?: { refunded?: boolean; amount_refunded?: number } } | string | null;
      created: number;
    }>(`${API}/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent.latest_charge`, {
      provider: "Stripe",
      headers: this.auth(),
      describeError: describeStripe,
    });
    const s = res.data;
    const pi = typeof s.payment_intent === "object" ? s.payment_intent : null;
    const refunded = Boolean(pi?.latest_charge?.refunded);
    const status = refunded ? "REFUNDED" : s.payment_status === "paid" ? "APPROVED" : s.status === "expired" ? "CANCELLED" : "PENDING";
    return {
      providerPaymentId: s.id,
      status,
      amountCents: s.amount_total,
      currency: s.currency.toUpperCase(),
      externalReference: s.client_reference_id ?? null,
      approvedAt: status === "APPROVED" ? new Date() : null,
      raw: { status: s.status, payment_status: s.payment_status },
    };
  }

  async testConnection() {
    try {
      await request(`${API}/balance`, { provider: "Stripe", headers: this.auth(), describeError: describeStripe });
      return { ok: true, message: "Stripe key is valid." };
    } catch (e) {
      return { ok: false, message: e instanceof AppError ? e.userMessage : "Stripe connection failed." };
    }
  }
}
