import { formatMoney, TEMPLATE_CATALOG, type AssetKind, type FontFamily, type Platform } from "@revenueos/shared";

/**
 * Plain-data context passed to agents. Core builds it from the database for
 * exactly ONE workspace — agents never receive data from other workspaces.
 */
export interface ProductContext {
  id: string;
  name: string;
  description: string;
  type: string;
  priceCents: number;
  currency: string;
  benefits: string[];
  features: string[];
  faq: { q: string; a: string }[];
  limitations: string[];
  offer: string;
  support: string;
  terms: string;
}

export interface BrandContext {
  businessName: string;
  logoAssetId: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontHeading: FontFamily;
  fontBody: FontFamily;
  tone: string;
  style: string;
  voice: string;
  handle: string | null;
  website: string | null;
  description: string;
  targetAudience: string;
  keywords: string[];
  forbiddenWords: string[];
  ctaPreferences: string[];
}

export interface AssetContext {
  id: string;
  kind: AssetKind;
  description: string;
  width: number | null;
  height: number | null;
}

export interface BusinessContext {
  workspace: {
    id: string;
    name: string;
    industry: string;
    description: string;
    website: string | null;
    locale: string;
    currency: string;
    timezone: string;
    whatsappNumber: string | null;
    targetPlatforms: Platform[];
  };
  brand: BrandContext;
  audience: {
    targetAudience: string;
    problems: string[];
    goals: string[];
    valueProposition: string;
    differentiators: string[];
  };
  products: ProductContext[];
  assets: AssetContext[];
}

export interface ContentPerformance {
  id: string;
  title: string;
  hook: string | null;
  hookType: string | null;
  angle: string | null;
  templateId: string | null;
  ctaType: string | null;
  durationSec: number | null;
  publishedAt: string | null;
  views: number | null;
  leads: number;
  qualifiedLeads: number;
  sales: number;
  revenueCents: number;
}

export interface InsightContext {
  dimension: string;
  key: string;
  metric: string;
  confidence: string;
  summary: string;
}

export interface PerformanceContext {
  periodDays: number;
  totals: { contents: number; views: number; leads: number; qualifiedLeads: number; sales: number; revenueCents: number };
  recentContents: ContentPerformance[];
  insights: InsightContext[];
  memories: { category: string; content: string }[];
  campaigns: { id: string; name: string; objective: string; angle: string; offer: string; status: string }[];
  weeklyStrategy?: string | null;
}

export function languageName(locale: string): string {
  if (locale.startsWith("pt")) return "Brazilian Portuguese (pt-BR)";
  if (locale.startsWith("es")) return "Spanish";
  return "English";
}

/** Stable block (cacheable): business, brand, audience, products. */
export function renderBusinessBlock(ctx: BusinessContext): string {
  const b = ctx.brand;
  const lines = [
    `# Business`,
    `Name: ${ctx.workspace.name}`,
    `Industry: ${ctx.workspace.industry}`,
    `Description: ${ctx.workspace.description || b.description}`,
    ctx.workspace.website ? `Website: ${ctx.workspace.website}` : "",
    `Language for all audience-facing copy: ${languageName(ctx.workspace.locale)}`,
    `Currency: ${ctx.workspace.currency}`,
    ctx.workspace.whatsappNumber ? `Sales channel: WhatsApp` : "",
    ``,
    `# Brand kit`,
    `Tone: ${b.tone}; Style: ${b.style}${b.voice ? `; Voice: ${b.voice}` : ""}`,
    `Colors: primary ${b.primaryColor}, secondary ${b.secondaryColor}, accent ${b.accentColor}, background ${b.backgroundColor}, text ${b.textColor}`,
    `Fonts: heading ${b.fontHeading}, body ${b.fontBody}`,
    b.handle ? `Handle: ${b.handle}` : "",
    b.keywords.length ? `Keywords: ${b.keywords.join(", ")}` : "",
    b.forbiddenWords.length ? `FORBIDDEN words (never use): ${b.forbiddenWords.join(", ")}` : "",
    b.ctaPreferences.length ? `Preferred CTAs: ${b.ctaPreferences.join(" | ")}` : "",
    ``,
    `# Audience`,
    `Target audience: ${ctx.audience.targetAudience || b.targetAudience}`,
    ctx.audience.problems.length ? `Problems: ${ctx.audience.problems.join("; ")}` : "",
    ctx.audience.goals.length ? `Goals: ${ctx.audience.goals.join("; ")}` : "",
    ctx.audience.valueProposition ? `Value proposition: ${ctx.audience.valueProposition}` : "",
    ctx.audience.differentiators.length ? `Differentiators: ${ctx.audience.differentiators.join("; ")}` : "",
    ``,
    `# Products (Product Knowledge)`,
    ...ctx.products.map(renderProduct),
  ];
  return lines.filter((l) => l !== "").join("\n");
}

