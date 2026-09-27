import "server-only";
import { NextResponse } from "next/server";
import { handleMessagingWebhook, whatsappVerifyToken } from "@revenueos/core";
import { createLogger } from "@revenueos/shared";
import { safeEqual } from "@revenueos/shared/server";
import { kick } from "./runner";
import "./boot";

const log = createLogger({ component: "messaging-webhook" });

/** Meta webhook subscription handshake (hub.challenge). */
export function verifyMetaSubscription(req: Request): Response {
  const u = new URL(req.url);
  const mode = u.searchParams.get("hub.mode");
  const token = u.searchParams.get("hub.verify_token") ?? "";
  const challenge = u.searchParams.get("hub.challenge") ?? "";
  if (mode === "subscribe" && safeEqual(token, whatsappVerifyToken()) && /^[\w-]{1,200}$/.test(challenge)) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Messaging webhook body: verified per workspace, processed idempotently, then the Sales Agent is woken up. */
export async function receiveMetaWebhook(req: Request, channel: "WHATSAPP" | "INSTAGRAM"): Promise<Response> {
  const raw = await req.text();
  if (raw.length > 1_000_000) return new Response("Payload too large", { status: 413 });
  try {
    const r = await handleMessagingWebhook(channel, raw, req.headers.get("x-hub-signature-256") ?? undefined);
    if (r.processed || r.statuses) kick(undefined, { maxJobs: 10, timeoutMs: 45_000 });
    if (r.rejected && !r.processed) return NextResponse.json({ ok: false }, { status: 400 });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    log.error("messaging webhook failed", { channel, error: e instanceof Error ? e.message : String(e) });
    // 500 makes Meta retry later; processing is idempotent per message id.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
