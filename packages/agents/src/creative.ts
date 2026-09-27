import { z } from "zod";
import {
  CreativeOutputSchema,
  FORMAT_DIMENSIONS,
  HOOK_TYPES,
  normalizeVideoSpecTiming,
  VIDEO_SPEC_VERSION,
  VideoSpecSchema,
  type AssetRef,
  type ContentBrief,
  type CreativeOutput,
  type CreativeVideoDraft,
  type VideoSpec,
} from "@revenueos/shared";
import { renderAssets, renderBusinessBlock, renderTemplateCatalog, type BusinessContext } from "./context";
import { mockCreative } from "./mock/creative";
import { clip } from "./mock/rng";
import { CREATIVE_PROMPT_VERSION, CREATIVE_SYSTEM, CREATIVE_VARIATION_INSTRUCTIONS, HOOK_REGENERATION_INSTRUCTIONS } from "./prompts/creative.v1";
import { findForbidden, runAgent, type AgentResult, type AgentRuntime } from "./runtime";

export interface CreativeOptions {
  seed: string;
  avoidHooks: string[];
  maxDurationSec: number;
  /** Feedback from QA / similarity checks when regenerating. */
  feedback?: string | null;
}

function draftTexts(d: CreativeVideoDraft): string[] {
  return [
    d.title,
    d.hook.text,
    d.cta.text,
    d.cta.subtext,
    ...d.scenes.flatMap((s) => [s.headline, s.body, ...(s.bullets ?? []), s.testimonial?.quote, s.notification?.body]),
    ...d.captions.map((c) => c.text),
  ].filter((t): t is string => Boolean(t));
}

export function validateCreative(out: CreativeOutput, ctx: BusinessContext, maxDurationSec: number): string[] {
  const problems: string[] = [];
  const assetIds = new Set(ctx.assets.map((a) => a.id));
  const v = out.video;
  for (const id of v.usedAssetIds) if (!assetIds.has(id)) problems.push(`usedAssetIds contains unknown asset ${id}`);
  v.scenes.forEach((s, i) => {
    for (const ref of [...(s.assets ?? []), s.background.assetId, s.beforeAfter?.beforeAssetId, s.beforeAfter?.afterAssetId]) {
      if (ref && !assetIds.has(ref)) problems.push(`scenes.${i} references unknown asset ${ref}`);
    }
  });
  if (v.duration > maxDurationSec) problems.push(`duration must be ≤ ${maxDurationSec}s for the target platforms`);
  const last = v.scenes[v.scenes.length - 1];
  if (last && last.type !== "CTA" && last.type !== "OFFER") problems.push("the last scene must be type CTA (or OFFER)");
  const forbidden = findForbidden([...draftTexts(v), out.copy.instagram.caption, out.copy.tiktok.caption, out.copy.youtube.title, out.copy.youtube.description, out.copy.facebook.caption], ctx.brand.forbiddenWords);
  if (forbidden.length) problems.push(`forbidden brand words used: ${forbidden.join(", ")}`);
  return problems;
}

function creativeSystem(ctx: BusinessContext) {
  return [
    { text: CREATIVE_SYSTEM },
    { text: `${renderTemplateCatalog()}\n\n${renderBusinessBlock(ctx)}\n\n${renderAssets(ctx.assets)}`, cache: true },
  ];
}

