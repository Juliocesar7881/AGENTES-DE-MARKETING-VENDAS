import { randomUUID } from "node:crypto";
import {
  and,
  campaignExperiments,
  campaigns,
  contentPlans,
  contents,
  desc,
  eq,
  inArray,
  sql,
  videoRenders,
  videoSpecs,
  workspaces,
} from "@revenueos/database";
import { buildVideoSpec, generateCreative, planContent, regenerateHook } from "@revenueos/agents";
import {
  AppError,
  maxDurationFor,
  maxSimilarity,
  SIMILARITY_THRESHOLD,
  VideoSpecSchema,
  type ContentBrief,
  type Platform,
  type VideoSpec,
} from "@revenueos/shared";
import { db, now } from "../deps";
import { emitEvent } from "../events";
import type { JobOrigin } from "../jobs/queue";
import { resolveAI, type Workspace } from "../providers";
import { recordActivity } from "../records";
import { recordAgentFailure, recordAgentRun, setAgentStatus } from "./agent-runs";
import { loadBusinessContext, loadPerformanceContext } from "./context";
import { setContentStatus } from "./content";
import { runContentQaOnSpec } from "./qa";

/**
 * Strategist job: ONE AI call plans `count` briefs (batching saves cost), then
 * contents are created in PLANNING and handed to the Creative agent.
 */
export async function runStrategyPlan(ws: Workspace, opts: { count: number; jobId: string; origin: JobOrigin; focus?: string | null }): Promise<{ contentIds: string[]; planId: string }> {
  const count = Math.max(1, Math.min(8, Math.round(opts.count)));
  const [business, perf] = await Promise.all([loadBusinessContext(ws), loadPerformanceContext(ws, 30)]);
  const ai = await resolveAI(ws, "strategist");
  await setAgentStatus(ws.id, "STRATEGIST", "WORKING", { task: `Planning ${count} content(s)`, jobId: opts.jobId });
  let res;
  try {
    res = await planContent(ai.runtime, business, perf, { count, seed: `${ws.id}:${opts.jobId}`, focus: opts.focus });
  } catch (e) {
    await recordAgentFailure({ workspaceId: ws.id, jobId: opts.jobId, agent: "STRATEGIST", task: "strategy.plan", provider: ai.providerId, model: ai.runtime.model.model, promptVersion: "strategist", error: e });
    await setAgentStatus(ws.id, "STRATEGIST", "ERROR", { error: e instanceof AppError ? e.userMessage : String(e) });
    throw e;
  }
  const runId = await recordAgentRun({ workspaceId: ws.id, jobId: opts.jobId, isDemo: ai.isMock, result: res });
  const plan = res.result.data;
  const productIds = new Set(business.products.map((p) => p.id));
  const result = await db().transaction(async (tx) => {
    let campaignId: string | null = null;
    if (plan.campaign.action === "CONTINUE" && plan.campaign.campaignId) {
      const [c] = await tx.select().from(campaigns).where(and(eq(campaigns.id, plan.campaign.campaignId), eq(campaigns.workspaceId, ws.id))).limit(1);
      campaignId = c?.id ?? null;
    }
    if (!campaignId) {
      const [c] = await tx
        .insert(campaigns)
        .values({
          workspaceId: ws.id,
          name: plan.campaign.name,
          objective: plan.campaign.objective,
          status: "ACTIVE",
          productId: plan.briefs.find((b) => b.productId && productIds.has(b.productId))?.productId ?? null,
          angle: plan.campaign.angle,
          offer: plan.campaign.offer,
          cta: plan.campaign.cta,
          strategy: { summary: plan.summary },
          startDate: now().toISOString().slice(0, 10),
          createdBy: "AGENT",
        })
        .returning({ id: campaigns.id });
      campaignId = c!.id;
    }
    const [planRow] = await tx
      .insert(contentPlans)
      .values({ workspaceId: ws.id, campaignId, agentRunId: runId, summary: plan.summary, briefs: plan.briefs, dataCaveats: plan.dataCaveats, requestedCount: count })
      .returning({ id: contentPlans.id });
    const experimentIds = new Map<string, string>();
    const ids: string[] = [];
    for (const b of plan.briefs) {
      let experimentId: string | null = null;
      if (b.experiment) {
        const key = `${b.experiment.variable}:${b.experiment.hypothesis}`;
        if (!experimentIds.has(key)) {
          const [e] = await tx
            .insert(campaignExperiments)
            .values({ workspaceId: ws.id, campaignId, variable: b.experiment.variable, hypothesis: b.experiment.hypothesis, variants: [] })
            .returning({ id: campaignExperiments.id });
          experimentIds.set(key, e!.id);
        }
        experimentId = experimentIds.get(key)!;
      }
      const [row] = await tx
        .insert(contents)
        .values({
          workspaceId: ws.id,
          campaignId,
          contentPlanId: planRow!.id,
          productId: b.productId && productIds.has(b.productId) ? b.productId : null,
          experimentId,
          variantLabel: b.experiment?.variantLabel ?? null,
          title: b.title,
          status: "PLANNING",
          brief: b,
          templateId: b.templateId,
          format: b.format,
          hook: b.hook,
          hookType: b.hookType,
          angle: b.angle,
          cta: b.cta,
          ctaType: b.ctaType,
          objective: b.objective,
          targetPlatforms: filterPlatforms(b.targetPlatforms as Platform[], ws.targetPlatforms),
          createdBy: "AGENT",
          isDemo: ws.environment === "DEMO",
        })
        .returning({ id: contents.id, number: contents.number });
      ids.push(row!.id);
      if (experimentId) {
        await tx
          .update(campaignExperiments)
          .set({ variants: sql`${campaignExperiments.variants} || ${JSON.stringify([{ label: b.experiment!.variantLabel, contentId: row!.id }])}::jsonb` })
          .where(eq(campaignExperiments.id, experimentId));
      }
    }
    await emitEvent({ type: "STRATEGY_CREATED", workspaceId: ws.id, idempotencyKey: `strategy_created:${planRow!.id}`, payload: { planId: planRow!.id, contentIds: ids } }, tx, opts.origin);
    return { contentIds: ids, planId: planRow!.id };
  });
  await recordActivity({ workspaceId: ws.id, type: "STRATEGY_CREATED", title: `Strategist analyzed ${ws.name} and planned ${result.contentIds.length} content(s)${ai.isMock ? " (DEMO)" : ""}`, agentRole: "STRATEGIST", entityType: "content_plan", entityId: result.planId, details: { summary: plan.summary } });
  await setAgentStatus(ws.id, "STRATEGIST", "IDLE");
  return result;
}

