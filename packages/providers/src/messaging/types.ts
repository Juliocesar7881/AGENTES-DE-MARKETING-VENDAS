import type { DeliveryStatus, MessagingChannel } from "@revenueos/shared";

export interface InboundMessageEvent {
  kind: "message";
  channel: MessagingChannel;
  /** Business-side account id (WhatsApp phone_number_id / Instagram account id) used to route to a workspace. */
  accountId: string;
  externalMessageId: string;
  from: string;
  fromName?: string | null;
  text: string;
  timestamp: Date;
  /** Click-to-message referral data (ads / posts) when the platform provides it. */
  referral?: { sourceId?: string | null; sourceUrl?: string | null; sourceType?: string | null; headline?: string | null } | null;
}

export interface StatusEvent {
  kind: "status";
  channel: MessagingChannel;
  accountId: string;
  externalMessageId: string;
  status: DeliveryStatus;
  error?: string | null;
  timestamp: Date;
}

export type MessagingEvent = InboundMessageEvent | StatusEvent;

export interface SendResult {
  externalMessageId: string;
  status: DeliveryStatus;
}

export interface WebhookRequest {
  rawBody: string;
  headers: Record<string, string | undefined>;
}

export interface MessagingProvider {
  readonly channel: MessagingChannel;
  readonly isMock: boolean;
  sendText(input: { to: string; text: string; idempotencyKey: string }): Promise<SendResult>;
  sendTemplate(input: { to: string; templateName: string; language: string; variables: string[]; idempotencyKey: string }): Promise<SendResult>;
  /** Whether a free-form message is allowed now (WhatsApp/Instagram 24h customer-service window). */
  canSendFreeform(lastInboundAt: Date | null, now?: Date): boolean;
  verifySignature(req: WebhookRequest): boolean;
  parseWebhook(payload: unknown): MessagingEvent[];
  testConnection(): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }>;
}

export const DAY_MS = 24 * 3600 * 1000;
