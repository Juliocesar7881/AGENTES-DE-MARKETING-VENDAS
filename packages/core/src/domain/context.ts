import { agentMemories, and, brandAssets, brandKits, businessProfiles, campaigns, creativeInsights, desc, eq, products, sql } from "@revenueos/database";
import type { BusinessContext, PerformanceContext } from "@revenueos/agents";
import { AVAILABLE_FONTS, type FontFamily } from "@revenueos/shared";
import { db, now } from "../deps";
import type { Workspace } from "../providers";
import { contentPerformance } from "./analytics";

function font(f: string): FontFamily {
  return (AVAILABLE_FONTS as readonly string[]).includes(f) ? (f as FontFamily) : "Inter";
}

/**
 * Builds the agent context for ONE workspace. Every query is filtered by this
 * workspace id — memories, products and assets of other businesses can never
 * leak into a prompt.
 */
export async function loadBusinessContext(ws: Workspace): Promise<BusinessContext> {
  const [brand] = await db().select().from(brandKits).where(eq(brandKits.workspaceId, ws.id)).limit(1);
  const [profile] = await db().select().from(businessProfiles).where(eq(businessProfiles.workspaceId, ws.id)).limit(1);
  const prods = await db()
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, ws.id), eq(products.active, true)))
    .orderBy(products.sort);
  const assets = await db()
    .select()
    .from(brandAssets)
    .where(and(eq(brandAssets.workspaceId, ws.id), eq(brandAssets.status, "READY")))
    .orderBy(desc(brandAssets.createdAt))
    .limit(30);
  return {
    workspace: {
      id: ws.id,
      name: ws.name,
      industry: ws.industry,
      description: ws.description,
      website: ws.website,
      locale: ws.locale,
      currency: ws.currency,
      timezone: ws.timezone,
      whatsappNumber: ws.whatsappNumber,
      targetPlatforms: ws.targetPlatforms,
    },
    brand: {
      businessName: brand?.businessName ?? ws.name,
      logoAssetId: brand?.logoAssetId ?? null,
      primaryColor: brand?.primaryColor ?? "#2EE6A6",
      secondaryColor: brand?.secondaryColor ?? "#7C6CFF",
      accentColor: brand?.accentColor ?? "#FFB547",
      backgroundColor: brand?.backgroundColor ?? "#0B0F14",
      textColor: brand?.textColor ?? "#F5F7FA",
      fontHeading: font(brand?.fontHeading ?? "Inter"),
      fontBody: font(brand?.fontBody ?? "Inter"),
      tone: brand?.tone ?? "",
      style: brand?.style ?? "",
      voice: brand?.voice ?? "",
      handle: brand?.handle ?? null,
      website: brand?.website ?? ws.website,
      description: brand?.description ?? ws.description,
      targetAudience: brand?.targetAudience ?? "",
      keywords: brand?.keywords ?? [],
      forbiddenWords: brand?.forbiddenWords ?? [],
      ctaPreferences: brand?.ctaPreferences ?? [],
    },
    audience: {
      targetAudience: profile?.targetAudience || brand?.targetAudience || "",
      problems: profile?.problems ?? [],
      goals: profile?.goals ?? [],
      valueProposition: profile?.valueProposition ?? "",
      differentiators: profile?.differentiators ?? [],
    },
    products: prods.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type,
      priceCents: p.priceCents,
      currency: p.currency,
      benefits: p.benefits,
      features: p.features,
      faq: p.faq,
      limitations: p.limitations,
      offer: p.offer,
      support: p.support,
      terms: p.terms,
    })),
    assets: assets
      .filter((a) => a.kind !== "AUDIO")
      .map((a) => ({ id: a.id, kind: a.kind, description: a.description || a.filename, width: a.width, height: a.height })),
  };
}

export async function loadPerformanceContext(ws: Workspace, days: number): Promise<PerformanceContext> {
  const since = new Date(now().getTime() - days * 24 * 3600 * 1000);
  const perf = await contentPerformance([ws.id], { since, limit: 40 });
  const recentAny = perf.length ? perf : await contentPerformance([ws.id], { limit: 20 });
  const insights = await db()
    .select()
    .from(creativeInsights)
    .where(and(eq(creativeInsights.workspaceId, ws.id), eq(creativeInsights.isLatest, true)))
    .orderBy(desc(creativeInsights.createdAt))
    .limit(20);
  const memories = await db()
    .select()
    .from(agentMemories)
    .where(and(eq(agentMemories.workspaceId, ws.id), sql`(${agentMemories.expiresAt} IS NULL OR ${agentMemories.expiresAt} > now())`))
    .orderBy(desc(agentMemories.importance), desc(agentMemories.createdAt))
    .limit(25);
  const camps = await db().select().from(campaigns).where(eq(campaigns.workspaceId, ws.id)).orderBy(desc(campaigns.createdAt)).limit(5);
  const published = perf.filter((p) => p.publishedAt);
  return {
    periodDays: days,
    totals: {
      contents: published.length,
      views: published.reduce((s, p) => s + (p.views ?? 0), 0),
      leads: published.reduce((s, p) => s + p.leads, 0),
      qualifiedLeads: published.reduce((s, p) => s + p.qualifiedLeads, 0),
      sales: published.reduce((s, p) => s + p.sales, 0),
      revenueCents: published.reduce((s, p) => s + p.revenueCents, 0),
    },
    recentContents: recentAny.slice(0, 20).map((p) => ({
      id: p.id,
      title: p.title,
      hook: p.hook,
      hookType: p.hookType,
      angle: p.angle,
      templateId: p.templateId,
      ctaType: p.ctaType,
      durationSec: p.durationSec,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      views: p.views,
      leads: p.leads,
      qualifiedLeads: p.qualifiedLeads,
      sales: p.sales,
      revenueCents: p.revenueCents,
    })),
    insights: insights.map((i) => ({ dimension: i.dimension, key: i.key, metric: i.metric, confidence: i.confidence, summary: i.summary })),
    memories: memories.map((m) => ({ category: m.category, content: m.content })),
    campaigns: camps.map((c) => ({ id: c.id, name: c.name, objective: c.objective, angle: c.angle, offer: c.offer, status: c.status })),
    weeklyStrategy: ws.weeklyStrategy ? String((ws.weeklyStrategy as { summary?: string }).summary ?? "") : null,
  };
}
