import { AppError } from "@revenueos/shared";
import { request } from "../http";
import { describeMetaError } from "../social/instagram";
import { DAY_MS, type MessagingEvent, type MessagingProvider, type SendResult, type WebhookRequest } from "./types";
import { verifyMetaSignature } from "./whatsapp";

export interface InstagramDMConfig {
  igUserId: string;
  accessToken: string;
  appSecret: string;
  apiVersion?: string;
}

/**
 * Instagram Direct messages through the official Instagram API with Instagram
 * Login (requires instagram_business_manage_messages + webhook subscription).
 * Only used when the connected account granted messaging permission.
 */
export class InstagramDMProvider implements MessagingProvider {
  readonly channel = "INSTAGRAM" as const;
  readonly isMock = false;
  private readonly version: string;
  constructor(private readonly cfg: InstagramDMConfig) {
    this.version = cfg.apiVersion ?? "v23.0";
  }

  async sendText(input: { to: string; text: string }): Promise<SendResult> {
    const res = await request<{ message_id?: string }>(
      `https://graph.instagram.com/${this.version}/${this.cfg.igUserId}/messages?access_token=${encodeURIComponent(this.cfg.accessToken)}`,
      {
        provider: "Instagram",
        method: "POST",
        json: { recipient: { id: input.to }, message: { text: input.text.slice(0, 1000) } },
        rateLimitKey: `igdm:${this.cfg.igUserId}`,
        ratePerMinute: 60,
        describeError: describeMetaError("Instagram"),
      },
    );
    if (!res.data.message_id) throw new AppError({ code: "IGDM_NO_ID", userMessage: "Instagram accepted the message but returned no id." });
    return { externalMessageId: res.data.message_id, status: "SENT" };
  }

  async sendTemplate(): Promise<SendResult> {
    throw new AppError({ code: "IGDM_NO_TEMPLATES", userMessage: "Instagram Direct does not support message templates. The 24h window is closed for this lead." });
  }

  canSendFreeform(lastInboundAt: Date | null, now = new Date()): boolean {
    return lastInboundAt != null && now.getTime() - lastInboundAt.getTime() < DAY_MS;
  }

  verifySignature(req: WebhookRequest): boolean {
    return verifyMetaSignature(req.rawBody, req.headers["x-hub-signature-256"], this.cfg.appSecret);
  }

  parseWebhook(payload: unknown): MessagingEvent[] {
    return parseInstagramWebhook(payload);
  }

  async testConnection() {
    try {
      const res = await request<{ username?: string }>(
        `https://graph.instagram.com/${this.version}/me?fields=username&access_token=${encodeURIComponent(this.cfg.accessToken)}`,
        { provider: "Instagram", describeError: describeMetaError("Instagram") },
      );
      return { ok: true, message: `Instagram messaging ready for @${res.data.username ?? this.cfg.igUserId}.` };
    } catch (e) {
      return { ok: false, message: e instanceof AppError ? e.userMessage : "Instagram messaging check failed." };
    }
  }
}

interface IgWebhook {
  object?: string;
  entry?: {
    id?: string;
    messaging?: {
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: { mid?: string; text?: string; is_echo?: boolean };
      referral?: { source?: string; type?: string; ref?: string };
    }[];
  }[];
}

export function parseInstagramWebhook(payload: unknown): MessagingEvent[] {
  const out: MessagingEvent[] = [];
  const p = payload as IgWebhook;
  if (p.object !== "instagram") return out;
  for (const entry of p.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      if (!m.message?.mid || m.message.is_echo) continue;
      out.push({
        kind: "message",
        channel: "INSTAGRAM",
        accountId: entry.id ?? m.recipient?.id ?? "",
        externalMessageId: m.message.mid,
        from: m.sender?.id ?? "",
        text: m.message.text ?? "[attachment]",
        timestamp: new Date(m.timestamp ?? Date.now()),
        referral: m.referral ? { sourceId: m.referral.ref ?? null, sourceType: m.referral.type ?? null, sourceUrl: null, headline: null } : null,
      });
    }
  }
  return out;
}