function filterPlatforms(requested: Platform[], allowed: Platform[]): Platform[] {
  const set = new Set(allowed);
  const out = requested.filter((p) => set.has(p));
  return out.length ? out : allowed;
}

async function recentFingerprints(ws: Workspace, excludeId: string) {
  const rows = await db()
    .select({ id: contents.id, title: contents.title, hook: contents.hook, script: contents.script, templateId: contents.templateId, angle: contents.angle })
    .from(contents)
    .where(and(eq(contents.workspaceId, ws.id), sql`${contents.id} <> ${excludeId}`, inArray(contents.status, ["READY_TO_RENDER", "RENDERING", "RENDERED", "READY", "SCHEDULED", "PUBLISHING", "PUBLISHED"])))
    .orderBy(desc(contents.createdAt))
    .limit(30);
  return rows.map((r) => ({ id: r.id, title: r.title, hook: r.hook ?? "", script: r.script ?? "", templateId: r.templateId ?? "", angle: r.angle ?? "" }));
}

/**
 * Creative job: brief → VideoSpec + per-platform copy. Rejects near-duplicates
 * of recent content (fatigue control) and regenerates with feedback (≤2x).
 */
export async function runCreative(ws: Workspace, contentId: string, opts: { jobId: string; origin: JobOrigin; feedback?: string | null }): Promise<{ specId: string; similarity: number }> {
  const [content] = await db().select().from(contents).where(and(eq(contents.id, contentId), eq(contents.workspaceId, ws.id))).limit(1);
  if (!content) throw new AppError({ code: "NOT_FOUND", userMessage: "Content not found." });
  if (!content.brief) throw new AppError({ code: "NO_BRIEF", userMessage: "This content has no brief to generate from." });
  if (!["IDEA", "PLANNING", "SCRIPTING", "GENERATING", "FAILED"].includes(content.status) && !opts.feedback) {
    // Idempotency: a duplicate/late job never overwrites content that already moved on.
    return { specId: content.currentSpecId ?? "", similarity: content.similarityScore ?? 0 };
  }
  await setContentStatus(content.id, "GENERATING");
  const business = await loadBusinessContext(ws);
  const history = await recentFingerprints(ws, content.id);
  const avoidHooks = history.map((h) => h.hook).filter(Boolean);
  const platforms = (content.targetPlatforms.length ? content.targetPlatforms : ws.targetPlatforms) as Platform[];
  const maxDurationSec = Math.min(60, maxDurationFor(platforms));
  const ai = await resolveAI(ws, "creative");
  await setAgentStatus(ws.id, "CREATIVE", "WORKING", { task: `Writing Content #${content.number}`, jobId: opts.jobId });
  let feedback = opts.feedback ?? null;
  let attempt = 0;
  for (;;) {
    attempt++;
    let res;
    try {
      res = await generateCreative(ai.runtime, business, content.brief as ContentBrief, { seed: `${content.id}:${attempt}:${content.regenerationCount}`, avoidHooks, maxDurationSec, feedback });
    } catch (e) {
      await recordAgentFailure({ workspaceId: ws.id, jobId: opts.jobId, agent: "CREATIVE", task: "creative.generate", provider: ai.providerId, model: ai.runtime.model.model, promptVersion: "creative", error: e });
      await setAgentStatus(ws.id, "CREATIVE", "ERROR", { error: e instanceof AppError ? e.userMessage : String(e) });
      throw e;
    }
    const runId = await recordAgentRun({ workspaceId: ws.id, jobId: opts.jobId, isDemo: ai.isMock, result: res });
    const out = res.result.data;
    const specId = randomUUID();
    const spec = buildVideoSpec(out.video, business, { specId, contentId: content.id, campaignId: content.campaignId }, {
      generator: ai.isMock ? "mock" : "agent",
      promptVersion: res.promptVersion,
      model: res.result.model,
      experiment: content.experimentId ? { id: content.experimentId, variantLabel: content.variantLabel ?? undefined } : undefined,
    });
    const sim = maxSimilarity({ hook: spec.hook.text, script: out.script, templateId: spec.templateId, angle: out.video.angle }, history);
    if (sim.breakdown.score > SIMILARITY_THRESHOLD && attempt < 3) {
      const other = history.find((h) => h.id === sim.id);
      feedback = `The draft is ${Math.round(sim.breakdown.score * 100)}% similar to a recent content ("${other?.hook ?? other?.title ?? ""}"). Use a clearly different hook, angle and structure.`;
      avoidHooks.unshift(spec.hook.text);
      continue;
    }
    const [{ v } = { v: 0 }] = await db().select({ v: sql<number>`coalesce(max(${videoSpecs.version}), 0)` }).from(videoSpecs).where(eq(videoSpecs.contentId, content.id));
    await db().insert(videoSpecs).values({ id: specId, workspaceId: ws.id, contentId: content.id, version: Number(v) + 1, schemaVersion: spec.schemaVersion, spec, createdBy: ai.isMock ? "MOCK" : "AGENT", agentRunId: runId, promptVersion: res.promptVersion });
    const qa = runContentQaOnSpec(spec, platforms, out.copy, sim.breakdown.score, history.find((h) => h.id === sim.id)?.title ?? null);
    await setContentStatus(content.id, "READY_TO_RENDER", {
      currentSpecId: specId,
      title: spec.title,
      script: out.script,
      copy: out.copy,
      hook: spec.hook.text,
      hookType: spec.hook.type,
      angle: out.video.angle,
      cta: spec.cta.text,
      ctaType: spec.cta.type,
      templateId: spec.templateId,
      format: spec.format,
      durationSec: spec.duration,
      similarityScore: sim.breakdown.score,
      similarToContentId: sim.breakdown.score > 0.4 ? sim.id : null,
      qaStatus: qa.status === "FAILED" ? "FAILED" : "PENDING",
      qaReport: { checks: qa.checks, checkedAt: now().toISOString() },
      failureReason: null,
    });
    await emitEvent({ type: "CONTENT_CREATED", workspaceId: ws.id, idempotencyKey: `content_created:${content.id}:${specId}`, payload: { contentId: content.id, specId } }, db(), opts.origin);
    await recordActivity({ workspaceId: ws.id, type: "CONTENT_CREATED", title: `Creative created Content #${content.number}: "${spec.hook.text}"`, agentRole: "CREATIVE", entityType: "content", entityId: content.id, details: { template: spec.templateId, duration: spec.duration } });
    await setAgentStatus(ws.id, "CREATIVE", "IDLE");
    return { specId, similarity: sim.breakdown.score };
  }
}

