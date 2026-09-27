import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError, type PaymentStatus } from "@revenueos/shared";
import type { CheckoutInput, CheckoutResult, ParsedPaymentWebhook, PaymentInfo, PaymentProvider, PaymentWebhookRequest } from "./types";

export interface MockPaymentEvent {
  eventId: string;
  externalReference: string;
  providerPaymentId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
}

/**
 * MockPaymentProvider — DEMO/TEST only. The checkout URL opens an internal
 * demo page; "paying" there sends an HMAC-signed webhook through the SAME
 * webhook pipeline as real providers (signature check, idempotency, official
 * query), so revenue is never created by the AI's word alone.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly id = "MOCK" as const;
  readonly isMock = true;

  constructor(
    private readonly secret: string,
    private readonly appUrl: string,
  ) {
    if (!secret) throw new AppError({ code: "MOCK_PAYMENT_SECRET", userMessage: "Mock payment signing secret missing." });
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    return {
      providerCheckoutId: `mock_chk_${input.externalReference}`,
      url: `${this.appUrl.replace(/\/$/, "")}/demo/checkout/${encodeURIComponent(input.externalReference)}`,
      expiresAt: input.expiresAt ?? null,
    };
  }

  sign(rawBody: string): string {
    return createHmac("sha256", this.secret).update(rawBody).digest("hex");
  }

  /** Builds a signed webhook request exactly as the demo checkout page sends it. */
  buildWebhook(event: MockPaymentEvent): PaymentWebhookRequest {
    const rawBody = JSON.stringify(event);
    return { rawBody, headers: { "x-mock-signature": this.sign(rawBody) }, query: {} };
  }

  verifyWebhook(req: PaymentWebhookRequest): { valid: boolean; reason?: string } {
    const sig = req.headers["x-mock-signature"];
    if (!sig) return { valid: false, reason: "missing signature" };
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(this.sign(req.rawBody), "hex");
    return a.length === b.length && timingSafeEqual(a, b) ? { valid: true } : { valid: false, reason: "signature mismatch" };
  }

  parseWebhook(req: PaymentWebhookRequest): ParsedPaymentWebhook | null {
    const e = JSON.parse(req.rawBody) as MockPaymentEvent;
    // For the mock, the verified webhook body itself is the "official record".
    return { eventId: e.eventId, eventType: `payment.${e.status.toLowerCase()}`, resourceId: Buffer.from(req.rawBody).toString("base64url") };
  }

  async getPayment(resourceId: string): Promise<PaymentInfo> {
    const e = JSON.parse(Buffer.from(resourceId, "base64url").toString("utf8")) as MockPaymentEvent;
    return {
      providerPaymentId: e.providerPaymentId,
      status: e.status,
      amountCents: e.amountCents,
      currency: e.currency,
      externalReference: e.externalReference,
      approvedAt: e.status === "APPROVED" ? new Date() : null,
      raw: { demo: true },
    };
  }

  async testConnection() {
    return { ok: true, message: "Mock payments (DEMO) — no real money moves." };
  }
}
