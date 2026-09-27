import {
  normalizeText,
  TEMPLATE_IDS,
  type ContentBrief,
  type CtaType,
  type HookType,
  type StrategyPlanOutput,
  type TemplateId,
} from "@revenueos/shared";
import type { BusinessContext, PerformanceContext, ProductContext } from "../context";
import { clip, lowerFirst, pick, rng, shuffle } from "./rng";

const HOOK_TEMPLATE: Partial<Record<HookType, TemplateId[]>> = {
  PAIN: ["problem-solution", "bold-typography", "before-after"],
  QUESTION: ["saas-modern", "feature-showcase", "fast-hook"],
  BOLD_CLAIM: ["bold-typography", "premium-minimal", "fast-hook"],
  CURIOSITY: ["listicle", "fast-hook", "storytelling"],
  CONTRARIAN: ["bold-typography", "listicle"],
  STORY: ["storytelling", "testimonial", "premium-minimal"],
  OFFER: ["promotional-offer", "fast-hook"],
  DEMO: ["product-demo", "app-showcase", "dashboard-showcase", "feature-showcase"],
};

export function mockHook(type: HookType, p: { product: string; problem: string; benefit: string; topic: string; offer: string; audience: string }, variant: number): string {
  const v = variant % 3;
  switch (type) {
    case "PAIN":
      return [`Chega de ${lowerFirst(p.problem)}`, `Cansado de ${lowerFirst(p.problem)}?`, `${p.problem}? Isso tem solução`][v]!;
    case "QUESTION":
      return [`Já pensou em ${lowerFirst(p.benefit)}?`, `Quer ${lowerFirst(p.benefit)} de verdade?`, `E se ${lowerFirst(p.benefit)} fosse simples?`][v]!;
    case "BOLD_CLAIM":
      return [`${p.product}: ${lowerFirst(p.benefit)}`, `${p.benefit}, do jeito certo`, `${p.benefit}. Sem complicação.`][v]!;
    case "CURIOSITY":
      return [`O que ninguém te conta sobre ${p.topic}`, `3 coisas que mudam tudo em ${p.topic}`, `O erro mais comum em ${p.topic}`][v]!;
    case "CONTRARIAN":
      return [`Pare de escolher ${p.topic} só pelo preço`, `Você não precisa gastar mais com ${p.topic}`, `Esqueça o que te disseram sobre ${p.topic}`][v]!;
    case "STORY":
      return [`Foi assim que ${p.audience} resolveram isso`, `Um dia comum até ${lowerFirst(p.problem)}`, `A história por trás de ${p.product}`][v]!;
    case "OFFER":
      return [p.offer || `Condição especial em ${p.product}`, `Oferta desta semana: ${p.product}`, `${p.product} com condição especial`][v]!;
    case "DEMO":
      return [`Veja ${p.product} em 15 segundos`, `Como funciona ${p.product} na prática`, `${p.product} por dentro`][v]!;
    default:
      return `${p.product}: ${lowerFirst(p.benefit)}`;
  }
}

function productFacts(ctx: BusinessContext, product: ProductContext | undefined) {
  const problems = ctx.audience.problems.length ? ctx.audience.problems : [`perder tempo com ${ctx.workspace.industry}`];
  const benefits = product?.benefits.length ? product.benefits : ctx.audience.goals.length ? ctx.audience.goals : ["resolver isso de forma simples"];
  return { problems, benefits };
}

function preferredCta(ctx: BusinessContext): { type: CtaType; text: string } {
  const pref = ctx.brand.ctaPreferences[0];
  if (ctx.workspace.whatsappNumber) return { type: "WHATSAPP", text: pref ?? "Chame no WhatsApp" };
  return { type: "DM", text: pref ?? "Mande uma mensagem" };
}