export async function currentSpec(contentId: string): Promise<{ id: string; spec: VideoSpec } | null> {
  const [c] = await db().select({ currentSpecId: contents.currentSpecId }).from(contents).where(eq(contents.id, contentId)).limit(1);
  if (!c?.currentSpecId) return null;
  const [s] = await db().select().from(videoSpecs).where(eq(videoSpecs.id, c.currentSpecId)).limit(1);
  if (!s) return null;
  return { id: s.id, spec: VideoSpecSchema.parse(s.spec) };
}

/** Human edit of a VideoSpec (Content Detail → Edit): validated, versioned, then re-rendered. */
export async function saveEditedSpec(contentId: string, spec: unknown, userId: string): Promise<string> {
  const [content] = await db().select().from(contents).where(eq(contents.id, contentId)).limit(1);
  if (!content) throw new AppError({ code: "NOT_FOUND", userMessage: "Content not found." });
  const parsed = VideoSpecSchema.safeParse(spec);
  if (!parsed.success) throw new AppError({ code: "INVALID_SPEC", userMessage: "The VideoSpec is invalid.", details: { issues: parsed.error.issues.slice(0, 10) } });
  if (parsed.data.workspaceId !== content.workspaceId || parsed.data.contentId !== content.id) throw new AppError({ code: "INVALID_SPEC", userMessage: "VideoSpec ids do not match this content." });
  const specId = randomUUID();
  const next = { ...parsed.data, id: specId, metadata: { ...parsed.data.metadata, generator: "human" as const, createdAt: now().toISOString() } };
  const [{ v } = { v: 0 }] = await db().select({ v: sql<number>`coalesce(max(${videoSpecs.version}), 0)` }).from(videoSpecs).where(eq(videoSpecs.contentId, contentId));
  await db().insert(videoSpecs).values({ id: specId, workspaceId: content.workspaceId, contentId, version: Number(v) + 1, schemaVersion: next.schemaVersion, spec: next, createdBy: "HUMAN" });
  await db().update(contents).set({ currentSpecId: specId, hook: next.hook.text, templateId: next.templateId, durationSec: next.duration, title: next.title }).where(eq(contents.id, contentId));
  if (["READY", "RENDERED", "FAILED", "SCHEDULED", "READY_TO_RENDER"].includes(content.status)) {
    await db().update(contents).set({ status: "READY_TO_RENDER" }).where(eq(contents.id, contentId));
    await emitEvent({ type: "RENDER_REQUESTED", workspaceId: content.workspaceId, idempotencyKey: `render_requested:${specId}`, payload: { contentId } }, db(), "HUMAN");
  }
  await recordActivity({ workspaceId: content.workspaceId, type: "SPEC_EDITED", title: `VideoSpec of Content #${content.number} edited`, actorType: "USER", actorId: userId, entityType: "content", entityId: contentId });
  return specId;
}