export function renderProduct(p: ProductContext): string {
  return [
    `## ${p.name} (productId: ${p.id})`,
    `Type: ${p.type}; Price: ${formatMoney(p.priceCents, p.currency)} (${p.priceCents} cents)`,
    `Description: ${p.description}`,
    p.benefits.length ? `Benefits: ${p.benefits.join("; ")}` : "",
    p.features.length ? `Features: ${p.features.join("; ")}` : "",
    p.offer ? `Current offer: ${p.offer}` : "",
    p.limitations.length ? `Limitations: ${p.limitations.join("; ")}` : "",
    p.faq.length ? `FAQ:\n${p.faq.map((f) => `- Q: ${f.q}\n  A: ${f.a}`).join("\n")}` : "",
    p.support ? `Support: ${p.support}` : "",
    p.terms ? `Terms: ${p.terms}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderTemplateCatalog(): string {
  return [
    "# Template catalog (templateId → visual system)",
    ...TEMPLATE_CATALOG.map((t) => `- ${t.id}: ${t.name} — ${t.description} Best for: ${t.bestFor}. Typical scenes: ${t.defaultSceneTypes.join(" → ")}`),
  ].join("\n");
}

export function renderAssets(assets: AssetContext[]): string {
  if (assets.length === 0) return "# Brand assets\nNo uploaded assets. Design with typography, shapes, icons and mockups.";
  return ["# Brand assets (reference by id)", ...assets.map((a) => `- ${a.id} [${a.kind}] ${a.description || "(no description)"}${a.width ? ` ${a.width}x${a.height}` : ""}`)].join("\n");
}

export function renderPerformance(p: PerformanceContext, currency: string): string {
  const money = (c: number) => formatMoney(c, currency);
  const rows = p.recentContents.map(
    (c) =>
      `- [${c.id.slice(0, 8)}] "${c.hook ?? c.title}" | hookType ${c.hookType ?? "?"} | template ${c.templateId ?? "?"} | angle ${c.angle ?? "?"} | CTA ${c.ctaType ?? "?"} | ${c.durationSec ?? "?"}s | views ${c.views ?? "n/a"} | leads ${c.leads} | qualified ${c.qualifiedLeads} | sales ${c.sales} | attributed revenue ${money(c.revenueCents)}`,
  );
  return [
    `# Performance (last ${p.periodDays} days, observational attribution)`,
    `Totals: ${p.totals.contents} contents, ${p.totals.views} views, ${p.totals.leads} leads, ${p.totals.qualifiedLeads} qualified, ${p.totals.sales} sales, ${money(p.totals.revenueCents)} attributed revenue.`,
    rows.length ? `Recent contents (newest first):\n${rows.join("\n")}` : "No published content yet (cold start): plan exploratory experiments.",
    p.insights.length
      ? `Creative insights:\n${p.insights.map((i) => `- [${i.confidence}] ${i.dimension}=${i.key} (${i.metric}): ${i.summary}`).join("\n")}`
      : "Creative insights: none yet (LOW_DATA).",
    p.memories.length ? `Memories:\n${p.memories.map((m) => `- (${m.category}) ${m.content}`).join("\n")}` : "",
    p.campaigns.length ? `Campaigns:\n${p.campaigns.map((c) => `- ${c.id}: ${c.name} [${c.status}] objective ${c.objective}; angle ${c.angle}; offer ${c.offer}`).join("\n")}` : "",
    p.weeklyStrategy ? `Current weekly strategy:\n${p.weeklyStrategy}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