/** Creative: turns one brief into a VideoSpec draft + per-platform copy in ONE structured call. */
export function generateCreative(rt: AgentRuntime, ctx: BusinessContext, brief: ContentBrief, opts: CreativeOptions): Promise<AgentResult<CreativeOutput>> {
  return runAgent(rt, {
    agent: "CREATIVE",
    task: "creative.generate",
    promptVersion: CREATIVE_PROMPT_VERSION,
    system: creativeSystem(ctx),
    messages: [
      {
        role: "user",
        content: [
          `# Brief`,
          JSON.stringify(brief, null, 2),
          `# Constraints`,
          `Format ${brief.format} (${FORMAT_DIMENSIONS[brief.format].width}x${FORMAT_DIMENSIONS[brief.format].height}). Max duration ${opts.maxDurationSec}s. Target around ${brief.durationSec}s.`,
          opts.avoidHooks.length ? `Avoid these recent hooks (do not reuse or paraphrase closely):\n${opts.avoidHooks.slice(0, 20).map((h) => `- ${h}`).join("\n")}` : "",
          opts.feedback ? `# Feedback from quality checks — fix these:\n${opts.feedback}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: CreativeOutputSchema,
    schemaName: "creative_output",
    inputSummary: `brief "${clip(brief.hook, 60)}" template ${brief.templateId}`,
    validate: (v) => validateCreative(v, ctx, opts.maxDurationSec),
    mock: () => mockCreative(ctx, brief, opts.seed, { avoidHooks: opts.avoidHooks }),
  });
}

export function generateVariation(
  rt: AgentRuntime,
  ctx: BusinessContext,
  source: { brief: ContentBrief; spec: VideoSpec; script: string | null },
  opts: CreativeOptions & { preserve: string[]; change: string[]; label: string },
): Promise<AgentResult<CreativeOutput>> {
  return runAgent(rt, {
    agent: "CREATIVE",
    task: "creative.variation",
    promptVersion: CREATIVE_PROMPT_VERSION,
    system: creativeSystem(ctx),
    messages: [
      {
        role: "user",
        content: [
          CREATIVE_VARIATION_INSTRUCTIONS,
          `Variant label: ${opts.label}`,
          `Preserve: ${opts.preserve.join(", ") || "hook pattern, CTA"}`,
          `Change: ${opts.change.join(", ") || "angle, wording, visuals"}`,
          `# Original brief\n${JSON.stringify(source.brief, null, 2)}`,
          `# Original VideoSpec (winning)\n${JSON.stringify({ hook: source.spec.hook, templateId: source.spec.templateId, scenes: source.spec.scenes.map((s) => ({ type: s.type, headline: s.headline, body: s.body, layout: s.layout })), cta: source.spec.cta }, null, 2)}`,
          `Max duration ${opts.maxDurationSec}s.`,
          opts.avoidHooks.length ? `Avoid these exact hooks:\n${opts.avoidHooks.slice(0, 20).map((h) => `- ${h}`).join("\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: CreativeOutputSchema,
    schemaName: "creative_output",
    inputSummary: `variation ${opts.label} of "${clip(source.spec.hook.text, 50)}"`,
    validate: (v) => validateCreative(v, ctx, opts.maxDurationSec),
    mock: () => {
      const variantBrief: ContentBrief = {
        ...source.brief,
        hook: opts.preserve.includes("hook") ? source.brief.hook : clip(`${source.brief.keyMessage}`, 110),
        angle: opts.change.includes("angle") ? clip(`Variação ${opts.label}: ${source.brief.angle}`, 160) : source.brief.angle,
        title: clip(`${source.brief.title} (${opts.label})`, 120),
      };
      return mockCreative(ctx, variantBrief, `${opts.seed}:${opts.label}`, { avoidHooks: opts.avoidHooks });
    },
  });
}

export const HookRewriteSchema = z.object({
  hookText: z.string().min(3).max(110),
  hookType: z.enum(HOOK_TYPES),
  headline: z.string().min(1).max(90),
  body: z.string().max(220).optional(),
});
export type HookRewrite = z.infer<typeof HookRewriteSchema>;

export function regenerateHook(rt: AgentRuntime, ctx: BusinessContext, spec: VideoSpec, avoid: string[], seed: string): Promise<AgentResult<HookRewrite>> {
  return runAgent(rt, {
    agent: "CREATIVE",
    task: "creative.regenerate_hook",
    promptVersion: CREATIVE_PROMPT_VERSION,
    system: creativeSystem(ctx),
    messages: [
      {
        role: "user",
        content: `${HOOK_REGENERATION_INSTRUCTIONS}\n\nCurrent hook: ${spec.hook.text} (${spec.hook.type})\nAngle: ${spec.metadata.angle ?? ""}\nCTA: ${spec.cta.text}\nAvoid:\n${[spec.hook.text, ...avoid].map((h) => `- ${h}`).join("\n")}`,
      },
    ],
    schema: HookRewriteSchema,
    schemaName: "hook_rewrite",
    inputSummary: `rewrite hook "${clip(spec.hook.text, 50)}"`,
    validate: (v) => {
      const f = findForbidden([v.hookText, v.headline, v.body], ctx.brand.forbiddenWords);
      return f.length ? [`forbidden words: ${f.join(", ")}`] : [];
    },
    mock: () => {
      const r = seed.length % 3;
      const product = ctx.products[0]?.name ?? ctx.workspace.name;
      const options = [`Ninguém te contou isso sobre ${product}`, `Antes de escolher, veja isto`, `O detalhe que muda tudo em ${ctx.workspace.industry || product}`];
      const hookText = clip(options.find((o) => o !== spec.hook.text && !avoid.includes(o)) ?? options[r]!, 110);
      return { hookText, hookType: "CURIOSITY" as const, headline: clip(hookText, 90) };
    },
  });
}

/**
 * Assembles the final VideoSpec: ids, brand snapshot, dimensions and asset refs
 * come from code (never from the model); timing drift is repaired
 * deterministically; the result is validated against the full VideoSpec schema.
 */
export function buildVideoSpec(
  draft: CreativeVideoDraft,
  ctx: BusinessContext,
  ids: { specId: string; contentId: string; campaignId: string | null },
  meta: { generator: "agent" | "human" | "mock"; promptVersion: string; model?: string; experiment?: VideoSpec["metadata"]["experiment"] },
): VideoSpec {
  const dims = FORMAT_DIMENSIONS[draft.format];
  const referenced = new Set<string>([...draft.usedAssetIds]);
  for (const s of draft.scenes) {
    for (const ref of [...(s.assets ?? []), s.background.assetId, s.beforeAfter?.beforeAssetId, s.beforeAfter?.afterAssetId]) if (ref) referenced.add(ref);
  }
  if (ctx.brand.logoAssetId) referenced.add(ctx.brand.logoAssetId);
  const assets: AssetRef[] = ctx.assets.filter((a) => referenced.has(a.id)).map((a) => ({ id: a.id, kind: a.kind, url: null, alt: a.description.slice(0, 200) }));
  const assetIds = new Set(assets.map((a) => a.id));
  const timed = normalizeVideoSpecTiming({ ...draft, duration: Math.round(draft.duration * 100) / 100 });
  const spec = {
    schemaVersion: VIDEO_SPEC_VERSION,
    id: ids.specId,
    workspaceId: ctx.workspace.id,
    contentId: ids.contentId,
    campaignId: ids.campaignId,
    title: draft.title,
    objective: draft.objective,
    targetAudience: draft.targetAudience,
    templateId: draft.templateId,
    format: draft.format,
    width: dims.width,
    height: dims.height,
    fps: 30,
    duration: timed.duration,
    hook: draft.hook,
    scenes: timed.scenes.map((s) => ({
      ...s,
      assets: s.assets?.filter((a) => assetIds.has(a)),
      background: { ...s.background, assetId: s.background.assetId && assetIds.has(s.background.assetId) ? s.background.assetId : null },
    })),
    captions: timed.captions,
    transitions: timed.transitions,
    soundtrack: draft.soundtrackMood !== "none" ? { assetId: null, mood: draft.soundtrackMood, volume: 0.3, generated: true } : null,
    assets,
    brand: {
      name: ctx.brand.businessName,
      logoAssetId: ctx.brand.logoAssetId && assetIds.has(ctx.brand.logoAssetId) ? ctx.brand.logoAssetId : null,
      primaryColor: ctx.brand.primaryColor,
      secondaryColor: ctx.brand.secondaryColor,
      accentColor: ctx.brand.accentColor,
      backgroundColor: ctx.brand.backgroundColor,
      textColor: ctx.brand.textColor,
      fontHeading: ctx.brand.fontHeading,
      fontBody: ctx.brand.fontBody,
      handle: ctx.brand.handle ?? undefined,
      website: ctx.brand.website ?? undefined,
    },
    cta: draft.cta,
    metadata: {
      generator: meta.generator,
      promptVersion: meta.promptVersion,
      model: meta.model,
      createdAt: new Date().toISOString(),
      angle: draft.angle,
      hookType: draft.hook.type,
      ctaType: draft.cta.type,
      language: ctx.workspace.locale,
      captionStyle: draft.captionStyle,
      experiment: meta.experiment,
    },
  };
  return VideoSpecSchema.parse(spec);
}