/** "Regenerate Hook": small AI call that rewrites only the opening. */
export async function regenerateContentHook(contentId: string, userId: string): Promise<string> {
  const [content] = await db().select().from(contents).where(eq(contents.id, contentId)).limit(1);
  const [ws] = content ? await db().select().from(workspaces).where(eq(workspaces.id, content.workspaceId)).limit(1) : [];
  const cur = await currentSpec(contentId);
  if (!content || !ws || !cur) throw new AppError({ code: "NOT_FOUND", userMessage: "Content has no VideoSpec yet." });
  const business = await loadBusinessContext(ws);
  const ai = await resolveAI(ws, "creative");
  const history = await recentFingerprints(ws, contentId);
  const res = await regenerateHook(ai.runtime, business, cur.spec, history.map((h) => h.hook), `${contentId}:${Date.now()}`);
  await recordAgentRun({ workspaceId: ws.id, jobId: null, isDemo: ai.isMock, result: res });
  const r = res.result.data;
  const spec: VideoSpec = {
    ...cur.spec,
    hook: { text: r.hookText, type: r.hookType },
    scenes: cur.spec.scenes.map((s, i) => (i === 0 ? { ...s, headline: r.headline, body: r.body ?? s.body, emphasis: undefined } : s)),
    captions: cur.spec.captions,
    metadata: { ...cur.spec.metadata, hookType: r.hookType },
  };
  return saveEditedSpec(contentId, spec, userId);
}

/** Simulated render (DEMO without a worker): marks the render SIMULATED; preview uses the Remotion Player. */
export async function simulateRender(contentId: string): Promise<void> {
  const cur = await currentSpec(contentId);
  const [content] = await db().select().from(contents).where(eq(contents.id, contentId)).limit(1);
  if (!cur || !content) return;
  await db().insert(videoRenders).values({
    workspaceId: content.workspaceId,
    contentId,
    videoSpecId: cur.id,
    status: "SIMULATED",
    workerId: "simulation",
    durationMs: Math.round(cur.spec.duration * 1000),
    width: cur.spec.width,
    height: cur.spec.height,
    fps: cur.spec.fps,
    videoCodec: "h264",
    audioCodec: "aac",
    hasAudio: true,
    validation: { simulated: true },
    completedAt: now(),
    startedAt: now(),
  });
  if (content.status === "READY_TO_RENDER" || content.status === "RENDERING") {
    if (content.status === "READY_TO_RENDER") await setContentStatus(contentId, "RENDERING");
    await setContentStatus(contentId, "RENDERED");
    await setContentStatus(contentId, "READY", { qaStatus: "WARNINGS" });
  }
}
