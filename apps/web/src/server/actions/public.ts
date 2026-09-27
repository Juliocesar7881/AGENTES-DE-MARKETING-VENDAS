"use server";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { deriveKey, getConfig, processInboundMessage, processPaymentWebhook, rateLimit } from "@revenueos/core";
import { checkouts, eq, getDb, workspaces } from "@revenueos/database";
import { MockPaymentProvider } from "@revenueos/providers/payment";
import { AppError } from "@revenueos/shared";
import { sha256Hex } from "@revenueos/shared/server";
import { z } from "zod";
import { run } from "../action";
import { kick } from "../runner";
import "../boot";

const LeadFormSchema = z.object({
  slug: z.string().min(1).max(80),
  name: z.string().trim().min(2, "Enter your name").max(120),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length >= 10 && v.length <= 15, "Enter your WhatsApp with area code"),
  message: z.string().trim().max(1000).default(""),
  ref: z.string().trim().max(12).optional().nullable(),
  consent: z.literal(true, { message: "Please accept to be contacted." }),
});

/** Public lead form (from tracked links). Rate limited per IP; creates the lead with attribution and wakes the Sales Agent. */
export async function submitLeadForm(input: unknown) {
  return run(async () => {
    const h = await headers();
    const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
    await rateLimit(`leadform:${sha256Hex(ip).slice(0, 16)}`, 10, 3600);
    const d = LeadFormSchema.parse(input);
    const [ws] = await getDb().select({ id: workspaces.id, status: workspaces.status }).from(workspaces).where(eq(workspaces.slug, d.slug)).limit(1);
    if (!ws || ws.status === "ARCHIVED") throw new AppError({ code: "NOT_FOUND", userMessage: "This form is not available." });
    const text = d.message || "Olá! Tenho interesse e gostaria de mais informações.";
    await processInboundMessage({ workspaceId: ws.id, channel: "WEBFORM", from: d.phone, fromName: d.name, text: d.ref ? `${text} (código ${d.ref.toUpperCase()})` : text, externalMessageId: `webform:${randomUUID()}`, phone: d.phone, refCode: d.ref?.toUpperCase() ?? null, origin: "WEBHOOK" });
    kick([ws.id]);
    return null;
  });
}

/** DEMO checkout: "pays" by sending an HMAC-signed mock webhook through the same pipeline real providers use. */
export async function payDemoCheckout(externalReference: string, outcome: "APPROVED" | "FAILED") {
  return run(async () => {
    const [chk] = await getDb().select({ c: checkouts, env: workspaces.environment }).from(checkouts).innerJoin(workspaces, eq(workspaces.id, checkouts.workspaceId)).where(eq(checkouts.externalReference, externalReference)).limit(1);
    if (!chk || chk.env !== "DEMO" || chk.c.provider !== "MOCK") throw new AppError({ code: "NOT_FOUND", userMessage: "Demo checkout not found." });
    const mock = new MockPaymentProvider(deriveKey("mock-payments"), getConfig().appUrl);
    const req = mock.buildWebhook({ eventId: `demo_evt_${randomUUID()}`, externalReference, providerPaymentId: `demo_pay_${randomUUID().slice(0, 8)}`, status: outcome, amountCents: chk.c.amountCents, currency: chk.c.currency });
    const r = await processPaymentWebhook("MOCK", chk.c.workspaceId, req);
    kick([chk.c.workspaceId]);
    return { status: r.status, message: r.message };
  });
}
