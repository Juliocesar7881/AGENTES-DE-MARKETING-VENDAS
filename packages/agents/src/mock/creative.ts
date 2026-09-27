import {
  TEMPLATE_CATALOG,
  type AnimationKind,
  type ContentBrief,
  type CreativeOutput,
  type LayoutKind,
  type Scene,
  type SceneType,
  type TransitionKind,
} from "@revenueos/shared";
import type { BusinessContext, ProductContext } from "../context";
import { clip, lowerFirst, pick, rng, upperFirst } from "./rng";

const TRANSITION_BY_TEMPLATE: Record<string, TransitionKind> = {
  "saas-modern": "slide-up",
  "problem-solution": "wipe",
  "fast-hook": "zoom",
  "feature-showcase": "slide-left",
  "product-demo": "fade",
  "app-showcase": "slide-up",
  "before-after": "wipe",
  testimonial: "fade",
  "social-proof": "slide-up",
  storytelling: "blur",
  listicle: "slide-left",
  "premium-minimal": "fade",
  "bold-typography": "zoom",
  "dashboard-showcase": "slide-up",
  "promotional-offer": "zoom",
};

function hashtagify(words: string[]): string[] {
  return [
    ...new Set(
      words
        .map((w) =>
          w
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^a-zA-Z0-9]/g, "")
            .toLowerCase(),
        )
        .filter((w) => w.length > 2 && w.length < 30),
    ),
  ].map((w) => `#${w}`);
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

/** Replaces scene types that would require data the business did not provide (stats, testimonials). */
function safeSceneTypes(types: SceneType[], product: ProductContext | undefined): SceneType[] {
  return types.map((t) => {
    if (t === "STAT") return product && product.priceCents > 0 ? "OFFER" : "FEATURE";
    if (t === "TESTIMONIAL" || t === "SOCIAL_PROOF") return product?.faq.length ? "QUOTE" : "FEATURE";
    return t;
  });
}

