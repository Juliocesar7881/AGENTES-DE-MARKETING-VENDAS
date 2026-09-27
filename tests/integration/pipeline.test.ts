import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { processInboundMessage, processPaymentWebhook, recordClick, registerHandler, runSchedulerTick, totals } from "@revenueos/core";
import { activities, and, attributionEvents, checkouts, contents, eq, events, getDb, inArray, jobs, leads, messages, payments, socialPosts, sql, videoRenders, workspaces } from "@revenueos/database";
import type { MockPaymentProvider } from "@revenueos/providers/payment";
import { cleanupLocalHandler } from "../../apps/worker/src/handlers/local";
import { renderFinalFailure, renderHandler } from "../../apps/worker/src/handlers/render";
import { doubles, makeLiveBusiness, runner, useDoubles } from "./helpers";

/**
 * The autonomous revenue loop end to end, on a LIVE business, driven only by
 * the scheduler clock and events. External platforms (Claude, Instagram,
 * TikTok, WhatsApp, payment provider) are test doubles; the database, RLS,
 * job queue, orchestrator, the worker's Remotion/FFmpeg render and the
 * attribution/learning code are the real thing.
 *
 * NEGÓCIO → ESTRATÉGIA → ROTEIRO → VÍDEO → RENDER → AGENDAMENTO → PUBLICAÇÃO →
 * CLIQUE → LEAD → CONVERSA → OFERTA → CHECKOUT → PAGAMENTO → ATRIBUIÇÃO → APRENDIZADO
 */
