import { randomUUID } from "node:crypto";
import { and, checkouts, contents, desc, eq, gte, inArray, jobs, postingSlots, socialPosts, sql, workerInstances, workspaces } from "@revenueos/database";
import { MockPaymentProvider } from "@revenueos/providers/payment";
import { AppError, createLogger, JOB_TYPES, startOfLocalDay, type JobType } from "@revenueos/shared";
import { deriveKey, getConfig } from "../config";
import { runCreative, runStrategyPlan, simulateRender } from "../domain/creative-pipeline";
import { refreshInsights } from "../domain/learning";
import { processInboundMessage } from "../domain/leads";
import { rollupAnalytics } from "../domain/maintenance";
import { syncPostMetrics } from "../domain/metrics";
import { processPaymentWebhook } from "../domain/payments";
import { db, now } from "../deps";
import { JOB_DEFINITIONS } from "../jobs/definitions";
import { JobRunner } from "../jobs/runner";
import { registerCoreHandlers } from "../handlers";
import { scheduleContent } from "../domain/content";
import { recordActivity } from "../records";
import { DEMO_FIRST_NAMES, DEMO_LAST_NAMES } from "./data";

const log = createLogger({ component: "simulate-day" });

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ANY_TYPES = JOB_TYPES.filter((t) => JOB_DEFINITIONS[t].runner === "ANY" && t !== "SIMULATE_DAY") as JobType[];

export interface SimulationReport {
  workspaces: { id: string; name: string; contents: number; published: number; leads: number; checkouts: number; sales: number; revenueCents: number }[];
  realRendersQueued: number;
}

/**
 * DEMO "Simulate Day": runs the REAL pipeline end-to-end for each DEMO
 * workspace — strategy → creative → (simulated or real) render → schedule →
 * mock publish → simulated metrics → leads → Sales Agent conversations →
 * checkouts → signed mock payment webhooks → attribution → learning.
 * Everything produced is flagged DEMO. Refuses to run on LIVE workspaces.
 */
