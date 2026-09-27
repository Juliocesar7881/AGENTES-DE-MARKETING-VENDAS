import { createHash } from "node:crypto";
import { AppError, type MessagingChannel } from "@revenueos/shared";
import { DAY_MS, type MessagingEvent, type MessagingProvider, type SendResult } from "./types";

/**
 * MockMessagingProvider — DEMO/TEST only. Outbound messages are "delivered"
 * instantly with mock ids and recorded in `sent` for assertions.
 */
export class MockMessagingProvider implements MessagingProvider {
  readonly isMock = true;
  readonly sent: { to: string; text: string; idempotencyKey: string }[] = [];
  constructor(
    readonly channel: MessagingChannel = "MOCK",
    private readonly opts: { fail?: boolean } = {},
  ) {}

  async sendText(input: { to: string; text: string; idempotencyKey: string }): Promise<SendResult> {
    if (this.opts.fail) throw new AppError({ code: "MOCK_SEND_FAILED", userMessage: "Simulated messaging failure.", retryable: true });
    this.sent.push(input);
    return { externalMessageId: `mock_msg_${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 16)}`, status: "DELIVERED" };
  }

  async sendTemplate(input: { to: string; templateName: string; variables: string[]; idempotencyKey: string }): Promise<SendResult> {
    return this.sendText({ to: input.to, text: `[template ${input.templateName}] ${input.variables.join(" ")}`, idempotencyKey: input.idempotencyKey });
  }

  canSendFreeform(lastInboundAt: Date | null, now = new Date()): boolean {
    return lastInboundAt != null && now.getTime() - lastInboundAt.getTime() < DAY_MS;
  }

  verifySignature(): boolean {
    return true;
  }

  parseWebhook(): MessagingEvent[] {
    return [];
  }

  async testConnection() {
    return { ok: true, message: "Mock messaging (DEMO) — messages are not sent anywhere." };
  }
}