/** Deterministic Strategist used by DEMO workspaces and tests. Mirrors the real agent's rules. */
export function mockStrategyPlan(ctx: BusinessContext, perf: PerformanceContext, count: number, seed: string): StrategyPlanOutput {
  const r = rng(seed);
  const recentHooks = new Set(perf.recentContents.map((c) => normalizeText(c.hook ?? "")));
  const recentTemplates = perf.recentContents.slice(0, 4).map((c) => c.templateId);
  const strong = perf.insights.filter((i) => i.confidence === "CONSISTENT" || i.confidence === "STRONG_EVIDENCE");
  const winningHook = strong.find((i) => i.dimension === "HOOK_TYPE")?.key as HookType | undefined;
  const winningTemplate = strong.find((i) => i.dimension === "TEMPLATE")?.key as TemplateId | undefined;
  const hookTypes: HookType[] = shuffle(r, ["PAIN", "QUESTION", "BOLD_CLAIM", "CURIOSITY", "CONTRARIAN", "STORY", "OFFER", "DEMO"] as HookType[]);
  const products = ctx.products.length ? ctx.products : [];
  const cta = preferredCta(ctx);
  const topic = ctx.workspace.industry || ctx.workspace.name;
  const topPerformer = [...perf.recentContents].sort((a, b) => b.revenueCents - a.revenueCents || b.leads - a.leads)[0];
  const briefs: ContentBrief[] = [];
  for (let i = 0; i < count; i++) {
    const product = products.length ? products[(i + Math.floor(r() * 7)) % products.length] : undefined;
    const { problems, benefits } = productFacts(ctx, product);
    const exploit = winningHook && i % 3 !== 2;
    const hookType: HookType = exploit ? winningHook : hookTypes[i % hookTypes.length]!;
    const templateCandidates = (winningTemplate && exploit ? [winningTemplate] : (HOOK_TEMPLATE[hookType] ?? [...TEMPLATE_IDS])).filter(
      (t) => !recentTemplates.includes(t),
    );
    const templateId = (templateCandidates.length ? pick(r, templateCandidates) : pick(r, TEMPLATE_IDS)) as TemplateId;
    const facts = {
      product: product?.name ?? ctx.workspace.name,
      problem: pick(r, problems),
      benefit: pick(r, benefits),
      topic,
      offer: product?.offer ?? "",
      audience: ctx.audience.targetAudience ? clip(ctx.audience.targetAudience.split(/[,.]/)[0]!, 40) : "nossos clientes",
    };
    let hook = mockHook(hookType, facts, i + Math.floor(r() * 3));
    for (let k = 1; k < 4 && recentHooks.has(normalizeText(hook)); k++) hook = mockHook(hookType, facts, i + k);
    recentHooks.add(normalizeText(hook));
    const experiment =
      !exploit && i % 3 === 2
        ? { variable: "HOOK" as const, variantLabel: String.fromCharCode(65 + (i % 3)), hypothesis: clip(`Hook do tipo ${hookType} gera mais leads qualificados que o padrão atual`, 300) }
        : null;
    briefs.push({
      title: clip(`${facts.product} — ${hookType.toLowerCase().replace("_", " ")}`, 120),
      objective: i % 2 === 0 ? "LEADS" : "SALES",
      angle: clip(i % 2 === 0 ? `Dor: ${facts.problem}` : `Benefício: ${facts.benefit}`, 160),
      hook: clip(hook, 110),
      hookType,
      templateId,
      format: "9:16",
      targetPlatforms: ctx.workspace.targetPlatforms.length ? ctx.workspace.targetPlatforms.slice(0, 4) : ["MOCK"],
      productId: product?.id ?? null,
      cta: clip(cta.text, 60),
      ctaType: cta.type,
      keyMessage: clip(`${facts.product} ajuda a ${lowerFirst(facts.benefit)} sem ${lowerFirst(facts.problem)}.`, 300),
      rationale: clip(
        exploit
          ? `Reaproveita o padrão ${hookType} com evidência consistente de melhor taxa de leads, mudando ângulo e produto para evitar fadiga.`
          : topPerformer && topPerformer.revenueCents > 0
            ? `Explora uma variação diferente do conteúdo com maior receita atribuída ("${clip(topPerformer.hook ?? topPerformer.title, 50)}"), testando novo gancho.`
            : "Sem dados suficientes ainda: teste exploratório de gancho e template para aprender o que gera leads.",
        500,
      ),
      durationSec: 14 + Math.floor(r() * 12),
      experiment,
    });
  }
  const main = products[0];
  return {
    summary: clip(
      perf.totals.contents > 0
        ? `Foco em vendas e leads qualificados. Nos últimos ${perf.periodDays} dias: ${perf.totals.leads} leads e ${perf.totals.sales} vendas atribuídas. Priorizar os padrões com melhor receita e testar ${briefs.filter((b) => b.experiment).length} novas hipóteses.`
        : `Início da operação: sem histórico. Plano exploratório com ganchos e templates variados para descobrir o que gera leads e vendas para ${ctx.workspace.name}.`,
      1500,
    ),
    campaign: {
      action: perf.campaigns.some((c) => c.status === "ACTIVE") ? "CONTINUE" : "CREATE",
      campaignId: perf.campaigns.find((c) => c.status === "ACTIVE")?.id ?? null,
      name: clip(perf.campaigns.find((c) => c.status === "ACTIVE")?.name ?? `${main?.name ?? ctx.workspace.name} — Aquisição`, 100),
      objective: "SALES",
      angle: clip(ctx.audience.valueProposition || `Resolver ${productFacts(ctx, main).problems[0]}`, 200),
      offer: clip(main?.offer || main?.name || "", 300),
      cta: clip(cta.text, 100),
    },
    briefs,
    dataCaveats: perf.totals.contents < 5 ? ["Poucos conteúdos publicados: conclusões ainda são exploratórias (LOW_DATA)."] : [],
  };
}
