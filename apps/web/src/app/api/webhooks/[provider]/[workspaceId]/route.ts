import { NextResponse } from "next/server";
import { processPaymentWebhook } from "@revenueos/core";
import { isUuid } from "@revenueos/database";
import { createLogger } from "@revenueos/shared";
import { kick } from "@/server/runner";
import "@/server/boot";

export const maxDuration = 60;
const log = createLogger({ component: "payment-webhook" });
const PROVIDERS = { mercadopago: "MERCADOPAGO", stripe: "STRIPE", mock: "MOCK" } as const;

/**
 * Payment notifications (Mercado Pago / Stripe / demo mock). The signature is
 * verified, the event id is stored UNIQUE (idempotent), and the real status is
 * fetched from the provider's official API before any revenue is recorded.
 */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string; workspaceId: string }> }) {
  const { provider, workspaceId } = await ctx.params;
  const id = PROVIDERS[provider.toLowerCase() as keyof typeof PROVIDERS];
  if (!id || !isUuid(workspaceId)) return NextResponse.json({ error: "unknown endpoint" }, { status: 404 });
  const rawBody = await req.text();
  if (rawBody.length > 500_000) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  const headers: Record<string, string | undefined> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  const query = Object.fromEntries(new URL(req.url).searchParams.entries());
  try {
    const r = await processPaymentWebhook(id, workspaceId, { rawBody, headers, query });
    if (r.status === "processed") kick([workspaceId]);
    if (r.status === "invalid_signature") return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
    if (r.status === "failed") return NextResponse.json({ ok: false }, { status: 500 });
    return NextResponse.json({ ok: true, status: r.status });
  } catch (e) {
    log.error("payment webhook failed", { provider: id, workspace: workspaceId, error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