/** Deterministic Creative Agent used by DEMO workspaces and tests. Produces a schema-valid draft. */
export function mockCreative(ctx: BusinessContext, brief: ContentBrief, seed: string, opts: { avoidHooks?: string[] } = {}): CreativeOutput {
  const r = rng(seed);
  const product = ctx.products.find((p) => p.id === brief.productId) ?? ctx.products[0];
  const template = TEMPLATE_CATALOG.find((t) => t.id === brief.templateId) ?? TEMPLATE_CATALOG[0]!;
  const benefits = product?.benefits.length ? product.benefits : ctx.audience.goals.length ? ctx.audience.goals : [brief.keyMessage];
  const features = product?.features.length ? product.features : benefits;
  const problems = ctx.audience.problems.length ? ctx.audience.problems : [brief.angle];
  const screenshot = ctx.assets.find((a) => a.kind === "SCREENSHOT" || a.kind === "MOCKUP");
  const photo = ctx.assets.find((a) => a.kind === "PHOTO" || a.kind === "PRODUCT_SHOT");
  const logo = ctx.assets.find((a) => a.kind === "LOGO");
  const types = safeSceneTypes(template.defaultSceneTypes, product);
  if (types[types.length - 1] !== "CTA") types.push("CTA");
  const duration = Math.round(Math.max(8, Math.min(40, brief.durationSec)));
  const hookDur = 2.2;
  const ctaDur = 3;
  const middle = types.length - 2;
  const middleDur = Math.max(1.4, (duration - hookDur - ctaDur) / Math.max(1, middle));
  const bg = [ctx.brand.primaryColor, ctx.brand.secondaryColor];
  let featureIdx = 0;
  let quoteIdx = 0;
  let hook = brief.hook;
  if (opts.avoidHooks?.includes(hook)) hook = `${upperFirst(lowerFirst(brief.keyMessage))}`;
  const usedAssets = new Set<string>();

  const scenes: Scene[] = types.map((type, i) => {
    const dur = i === 0 ? hookDur : i === types.length - 1 ? ctaDur : middleDur;
    const base = {
      id: `s${i + 1}`,
      start: 0,
      duration: Math.round(dur * 100) / 100,
      type,
      animation: "fade-up" as AnimationKind,
      layout: "center" as LayoutKind,
      background: { type: "gradient" as const, colors: bg },
    };
    switch (type) {
      case "HOOK":
        return { ...base, headline: clip(hook, 90), animation: pick(r, ["kinetic", "pop", "mask-reveal"] as AnimationKind[]), effects: ["spotlight" as const], emphasis: [clip(hook.split(" ").slice(-2).join(" "), 40)] };
      case "PROBLEM":
        return { ...base, headline: clip(upperFirst(problems[0]!), 90), body: clip(`Se isso acontece com você, não é falta de esforço.`, 220), background: { type: "solid" as const, colors: [ctx.brand.backgroundColor] }, animation: "slide-left" as AnimationKind };
      case "AGITATION":
        return { ...base, headline: "E isso custa caro", body: clip(`Tempo, dinheiro e tranquilidade. ${upperFirst(problems[1] ?? problems[0]!)}.`, 220), background: { type: "noise" as const, colors: [ctx.brand.backgroundColor] }, effects: ["grain" as const] };
      case "SOLUTION": {
        const asset = screenshot ?? photo;
        if (asset) usedAssets.add(asset.id);
        return { ...base, headline: clip(product?.name ?? ctx.workspace.name, 90), body: clip(brief.keyMessage, 220), layout: (asset ? (asset.kind === "SCREENSHOT" ? "phone" : "split") : "center") as LayoutKind, assets: asset ? [asset.id] : undefined, animation: "scale-in" as AnimationKind, effects: ["glow" as const] };
      }
      case "FEATURE": {
        const b = benefits[featureIdx % benefits.length]!;
        const f = features[featureIdx % features.length]!;
        featureIdx++;
        return { ...base, headline: clip(upperFirst(b), 90), body: clip(f === b ? `Pensado para ${lowerFirst(ctx.audience.targetAudience || "você")}.` : upperFirst(f), 220), layout: "card-stack" as LayoutKind, animation: "pop" as AnimationKind };
      }
      case "DEMO":
        if (screenshot) usedAssets.add(screenshot.id);
        return { ...base, headline: "Veja como funciona", body: clip(features[0] ?? brief.keyMessage, 220), layout: (screenshot ? "browser" : "phone") as LayoutKind, assets: screenshot ? [screenshot.id] : undefined, animation: "slide-right" as AnimationKind };
      case "NOTIFICATION":
        return { ...base, headline: clip(`Tudo pelo celular`, 90), notification: { app: clip(ctx.brand.businessName, 30), title: "Nova mensagem", body: clip(`Quero saber mais sobre ${product?.name ?? "vocês"}!`, 120) }, layout: "phone" as LayoutKind, animation: "pop" as AnimationKind };
      case "DASHBOARD":
        return { ...base, headline: clip(upperFirst(benefits[0]!), 90), chart: { type: "bar" as const, values: [3, 5, 4, 7, 6, 9], labels: ["S1", "S2", "S3", "S4", "S5", "S6"] }, layout: "dashboard" as LayoutKind, animation: "fade-up" as AnimationKind };
      case "LIST_ITEM": {
        const n = featureIdx++;
        return { ...base, headline: clip(`${n + 1}. ${upperFirst(benefits[n % benefits.length]!)}`, 90), body: clip(upperFirst(features[n % features.length]!), 220), layout: "top" as LayoutKind, animation: "slide-left" as AnimationKind };
      }
      case "BEFORE_AFTER":
        return {
          ...base,
          headline: "A diferença é clara",
          beforeAfter: { beforeLabel: "Antes", afterLabel: "Depois", beforeText: clip(upperFirst(problems[0]!), 120), afterText: clip(upperFirst(benefits[0]!), 120), beforeAssetId: null, afterAssetId: photo?.id ?? null },
          layout: "split" as LayoutKind,
          animation: "none" as AnimationKind,
        };
      case "STORY":
        return { ...base, headline: clip(i === 1 ? `Tudo começou com ${lowerFirst(problems[0]!)}` : `Até encontrar ${product?.name ?? ctx.workspace.name}`, 90), body: clip(brief.keyMessage, 220), background: { type: "spotlight" as const, colors: bg }, animation: "blur-in" as AnimationKind };
      case "QUOTE": {
        const qi = quoteIdx++;
        const faq = product?.faq[qi];
        const fallback = qi === 0 ? ctx.audience.valueProposition || brief.keyMessage : upperFirst(benefits[qi % benefits.length]!);
        return { ...base, headline: clip(faq ? faq.q : fallback, 90), body: clip(faq ? faq.a : qi === 0 ? ctx.brand.businessName : features[qi % features.length]!, 220), animation: "fade-up" as AnimationKind, background: { type: "solid" as const, colors: [ctx.brand.backgroundColor] } };
      }
      case "OFFER":
        return {
          ...base,
          headline: clip(product?.offer || `Condição especial`, 90),
          stat: product && product.priceCents > 0 ? { value: product.priceCents / 100, prefix: "R$ ", label: clip(product.name, 60), decimals: product.priceCents % 100 === 0 ? 0 : 2 } : undefined,
          body: product ? clip(`${product.name} por ${money(product.priceCents, product.currency)}`, 220) : undefined,
          effects: ["confetti" as const],
          animation: "pop" as AnimationKind,
        };
      case "LOGO":
        if (logo) usedAssets.add(logo.id);
        return { ...base, headline: clip(ctx.brand.businessName, 90), assets: logo ? [logo.id] : undefined, animation: "scale-in" as AnimationKind };
      case "CTA":
      default:
        return { ...base, type: "CTA" as const, headline: clip(brief.cta, 90), body: clip(ctx.brand.handle ? `@${ctx.brand.handle.replace(/^@/, "")}` : ctx.brand.businessName, 220), animation: "pop" as AnimationKind, effects: ["glow" as const] };
    }
  });

  let cursor = 0;
  for (const s of scenes) {
    s.start = Math.round(cursor * 100) / 100;
    cursor += s.duration;
  }
  const total = Math.round(cursor * 100) / 100;
  const captions = scenes
    .filter((s) => s.headline)
    .map((s) => ({ start: s.start + 0.1, end: Math.min(total, s.start + s.duration - 0.05), text: clip(s.headline!, 60) }));
  const transition = TRANSITION_BY_TEMPLATE[template.id] ?? "fade";
  const transitions = scenes.slice(0, -1).map((_, i) => ({ afterScene: i, type: transition, durationSec: 0.35 }));
  const keywords = [...ctx.brand.keywords, ...ctx.workspace.industry.split(/\s+/), ctx.brand.businessName.replace(/\s+/g, "")];
  const tags = hashtagify(keywords).slice(0, 10);
  const cta = brief.cta;
  const productName = product?.name ?? ctx.workspace.name;

  return {
    video: {
      title: clip(brief.title, 120),
      objective: brief.objective,
      targetAudience: clip(ctx.audience.targetAudience || ctx.brand.targetAudience || "público geral", 300),
      templateId: brief.templateId,
      format: brief.format,
      duration: total,
      hook: { text: clip(hook, 110), type: brief.hookType },
      scenes,
      captions,
      transitions,
      soundtrackMood: "none",
      usedAssetIds: [...usedAssets],
      cta: { text: clip(cta, 60), subtext: ctx.brand.handle ? clip(`@${ctx.brand.handle.replace(/^@/, "")}`, 100) : undefined, buttonLabel: clip(brief.ctaType === "WHATSAPP" ? "Chamar no WhatsApp" : brief.ctaType === "BOOK" ? "Agendar agora" : "Saiba mais", 30), type: brief.ctaType },
      angle: clip(brief.angle, 120),
      captionStyle: "block",
    },
    script: clip(scenes.map((s) => [s.headline, s.body].filter(Boolean).join(". ")).join("\n"), 4000),
    copy: {
      instagram: { caption: clip(`${hook}\n\n${brief.keyMessage}\n\n👉 ${cta}`, 2000), hashtags: tags.slice(0, 10) },
      tiktok: { caption: clip(`${hook} ${cta}`, 2000), hashtags: tags.slice(0, 5) },
      youtube: {
        title: clip(`${hook}`, 70),
        description: clip(`${brief.keyMessage}\n\n${productName}: ${cta}.`, 4500),
        tags: tags.map((t) => t.slice(1)).slice(0, 10),
      },
      facebook: { caption: clip(`${brief.keyMessage} ${cta}!`, 2000) },
    },
    selfCheck: { hookUnder2s: true, brandRespected: true, forbiddenWordsAvoided: true, notes: "Gerado pelo modo DEMO (sem chamada ao Claude)." },
  };
}
