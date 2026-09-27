import type { PaymentProviderId, PaymentStatus } from "@revenueos/shared";

export interface CheckoutInput {
  externalReference: string;
  title: string;
  description: string;
  amountCents: number;
  currency: string;
  payer?: { name?: string | null; email?: string | null; phone?: string | null };
  notificationUrl: string;
  successUrl: string;
  failureUrl: string;
  expiresAt?: Date | null;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface CheckoutResult {
  providerCheckoutId: string;
  url: string;
  expiresAt?: Date | null;
}

export interface PaymentInfo {
  providerPaymentId: string;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  externalReference: string | null;
  approvedAt?: Date | null;
  raw: Record<string, unknown>;
}

export interface PaymentWebhookRequest {
  rawBody: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
}

export interface ParsedPaymentWebhook {
  /** Unique id of this notification — stored with a UNIQUE constraint for idempotency. */
  eventId: string;
  eventType: string;
  /** Resource to query on the provider's official API (the source of truth). */
  resourceId: string | null;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly isMock: boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  verifyWebhook(req: PaymentWebhookRequest): { valid: boolean; reason?: string };
  parseWebhook(req: PaymentWebhookRequest): ParsedPaymentWebhook | null;
  /** Official status query. A payment is only APPROVED when this says so. */
  getPayment(resourceId: string): Promise<PaymentInfo>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