describe("FULL LOOP — one LIVE business from empty buffer to attributed revenue", () => {
  let ws: Awaited<ReturnType<typeof makeLiveBusiness>>["ws"];
  let contentId: string;
  let refCode: string;
  let leadId: string;

  beforeAll(async () => {
    process.env.REVENUEOS_RENDER_SCALE = "0.25";
    useDoubles();
    registerHandler("RENDER_VIDEO", renderHandler, renderFinalFailure);
    registerHandler("CLEANUP_LOCAL_RENDERS", cleanupLocalHandler);
    ({ ws } = await makeLiveBusiness("Loop"));
    // One ready video is enough for the test; the sales agent may answer at any hour.
    await getDb()
      .update(workspaces)
      .set({ targetReadyBuffer: 1, salesSettings: { ...ws.salesSettings, businessHours: { ...ws.salesSettings.businessHours, enabled: false } } })
      .where(eq(workspaces.id, ws.id));
  });

  it("the scheduler notices the empty buffer and the agents create, render and schedule a video", async () => {
    const tick = await runSchedulerTick({ force: true });
    expect(tick.ran).toBe(true);
    const needed = await getDb().select().from(events).where(and(eq(events.workspaceId, ws.id), eq(events.type, "CONTENT_NEEDED")));
    expect(needed).toHaveLength(1);

    // Strategy → creative → real render → RENDER_COMPLETED → scheduler, all through the queue.
    await runner().drain({ timeoutMs: 600_000 });

    const [c] = await getDb().select().from(contents).where(eq(contents.workspaceId, ws.id));
    expect(c, "a content item was created").toBeTruthy();
    contentId = c!.id;
    const trail = await getDb().execute(sql`SELECT type, status, attempts, last_error FROM jobs WHERE workspace_id = ${ws.id} ORDER BY created_at`);
    expect(c!.status, `${c!.status} ${c!.failureReason ?? ""} ${JSON.stringify(trail)}`).toBe("SCHEDULED");
    expect(c!.createdBy).toBe("AGENT");
    expect(c!.currentSpecId).not.toBeNull();
    expect(["PASSED", "WARNINGS"]).toContain(c!.qaStatus);

    const [render] = await getDb().select().from(videoRenders).where(and(eq(videoRenders.contentId, contentId), eq(videoRenders.status, "COMPLETED")));
    expect(render, "a completed render exists").toBeTruthy();
    expect(existsSync(render!.localPath!)).toBe(true);
    expect(statSync(render!.localPath!).size).toBeGreaterThan(10_000);
    expect(render!.hasAudio).toBe(true);
    expect(render!.videoCodec).toBe("h264");
    expect(render!.localPath).toContain(ws.id);

    const posts = await getDb().select().from(socialPosts).where(eq(socialPosts.contentId, contentId));
    expect(posts.map((p) => p.platform).sort()).toEqual(["INSTAGRAM", "TIKTOK"]);
    expect(posts.every((p) => p.workspaceId === ws.id && p.trackedLinkCode)).toBe(true);
    const failed = await getDb().select().from(jobs).where(and(eq(jobs.workspaceId, ws.id), eq(jobs.status, "FAILED")));
    expect(failed.map((j) => `${j.type}: ${j.lastError}`)).toEqual([]);
  }, 700_000);

  it("at slot time the video is published to every connected network", async () => {
    // Fast-forward: the slot is due now.
    await getDb()
      .update(jobs)
      .set({ scheduledAt: new Date(Date.now() - 1000) })
      .where(and(eq(jobs.workspaceId, ws.id), eq(jobs.type, "PUBLISH_POST"), inArray(jobs.status, ["QUEUED", "RETRYING"])));
    await runner().drain({ timeoutMs: 60_000 });
    const posts = await getDb().select().from(socialPosts).where(eq(socialPosts.contentId, contentId));
    expect(posts.every((p) => p.status === "PUBLISHED" && p.platformPostId)).toBe(true);
    const [c] = await getDb().select().from(contents).where(eq(contents.id, contentId));
    expect(c!.status).toBe("PUBLISHED");
    refCode = posts.find((p) => p.platform === "INSTAGRAM")!.trackedLinkCode!;
    // Metrics are collected later on their own cadence (never on publish).
    const metrics = await getDb().select().from(jobs).where(and(eq(jobs.workspaceId, ws.id), eq(jobs.type, "SYNC_METRICS")));
    expect(metrics.length).toBeGreaterThan(0);
  }, 120_000);

  it("a viewer clicks the tracked link and messages the business — the lead lands in the CRM attributed to the video", async () => {
    const click = await recordClick(refCode, { ip: "203.0.113.7", userAgent: "vitest" });
    expect(click!.url).toContain("wa.me/5511999990000");
    expect(decodeURIComponent(click!.url)).toContain(refCode);
    const r = await processInboundMessage({
      workspaceId: ws.id,
      channel: "WHATSAPP",
      from: "5511988887777",
      fromName: "Carla Souza",
      text: `Olá! Vim pelo vídeo e quero saber mais (código ${refCode})`,
      externalMessageId: `wamid.${randomUUID()}`,
      origin: "WEBHOOK",
    });
    leadId = r.leadId;
    const [lead] = await getDb().select().from(leads).where(eq(leads.id, leadId));
    expect(lead!.workspaceId).toBe(ws.id);
    expect(lead!.sourceContentId).toBe(contentId);
    expect(lead!.sourcePlatform).toBe("INSTAGRAM");
    const clicks = await getDb().select().from(attributionEvents).where(and(eq(attributionEvents.workspaceId, ws.id), eq(attributionEvents.eventType, "CLICK")));
    expect(clicks).toHaveLength(1);
  });

  it("the Sales Agent answers, qualifies and sends a checkout when the lead wants to buy", async () => {
    await runner().drain({ timeoutMs: 60_000 });
    await processInboundMessage({ workspaceId: ws.id, channel: "WHATSAPP", from: "5511988887777", text: "Quanto custa?", externalMessageId: `wamid.${randomUUID()}`, origin: "WEBHOOK" });
    await runner().drain({ timeoutMs: 60_000 });
    await processInboundMessage({ workspaceId: ws.id, channel: "WHATSAPP", from: "5511988887777", text: "Quero comprar, me manda o link", externalMessageId: `wamid.${randomUUID()}`, origin: "WEBHOOK" });
    await runner().drain({ timeoutMs: 60_000 });
    const outbound = await getDb().select().from(messages).where(and(eq(messages.leadId, leadId), eq(messages.direction, "OUTBOUND")));
    expect(outbound.length).toBeGreaterThanOrEqual(3);
    const chk = await getDb().select().from(checkouts).where(eq(checkouts.leadId, leadId));
    expect(chk).toHaveLength(1);
    expect(chk[0]!.contentId).toBe(contentId);
    const [lead] = await getDb().select().from(leads).where(eq(leads.id, leadId));
    expect(lead!.stage).toBe("CHECKOUT");
    // No revenue yet: only a verified payment webhook can create it.
    expect(await getDb().select().from(payments).where(eq(payments.workspaceId, ws.id))).toHaveLength(0);
  }, 120_000);

  it("the verified payment webhook becomes revenue attributed to the video, and learning runs", async () => {
    const [chk] = await getDb().select().from(checkouts).where(eq(checkouts.leadId, leadId));
    const req = (doubles.payment as MockPaymentProvider).buildWebhook({
      eventId: `evt_${randomUUID()}`,
      externalReference: chk!.externalReference,
      providerPaymentId: `pay_${randomUUID()}`,
      status: "APPROVED",
      amountCents: chk!.amountCents,
      currency: "BRL",
    });
    expect((await processPaymentWebhook("MOCK", ws.id, req)).status).toBe("processed");
    await runner().drain({ timeoutMs: 60_000 });

    const [pay] = await getDb().select().from(payments).where(eq(payments.workspaceId, ws.id));
    expect(pay!.status).toBe("APPROVED");
    expect(pay!.contentId).toBe(contentId);
    expect(pay!.leadId).toBe(leadId);
    const [lead] = await getDb().select().from(leads).where(eq(leads.id, leadId));
    expect(lead!.stage).toBe("WON");
    const purchase = await getDb().select().from(attributionEvents).where(and(eq(attributionEvents.workspaceId, ws.id), eq(attributionEvents.eventType, "PURCHASE")));
    expect(purchase[0]!.contentId).toBe(contentId);
    const perContent = (await getDb().execute(sql`SELECT coalesce(sum(amount_cents), 0)::int AS cents FROM payments WHERE content_id = ${contentId} AND status = 'APPROVED'`)) as unknown as { cents: number }[];
    expect(Number(perContent[0]!.cents)).toBe(chk!.amountCents);
    const learned = await getDb().select().from(jobs).where(and(eq(jobs.workspaceId, ws.id), eq(jobs.type, "LEARNING_UPDATE")));
    expect(learned.map((j) => j.status)).toEqual(["COMPLETED"]);
    const t = await totals([ws.id], new Date(Date.now() - 86400_000));
    expect(t.revenueCents).toBe(chk!.amountCents);
    expect(t.leads).toBe(1);
    expect(t.sales).toBe(1);
  }, 120_000);

  it("every step left an audit trail in the activity feed", async () => {
    const types = new Set((await getDb().select({ type: activities.type }).from(activities).where(eq(activities.workspaceId, ws.id))).map((r) => r.type));
    for (const t of ["CONTENT_NEEDED", "RENDER_COMPLETED", "POST_SCHEDULED", "POST_PUBLISHED", "LEAD_CREATED", "AI_REPLIED", "PAYMENT_APPROVED"]) expect(types, t).toContain(t);
    const failed = await getDb().execute(sql`SELECT type, last_error FROM jobs WHERE workspace_id = ${ws.id} AND status = 'FAILED'`);
    expect(failed).toEqual([]);
  });
});
