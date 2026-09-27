import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError, type PaymentStatus } from "@revenueos/shared";
import { request } from "../http";
import type { CheckoutInput, CheckoutResult, ParsedPaymentWebhook, PaymentInfo, PaymentProvider, PaymentWebhookRequest } from "./types";

export interface MercadoPagoConfig {
  accessToken: string;
  /** "Assinatura secreta" from Your integrations → Webhooks. */
  webhookSecret: string;
}

const API = "https://api.mercadopago.com";

const STATUS: Record<string, PaymentStatus> = {
  approved: "APPROVED",
  authorized: "PENDING",
  pending: "PENDING",
  in_process: "PENDING",
  in_mediation: "PENDING",
  rejected: "FAILED",
  cancelled: "CANCELLED",
  refunded: "REFUNDED",
  charged_back: "REFUNDED",
};

function describeMp(_status: number, body: unknown) {
  const b = body as { message?: string; error?: string; cause?: { description?: string }[] };
  if (!b) return undefined;
  if (b.error === "unauthorized" || /invalid access token/i.test(b.message ?? "")) {
    return { code: "MP_AUTH", userMessage: "Mercado Pago rejected the access token. Update it in Integrations → Payments." };
  }
  return { code: "MP_ERROR", userMessage: `Mercado Pago: ${b.cause?.[0]?.description ?? b.message ?? "request failed"}` };
}

/** Mercado Pago Checkout Pro (preferences) + signed webhooks + official payment query. */
export class MercadoPagoProvider implements PaymentProvider {
  readonly id = "MERCADOPAGO" as const;
  readonly isMock = false;

  constructor(private readonly cfg: MercadoPagoConfig) {
    if (!cfg.accessToken) {
      throw new AppError({ code: "MP_NOT_CONFIGURED", userMessage: "Mercado Pago is not connected. Add the access token in Integrations → Payments." });
    }
  }

  private auth() {
    return { Authorization: `Bearer ${this.cfg.accessToken}` };
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const res = await request<{ id: string; init_point: string; sandbox_init_point?: string }>(`${API}/checkout/preferences`, {
      provider: "Mercado Pago",
      method: "POST",
      headers: { ...this.auth(), "X-Idempotency-Key": input.idempotencyKey },
      json: {
        items: [
          {
            id: input.externalReference,
            title: input.title.slice(0, 250),
            description: input.description.slice(0, 250),
            quantity: 1,
            currency_id: input.currency,
            unit_price: Math.round(input.amountCents) / 100,
          },
        ],
        payer: input.payer?.email ? { name: input.payer.name ?? undefined, email: input.payer.email } : undefined,
        external_reference: input.externalReference,
        notification_url: input.notificationUrl,
        back_urls: { success: input.successUrl, failure: input.failureUrl, pending: input.successUrl },
        auto_return: "approved",
        metadata: input.metadata ?? {},
        ...(input.expiresAt ? { expires: true, expiration_date_to: input.expiresAt.toISOString() } : {}),
      },
      idempotent: true,
      describeError: describeMp,
    });
    return { providerCheckoutId: res.data.id, url: res.data.init_point, expiresAt: input.expiresAt ?? null };
  }

  verifyWebhook(req: PaymentWebhookRequest): { valid: boolean; reason?: string } {
    const sigHeader = req.headers["x-signature"];
    const requestId = req.headers["x-request-id"] ?? "";
    if (!sigHeader || !this.cfg.webhookSecret) return { valid: false, reason: "missing signature or secret" };
    const parts = Object.fromEntries(
      sigHeader.split(",").map((p) => {
        const [k, ...v] = p.trim().split("=");
        return [k, v.join("=")];
      }),
    ) as Record<string, string>;
    const ts = parts.ts;
    const v1 = parts.v1;
    if (!ts || !v1) return { valid: false, reason: "malformed signature" };
    let dataId = req.query["data.id"] ?? "";
    if (!dataId) {
      try {
        dataId = String((JSON.parse(req.rawBody) as { data?: { id?: string | number } }).data?.id ?? "");
      } catch {
        /* ignore */
      }
    }
    if (/^[a-z0-9]+$/i.test(dataId)) dataId = dataId.toLowerCase();
    let manifest = "";
    if (dataId) manifest += `id:${dataId};`;
    if (requestId) manifest += `request-id:${requestId};`;
    manifest += `ts:${ts};`;
    const expected = createHmac("sha256", this.cfg.webhookSecret).update(manifest).digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(v1, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: "signature mismatch" };
    return { valid: true };
  }

  parseWebhook(req: PaymentWebhookRequest): ParsedPaymentWebhook | null {
    let body: { id?: string | number; type?: string; action?: string; data?: { id?: string | number } } = {};
    try {
      body = JSON.parse(req.rawBody || "{}");
    } catch {
      /* query-only notification */
    }
    const type = body.type ?? req.query.type ?? req.query.topic ?? "";
    const resourceId = String(body.data?.id ?? req.query["data.id"] ?? req.query.id ?? "");
    if (type !== "payment" || !resourceId) return null;
    const eventId = String(body.id ?? `${type}:${resourceId}:${body.action ?? req.headers["x-request-id"] ?? ""}`);
    return { eventId, eventType: body.action ?? type, resourceId };
  }

  async getPayment(resourceId: string): Promise<PaymentInfo> {
    const res = await request<{
      id: number;
      status: string;
      transaction_amount: number;
      currency_id: string;
      external_reference?: string | null;
      date_approved?: string | null;
    }>(`${API}/v1/payments/${encodeURIComponent(resourceId)}`, { provider: "Mercado Pago", headers: this.auth(), describeError: describeMp });
    const p = res.data;
    return {
      providerPaymentId: String(p.id),
      status: STATUS[p.status] ?? "PENDING",
      amountCents: Math.round(p.transaction_amount * 100),
      currency: p.currency_id,
      externalReference: p.external_reference ?? null,
      approvedAt: p.date_approved ? new Date(p.date_approved) : null,
      raw: { status: p.status, id: p.id },
    };
  }

  async testConnection() {
    try {
      const res = await request<{ nickname?: string; id?: number }>(`${API}/users/me`, { provider: "Mercado Pago", headers: this.auth(), describeError: describeMp });
      return { ok: true, message: `Connected to Mercado Pago account ${res.data.nickname ?? res.data.id}.` };
    } catch (e) {
      return { ok: false, message: e instanceof AppError ? e.userMessage : "Mercado Pago connection failed." };
    }
  }
}
