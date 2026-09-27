import { agentMemories, and, contents, creativeInsights, eq, sql } from "@revenueos/database";
import {
  classifyConfidence,
  CONFIDENCE_LABELS,
  formatMoney,
  localHour,
  twoProportionZ,
  type ConfidenceLevel,
  type InsightDimension,
  type InsightMetric,
} from "@revenueos/shared";
import { db, now } from "../deps";
import type { Workspace } from "../providers";
import { contentPerformance, type ContentPerformanceRow } from "./analytics";

export interface ComputedInsight {
  dimension: InsightDimension;
  key: string;
  metric: InsightMetric;
  value: number;
  baseline: number;
  lift: number | null;
  sampleSize: number;
  exposures: number;
  events: number;
  z: number | null;
  confidence: ConfidenceLevel;
  rule: string;
  summary: string;
}

function durationBucket(sec: number | null): string | null {
  if (sec == null) return null;
  if (sec < 15) return "<15s";
  if (sec < 25) return "15-25s";
  if (sec < 40) return "25-40s";
  return "40s+";
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

/**
 * Deterministic learning engine. Groups published content by creative
 * dimension and compares commercial metrics against the workspace baseline
 * with transparent confidence rules. No AI call, no invented statistics.
 */
export function computeInsights(rows: ContentPerformanceRow[], timezone: string, currency: string): ComputedInsight[] {
  const published = rows.filter((r) => r.publishedAt && (r.views ?? 0) > 0);
  if (published.length === 0) return [];
  const total = published.reduce((a, r) => ({ views: a.views + (r.views ?? 0), leads: a.leads + r.leads, sales: a.sales + r.sales, revenue: a.revenue + r.revenueCents }), { views: 0, leads: 0, sales: 0, revenue: 0 });
  const dims: [InsightDimension, (r: ContentPerformanceRow) => string | null][] = [
    ["HOOK_TYPE", (r) => r.hookType],
    ["TEMPLATE", (r) => r.templateId],
    ["CTA_TYPE", (r) => r.ctaType],
    ["DURATION", (r) => durationBucket(r.durationSec)],
    ["POSTING_HOUR", (r) => (r.publishedAt ? `${String(localHour(r.publishedAt, timezone)).padStart(2, "0")}h` : null)],
  ];
  const out: ComputedInsight[] = [];
  for (const [dimension, keyOf] of dims) {
    const groups = new Map<string, ContentPerformanceRow[]>();
    for (const r of published) {
      const k = keyOf(r);
      if (!k) continue;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    if (groups.size < 2) continue;
    for (const [key, list] of groups) {
      const g = list.reduce((a, r) => ({ views: a.views + (r.views ?? 0), leads: a.leads + r.leads, sales: a.sales + r.sales, revenue: a.revenue + r.revenueCents }), { views: 0, leads: 0, sales: 0, revenue: 0 });
      const rest = { views: total.views - g.views, leads: total.leads - g.leads, sales: total.sales - g.sales, revenue: total.revenue - g.revenue };
      // Lead rate (proportion → z-test vs the rest of the workspace)
      if (g.views > 0 && rest.views > 0) {
        const value = g.leads / g.views;
        const baseline = rest.leads / rest.views;
        const lift = baseline > 0 ? value / baseline - 1 : null;
        const z = twoProportionZ(g.leads, g.views, rest.leads, rest.views);
        const c = classifyConfidence({ contents: list.length, exposures: g.views, events: g.leads, lift, z });
        if (c) {
          out.push({
            dimension, key, metric: "LEAD_RATE", value, baseline, lift, sampleSize: list.length, exposures: g.views, events: g.leads, z, confidence: c.level, rule: c.rule,
            summary: `${dimension} "${key}": ${pct(value)} lead rate vs ${pct(baseline)} for the rest (${lift != null ? `${lift >= 0 ? "+" : ""}${Math.round(lift * 100)}%` : "n/a"}), ${list.length} contents, ${g.views} views — ${CONFIDENCE_LABELS[c.level]}.`,
          });
        }
      }
      // Revenue per 1k views (not a proportion → lift-based rule)
      if (g.views > 0 && rest.views > 0 && total.revenue > 0) {
        const value = (g.revenue / g.views) * 1000;
        const baseline = (rest.revenue / rest.views) * 1000;
        const lift = baseline > 0 ? value / baseline - 1 : g.revenue > 0 ? 1 : null;
        const c = classifyConfidence({ contents: list.length, exposures: g.views, events: g.sales, lift, z: null });
        if (c) {
          out.push({
            dimension, key, metric: "REVENUE_PER_1K", value, baseline, lift, sampleSize: list.length, exposures: g.views, events: g.sales, z: null, confidence: c.level, rule: c.rule,
            summary: `${dimension} "${key}": ${formatMoney(Math.round(value), currency)} attributed revenue per 1k views vs ${formatMoney(Math.round(baseline), currency)} for the rest, ${g.sales} sales — ${CONFIDENCE_LABELS[c.level]}.`,
          });
        }
      }
      // Sale rate (sales / leads)
      if (g.leads > 0 && rest.leads > 0) {
        const value = g.sales / g.leads;
        const baseline = rest.sales / rest.leads;
        const lift = baseline > 0 ? value / baseline - 1 : null;
        const z = twoProportionZ(g.sales, g.leads, rest.sales, rest.leads);
        const c = classifyConfidence({ contents: list.length, exposures: Math.max(g.leads * 50, g.views), events: g.sales, lift, z });
        if (c && c.level !== "LOW_DATA") {
          out.push({
            dimension, key, metric: "SALE_RATE", value, baseline, lift, sampleSize: list.length, exposures: g.leads, events: g.sales, z, confidence: c.level, rule: c.rule,
            summary: `${dimension} "${key}": ${pct(value)} of leads bought vs ${pct(baseline)} for the rest — ${CONFIDENCE_LABELS[c.level]}.`,
          });
        }
      }
    }
  }
  return out;
}

/** Recomputes and stores the latest creative insights for a workspace (30-day window). */
export async function refreshInsights(ws: Workspace, days = 30): Promise<ComputedInsight[]> {
  const since = new Date(now().getTime() - days * 24 * 3600 * 1000);
  const rows = await contentPerformance([ws.id], { since, limit: 500 });
  const insights = computeInsights(rows, ws.timezone, ws.currency);
  await db().transaction(async (tx) => {
    await tx.update(creativeInsights).set({ isLatest: false }).where(and(eq(creativeInsights.workspaceId, ws.id), eq(creativeInsights.isLatest, true)));
    for (const i of insights) {
      await tx.insert(creativeInsights).values({
        workspaceId: ws.id,
        dimension: i.dimension,
        key: i.key,
        metric: i.metric,
        value: i.value,
        baseline: i.baseline,
        lift: i.lift,
        sampleSize: i.sampleSize,
        exposures: i.exposures,
        events: i.events,
        zScore: i.z,
        confidence: i.confidence,
        rule: i.rule,
        evidence: { contents: rows.filter((r) => r.publishedAt).length, windowDays: days },
        summary: i.summary,
        periodStart: since,
        periodEnd: now(),
        isLatest: true,
      });
    }
  });
  return insights;
}

/** Stores durable learnings as workspace-scoped memories (never shared across workspaces). */
export async function saveMemory(workspaceId: string, category: "BRAND" | "AUDIENCE" | "CONTENT" | "SALES" | "PERFORMANCE", content: string, data: Record<string, unknown> = {}, importance = 5): Promise<void> {
  const dup = await db()
    .select({ id: agentMemories.id })
    .from(agentMemories)
    .where(and(eq(agentMemories.workspaceId, workspaceId), eq(agentMemories.content, content)))
    .limit(1);
  if (dup[0]) {
    await db().update(agentMemories).set({ importance: sql`least(${agentMemories.importance} + 1, 10)`, data }).where(eq(agentMemories.id, dup[0].id));
    return;
  }
  await db().insert(agentMemories).values({ workspaceId, category, content: content.slice(0, 1000), data, importance, source: "AGENT" });
}

/** Incremental learning after attributed revenue: remember the winning creative pattern. */
export async function learnFromSale(workspaceId: string, contentId: string | null, amountCents: number): Promise<void> {
  if (!contentId) return;
  const [c] = await db().select().from(contents).where(eq(contents.id, contentId)).limit(1);
  if (!c) return;
  await saveMemory(
    workspaceId,
    "PERFORMANCE",
    `Content with hook "${c.hook ?? c.title}" (${c.hookType ?? "?"}, template ${c.templateId ?? "?"}, CTA ${c.ctaType ?? "?"}) has attributed sales.`,
    { contentId, lastSaleCents: amountCents },
    7,
  );
}
