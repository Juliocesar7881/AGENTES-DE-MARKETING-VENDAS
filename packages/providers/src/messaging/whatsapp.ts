import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError, type DeliveryStatus } from "@revenueos/shared";
import { request } from "../http";
import { describeMetaError } from "../social/instagram";
import { DAY_MS, type MessagingEvent, type MessagingProvider, type SendResult, type WebhookRequest } from "./types";

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  apiVersion?: string;
}

export function verifyMetaSignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const [algo, sig] = header.split("=");
  if (algo !== "sha256" || !sig) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const STATUS_MAP: Record<string, DeliveryStatus> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };

/** WhatsApp Business Cloud API (official). */
export class WhatsAppCloudProvider implements MessagingProvider {
  readonly channel = "WHATSAPP" as const;
  readonly isMock = false;
  private readonly version: string;

  constructor(private readonly cfg: WhatsAppConfig) {
    if (!cfg.phoneNumberId || !cfg.accessToken) {
      throw new AppError({ code: "WA_NOT_CONFIGURED", userMessage: "WhatsApp is not connected. Add the Phone Number ID and access token in Integrations → WhatsApp." });
    }
    this.version = cfg.apiVersion ?? "v23.0";
  }

  private async send(body: Record<string, unknown>): Promise<SendResult> {
    const res = await request<{ messages?: { id: string }[] }>(`https://graph.facebook.com/${this.version}/${this.cfg.phoneNumberId}/messages`, {
      provider: "WhatsApp",
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.accessToken}` },
      json: { messaging_product: "whatsapp", recipient_type: "individual", ...body },
      rateLimitKey: `wa:${this.cfg.phoneNumberId}`,
      ratePerMinute: 60,
      describeError: (status, b) => {
        const code = (b as { error?: { code?: number } })?.error?.code;
        if (code === 131047) return { code: "WA_WINDOW_CLOSED", userMessage: "WhatsApp only allows template messages more than 24h after the customer's last message." };
        if (code === 131026) return { code: "WA_UNDELIVERABLE", userMessage: "WhatsApp could not deliver this message (number not on WhatsApp or blocked)." };
        if (code === 131056) return { code: "WA_PAIR_RATE", userMessage: "Too many messages to this contact in a short time. Will retry later." };
        return describeMetaError("WhatsApp")(status, b);
      },
    });
    const id = res.data.messages?.[0]?.id;
    if (!id) throw new AppError({ code: "WA_NO_ID", userMessage: "WhatsApp accepted the request but returned no message id." });
    return { externalMessageId: id, status: "SENT" };
  }

  sendText(input: { to: string; text: string }): Promise<SendResult> {
    return this.send({ to: input.to.replace(/\D/g, ""), type: "text", text: { preview_url: true, body: input.text.slice(0, 4096) } });
  }

  sendTemplate(input: { to: string; templateName: string; language: string; variables: string[] }): Promise<SendResult> {
    return this.send({
      to: input.to.replace(/\D/g, ""),
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.language },
        components: input.variables.length
          ? [{ type: "body", parameters: input.variables.map((text) => ({ type: "text", text })) }]
          : [],
      },
    });
  }

  canSendFreeform(lastInboundAt: Date | null, now = new Date()): boolean {
    return lastInboundAt != null && now.getTime() - lastInboundAt.getTime() < DAY_MS;
  }

  verifySignature(req: WebhookRequest): boolean {
    return verifyMetaSignature(req.rawBody, req.headers["x-hub-signature-256"], this.cfg.appSecret);
  }

  parseWebhook(payload: unknown): MessagingEvent[] {
    return parseWhatsAppWebhook(payload);
  }

  async testConnection() {
    try {
      const res = await request<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
        `https://graph.facebook.com/${this.version}/${this.cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
        { provider: "WhatsApp", headers: { Authorization: `Bearer ${this.cfg.accessToken}` }, describeError: describeMetaError("WhatsApp") },
      );
      return { ok: true, message: `Connected to ${res.data.verified_name ?? "WhatsApp"} (${res.data.display_phone_number ?? this.cfg.phoneNumberId}).`, details: res.data };
    } catch (e) {
      return { ok: false, message: e instanceof AppError ? e.userMessage : "WhatsApp connection failed." };
    }
  }
}

interface WaWebhook {
  object?: string;
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: {
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
          referral?: { source_id?: string; source_url?: string; source_type?: string; headline?: string };
        }[];
        statuses?: { id: string; status: string; timestamp: string; errors?: { title?: string; code?: number }[] }[];
      };
    }[];
  }[];
}

export function parseWhatsAppWebhook(payload: unknown): MessagingEvent[] {
  const out: MessagingEvent[] = [];
  const p = payload as WaWebhook;
  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v) continue;
      const accountId = v.metadata?.phone_number_id ?? "";
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name ?? null]));
      for (const m of v.messages ?? []) {
        const text =
          m.text?.body ??
          m.button?.text ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          `[${m.type} message]`;
        out.push({
          kind: "message",
          channel: "WHATSAPP",
          accountId,
          externalMessageId: m.id,
          from: m.from,
          fromName: names.get(m.from) ?? null,
          text,
          timestamp: new Date(Number(m.timestamp) * 1000),
          referral: m.referral
            ? { sourceId: m.referral.source_id ?? null, sourceUrl: m.referral.source_url ?? null, sourceType: m.referral.source_type ?? null, headline: m.referral.headline ?? null }
            : null,
        });
      }
      for (const s of v.statuses ?? []) {
        out.push({
          kind: "status",
          channel: "WHATSAPP",
          accountId,
          externalMessageId: s.id,
          status: STATUS_MAP[s.status] ?? "SENT",
          error: s.errors?.[0]?.title ?? null,
          timestamp: new Date(Number(s.timestamp) * 1000),
        });
      }
    }
  }
  return out;
}
