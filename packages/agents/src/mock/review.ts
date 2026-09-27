import type { PerformanceReviewOutput, WeeklyStrategyOutput, WebsiteInsightsOutput } from "@revenueos/shared";
import type { BusinessContext, PerformanceContext } from "../context";
import { clip } from "./rng";

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

export function mockPerformanceReview(ctx: BusinessContext, perf: PerformanceContext): PerformanceReviewOutput {
  const byRevenue = [...perf.recentContents].sort((a, b) => b.revenueCents - a.revenueCents || b.leads - a.leads);
  const byViews = [...perf.recentContents].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const best = byRevenue[0];
  const viral = byViews[0];
  const insights: PerformanceReviewOutput["insights"] = [];
  if (best && best.revenueCents > 0) {
    insights.push({
      title: clip(`Melhor resultado comercial: "${best.hook ?? best.title}"`, 140),
      finding: clip(`Gerou ${best.leads} leads, ${best.sales} vendas e ${money(best.revenueCents, ctx.workspace.currency)} em receita atribuída com ${best.views ?? "n/d"} visualizações.`, 600),
      evidence: clip(`Template ${best.templateId}, gancho ${best.hookType}, CTA ${best.ctaType}. Atribuição observacional.`, 600),
      recommendation: "Criar variações mantendo o tipo de gancho e o CTA, mudando o ângulo.",
    });
  }
  if (viral && best && viral.id !== best.id && (viral.views ?? 0) > (best.views ?? 0)) {
    insights.push({
      title: "Alcance não é receita",
      finding: clip(`O conteúdo mais visto ("${viral.hook ?? viral.title}") teve ${viral.views} visualizações mas ${money(viral.revenueCents, ctx.workspace.currency)} em receita atribuída.`, 600),
      evidence: "Comparação direta de receita atribuída por conteúdo no período.",
      recommendation: "Priorizar o padrão com maior receita por mil visualizações, não o mais viral.",
    });
  }
  for (const i of perf.insights.filter((x) => x.confidence !== "LOW_DATA").slice(0, 4)) {
    insights.push({ title: clip(`${i.dimension}: ${i.key}`, 140), finding: clip(i.summary, 600), evidence: `Confiança: ${i.confidence} (regra transparente).`, recommendation: "Usar como padrão preferido nos próximos planos." });
  }
  if (insights.length === 0) {
    insights.push({ title: "Dados insuficientes", finding: "Ainda não há volume para conclusões (LOW_DATA).", evidence: `${perf.totals.contents} conteúdos no período.`, recommendation: "Manter testes exploratórios de ganchos e templates." });
  }
  return {
    headline: clip(`${perf.totals.sales} vendas e ${money(perf.totals.revenueCents, ctx.workspace.currency)} atribuídos em ${perf.periodDays} dias`, 300),
    insights: insights.slice(0, 8),
    memories: [
      ...(best && best.revenueCents > 0 ? [{ category: "PERFORMANCE" as const, content: clip(`Gancho vencedor (receita): "${best.hook}" [${best.hookType}, ${best.templateId}]`, 500) }] : []),
      ...(viral && viral.revenueCents === 0 && (viral.views ?? 0) > 0 ? [{ category: "CONTENT" as const, content: clip(`Alto alcance sem vendas: "${viral.hook}" — evitar repetir sem ajuste de CTA`, 500) }] : []),
    ],
    nextFocus: ["Receita por mil visualizações", "Leads qualificados por conteúdo", "Testar 1 variável por vez"],
  };
}

export function mockWeeklyStrategy(ctx: BusinessContext, perf: PerformanceContext): WeeklyStrategyOutput {
  const product = ctx.products[0];
  return {
    summary: clip(
      `Semana focada em converter conversas em vendas para ${ctx.workspace.name}. ${perf.totals.leads} leads e ${perf.totals.sales} vendas atribuídas nos últimos ${perf.periodDays} dias.`,
      1500,
    ),
    priorities: ["Manter 2 publicações/dia com buffer de 4", `Empurrar ${product?.name ?? "o produto principal"} com CTA direto para conversa`, "Responder leads em menos de 5 minutos"],
    contentThemes: [...ctx.audience.problems.slice(0, 2), ...(product?.benefits.slice(0, 2) ?? [])].map((t) => clip(t, 200)),
    experiments: [{ variable: "CTA", hypothesis: "CTA para WhatsApp gera mais leads qualificados que link na bio" }],
    risks: perf.totals.contents < 10 ? ["Pouco histórico — decisões ainda exploratórias"] : ["Fadiga criativa se os ganchos se repetirem"],
  };
}

export function mockWebsiteInsights(input: { title: string; description: string; headings: string[]; url: string }): WebsiteInsightsOutput {
  return {
    businessName: clip(input.title.split(/[|\-–]/)[0]?.trim() ?? "", 100),
    industry: "",
    description: clip(input.description, 800),
    targetAudience: "",
    problems: [],
    goals: [],
    products: input.headings.slice(0, 4).map((h) => ({ name: clip(h, 100), description: "", priceText: null })),
    tone: "",
    keywords: [],
  };
}