export async function simulateDay(opts: { workspaceIds: string[]; contentsPerWorkspace?: number; userId?: string | null }): Promise<SimulationReport> {
  registerCoreHandlers();
  const perWs = Math.max(1, Math.min(4, opts.contentsPerWorkspace ?? 2));
  const list = opts.workspaceIds.length ? await db().select().from(workspaces).where(inArray(workspaces.id, opts.workspaceIds)) : [];
  const live = list.filter((w) => w.environment !== "DEMO");
  if (live.length) throw new AppError({ code: "SIMULATION_LIVE", userMessage: `Simulate Day only runs on DEMO workspaces (${live.map((w) => w.name).join(", ")} is LIVE).` });
  const [worker] = await db().select().from(workerInstances).orderBy(desc(workerInstances.lastHeartbeatAt)).limit(1);
  const workerOnline = Boolean(worker && now().getTime() - worker.lastHeartbeatAt.getTime() < 90_000 && !worker.paused);
  const runner = new JobRunner({ runnerId: `simulation-${randomUUID().slice(0, 8)}`, runners: ["ANY"], concurrency: { ai: 4, io: 8, render: 0 }, types: ANY_TYPES });
  const mockPay = new MockPaymentProvider(deriveKey("mock-payments"), getConfig().appUrl);
  const report: SimulationReport = { workspaces: [], realRendersQueued: 0 };

  for (const ws of list) {
    const r = rng(`${ws.id}:${now().toISOString().slice(0, 10)}:${randomUUID()}`);
    const simJob = randomUUID();
    // 1-2) Strategist + Creative (mock AI in DEMO)
    const plan = await runStrategyPlan(ws, { count: perWs, jobId: simJob, origin: "SIMULATION" });
    // The simulation drives the creative step inline; the routed CREATIVE jobs are closed to avoid double work.
    await db()
      .update(jobs)
      .set({ status: "COMPLETED", completedAt: now(), result: { handledBy: "simulation" } })
      .where(and(eq(jobs.type, "CREATIVE_GENERATE"), inArray(jobs.status, ["QUEUED", "RETRYING"]), sql`${jobs.payload}->>'contentId' = ANY(${sql.raw(`ARRAY[${plan.contentIds.map((c) => `'${c}'`).join(",")}]`)})`));
    for (const id of plan.contentIds) await runCreative(ws, id, { jobId: simJob, origin: "SIMULATION" });
    // 3) Render: simulated now (keeps the demo instant). If the local worker is online, the
    //    routed RENDER_VIDEO jobs stay queued and later attach a real MP4; otherwise they are cancelled.
    for (const id of plan.contentIds) await simulateRender(id);
    const renderJobs = await db()
      .select({ id: jobs.id, payload: jobs.payload })
      .from(jobs)
      .where(and(eq(jobs.type, "RENDER_VIDEO"), inArray(jobs.status, ["QUEUED", "RETRYING"]), sql`${jobs.payload}->>'contentId' = ANY(${sql.raw(`ARRAY[${plan.contentIds.map((c) => `'${c}'`).join(",")}]`)})`));
    for (const j of renderJobs) {
      if (workerOnline) {
        await db().update(jobs).set({ payload: { ...j.payload, attachOnly: true }, priority: 190 }).where(eq(jobs.id, j.id));
        report.realRendersQueued++;
      } else {
        await db().update(jobs).set({ status: "CANCELLED", lastError: "Simulated render used (worker offline during Simulate Day)", completedAt: now() }).where(eq(jobs.id, j.id));
      }
    }
    // 4) Schedule into today's slots and publish now (mock social)
    const dayStart = startOfLocalDay(now(), ws.timezone);
    const slots = await db().select().from(postingSlots).where(and(eq(postingSlots.workspaceId, ws.id), gte(postingSlots.scheduledFor, dayStart))).orderBy(postingSlots.scheduledFor).limit(10);
    for (const [i, id] of plan.contentIds.entries()) {
      await scheduleContent(id, "SIMULATION", { at: new Date(now().getTime() + 1000) });
      const slot = slots.filter((s) => s.status === "OPEN" || s.status === "MISSED")[i];
      if (slot) await db().update(postingSlots).set({ status: "FILLED", contentId: id }).where(eq(postingSlots.id, slot.id));
    }
    await new Promise((res) => setTimeout(res, 1100));
    await runner.drain({ workspaceIds: [ws.id], timeoutMs: 60_000 });
    const posts = await db().select().from(socialPosts).where(and(eq(socialPosts.workspaceId, ws.id), inArray(socialPosts.contentId, plan.contentIds), eq(socialPosts.status, "PUBLISHED")));
    for (const p of posts) await syncPostMetrics(p.id);

    // 5) Leads arrive through the real inbound pipeline, referencing the post's tracked code
    const byContent = new Map<string, typeof posts>();
    for (const p of posts) byContent.set(p.contentId, [...(byContent.get(p.contentId) ?? []), p]);
    const simulatedLeads: { conversationId: string; leadId: string; from: string; quality: number }[] = [];
    for (const [, cposts] of byContent) {
      const quality = 0.4 + r() * 1.2;
      const n = Math.max(2, Math.round((3 + r() * 6) * quality));
      for (let k = 0; k < n; k++) {
        const post = cposts[k % cposts.length]!;
        const name = `${DEMO_FIRST_NAMES[Math.floor(r() * DEMO_FIRST_NAMES.length)]} ${DEMO_LAST_NAMES[Math.floor(r() * DEMO_LAST_NAMES.length)]}`;
        const from = `55119${String(Math.floor(10000000 + r() * 89999999))}`;
        const opening = ["Oi! Vi o vídeo e quero saber mais", "Olá, vim pelo vídeo! Como funciona?", "Oi, tenho interesse", "Boa tarde! Vi vocês no Reels"][Math.floor(r() * 4)]!;
        const res = await processInboundMessage({ workspaceId: ws.id, channel: "MOCK", from, fromName: name, text: `${opening} (código ${post.trackedLinkCode ?? ""})`, externalMessageId: `sim_${randomUUID()}`, origin: "SIMULATION" });
        simulatedLeads.push({ conversationId: res.conversationId, leadId: res.leadId, from, quality });
      }
    }
    await runner.drain({ workspaceIds: [ws.id], timeoutMs: 90_000 });

    // 6) Conversations evolve: some ask the price, some buy, a few opt out
    const turn = async (lead: (typeof simulatedLeads)[number], text: string) => {
      await processInboundMessage({ workspaceId: ws.id, channel: "MOCK", from: lead.from, text, externalMessageId: `sim_${randomUUID()}`, origin: "SIMULATION" });
    };
    const askers = simulatedLeads.filter((l) => r() < 0.75);
    for (const l of askers) await turn(l, ["Quanto custa?", "Qual o valor?", "E o preço?"][Math.floor(r() * 3)]!);
    for (const l of simulatedLeads.filter((x) => !askers.includes(x)).slice(0, 1)) await turn(l, "Por favor, pare de me mandar mensagens");
    await runner.drain({ workspaceIds: [ws.id], timeoutMs: 90_000 });
    const buyers = askers.filter((l) => r() < 0.2 * l.quality);
    const objectors = askers.filter((l) => !buyers.includes(l) && r() < 0.3);
    for (const l of buyers) await turn(l, "Quero fechar! Me manda o link");
    for (const l of objectors) await turn(l, "Achei um pouco caro, vou pensar");
    await runner.drain({ workspaceIds: [ws.id], timeoutMs: 90_000 });

    // 7) Buyers pay → signed mock webhook → official query → attribution
    const pending = await db()
      .select()
      .from(checkouts)
      .where(and(eq(checkouts.workspaceId, ws.id), inArray(checkouts.status, ["CREATED", "SENT"]), inArray(checkouts.leadId, buyers.map((b) => b.leadId).length ? buyers.map((b) => b.leadId) : ["00000000-0000-0000-0000-000000000000"])));
    for (const chk of pending) {
      if (r() < 0.12) continue; // some checkouts are abandoned
      const req = mockPay.buildWebhook({ eventId: `evt_${randomUUID()}`, externalReference: chk.externalReference, providerPaymentId: `mock_pay_${randomUUID().slice(0, 12)}`, status: "APPROVED", amountCents: chk.amountCents, currency: chk.currency });
      await processPaymentWebhook("MOCK", ws.id, req);
    }
    await runner.drain({ workspaceIds: [ws.id], timeoutMs: 90_000 });
    await rollupAnalytics(ws);
    await refreshInsights(ws, 30);

    const stats = (await db().execute(sql`
      SELECT
        (SELECT count(*) FROM leads WHERE workspace_id = ${ws.id} AND created_at >= ${dayStart}) AS leads,
        (SELECT count(*) FROM checkouts WHERE workspace_id = ${ws.id} AND created_at >= ${dayStart}) AS checkouts,
        (SELECT count(*) FROM payments WHERE workspace_id = ${ws.id} AND status='APPROVED' AND approved_at >= ${dayStart}) AS sales,
        (SELECT coalesce(sum(amount_cents),0) FROM payments WHERE workspace_id = ${ws.id} AND status='APPROVED' AND approved_at >= ${dayStart}) AS revenue
    `)) as unknown as Record<string, string>[];
    const s = stats[0]!;
    const published = await db().select({ id: contents.id }).from(contents).where(and(inArray(contents.id, plan.contentIds), eq(contents.status, "PUBLISHED")));
    report.workspaces.push({ id: ws.id, name: ws.name, contents: plan.contentIds.length, published: published.length, leads: Number(s.leads), checkouts: Number(s.checkouts), sales: Number(s.sales), revenueCents: Number(s.revenue) });
    await recordActivity({ workspaceId: ws.id, type: "SIMULATION", title: `Simulated day (DEMO): ${plan.contentIds.length} contents, ${published.length} published, ${s.leads} leads, ${s.sales} sales`, actorType: opts.userId ? "USER" : "SYSTEM", actorId: opts.userId ?? null });
    log.info("simulated workspace", { workspace: ws.id, ...s });
  }
  return report;
}
