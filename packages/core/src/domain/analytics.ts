import { sql } from "@revenueos/database";
import { ratio } from "@revenueos/shared";
import { db } from "../deps";

/** Normalizes postgres-js numeric/bigint strings. */
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const nn = (v: unknown): number | null => (v == null ? null : Number(v));

function uuidArray(ids: string[]) {
  const clean = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
  return sql.raw(clean.length ? `ARRAY[${clean.map((i) => `'${i}'::uuid`).join(",")}]` : `ARRAY[]::uuid[]`);
}

export interface ContentPerformanceRow {
  id: string;
  number: number;
  workspaceId: string;
  title: string;
  status: string;
  hook: string | null;
  hookType: string | null;
  angle: string | null;
  templateId: string | null;
  ctaType: string | null;
  durationSec: number | null;
  publishedAt: Date | null;
  scheduledFor: Date | null;
  posts: number;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number;
  leads: number;
  qualifiedLeads: number;
  checkouts: number;
  sales: number;
  revenueCents: number;
  /** Derived metrics — null when the denominator is unavailable (never invented). */
  leadPerView: number | null;
  salePerLead: number | null;
  revenuePer1kViews: number | null;
  revenuePerLead: number | null;
  isDemo: boolean;
}

/**
 * "Which content made money?" — per-content funnel from views to attributed
 * revenue. Views come from the latest metrics snapshot of each social post.
 */
export async function contentPerformance(workspaceIds: string[], opts: { since?: Date | null; limit?: number; contentIds?: string[] } = {}): Promise<ContentPerformanceRow[]> {
  if (workspaceIds.length === 0) return [];
  const ws = uuidArray(workspaceIds);
  const since = opts.since ?? null;
  const contentFilter = opts.contentIds?.length ? sql`AND c.id = ANY(${uuidArray(opts.contentIds)})` : sql``;
  const rows = (await db().execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (sm.social_post_id) sm.social_post_id, sm.views, sm.reach, sm.likes, sm.comments, sm.shares, sm.saves, sm.clicks
      FROM social_metrics sm
      WHERE sm.workspace_id = ANY(${ws})
      ORDER BY sm.social_post_id, sm.captured_at DESC
    ),
    post_agg AS (
      SELECT sp.content_id,
        count(*) FILTER (WHERE sp.status = 'PUBLISHED') AS posts,
        sum(l.views) AS views, sum(l.reach) AS reach, sum(l.likes) AS likes, sum(l.comments) AS comments,
        sum(l.shares) AS shares, sum(l.saves) AS saves, sum(l.clicks) AS platform_clicks
      FROM social_posts sp LEFT JOIN latest l ON l.social_post_id = sp.id
      WHERE sp.workspace_id = ANY(${ws})
      GROUP BY sp.content_id
    ),
    clicks AS (SELECT content_id, count(*) AS c FROM attribution_events WHERE workspace_id = ANY(${ws}) AND event_type = 'CLICK' GROUP BY content_id),
    lead_agg AS (
      SELECT source_content_id AS content_id, count(*) AS leads, count(*) FILTER (WHERE qualified_at IS NOT NULL) AS qualified
      FROM leads WHERE workspace_id = ANY(${ws}) AND source_content_id IS NOT NULL GROUP BY source_content_id
    ),
    chk AS (SELECT content_id, count(*) AS c FROM checkouts WHERE workspace_id = ANY(${ws}) AND content_id IS NOT NULL GROUP BY content_id),
    pay AS (
      SELECT content_id, count(*) AS sales, sum(amount_cents) AS revenue
      FROM payments WHERE workspace_id = ANY(${ws}) AND status = 'APPROVED' AND content_id IS NOT NULL GROUP BY content_id
    )
    SELECT c.id, c.number, c.workspace_id, c.title, c.status, c.hook, c.hook_type, c.angle, c.template_id, c.cta_type, c.duration_sec,
      c.published_at, c.scheduled_for, c.is_demo,
      coalesce(pa.posts, 0) AS posts, pa.views, pa.reach, pa.likes, pa.comments, pa.shares, pa.saves,
      coalesce(ck.c, 0) + coalesce(pa.platform_clicks, 0) AS clicks,
      coalesce(la.leads, 0) AS leads, coalesce(la.qualified, 0) AS qualified,
      coalesce(ch.c, 0) AS checkouts, coalesce(p.sales, 0) AS sales, coalesce(p.revenue, 0) AS revenue
    FROM contents c
    LEFT JOIN post_agg pa ON pa.content_id = c.id
    LEFT JOIN clicks ck ON ck.content_id = c.id
    LEFT JOIN lead_agg la ON la.content_id = c.id
    LEFT JOIN chk ch ON ch.content_id = c.id
    LEFT JOIN pay p ON p.content_id = c.id
    WHERE c.workspace_id = ANY(${ws})
      AND (${since}::timestamptz IS NULL OR c.published_at >= ${since}::timestamptz)
      ${contentFilter}
    ORDER BY c.published_at DESC NULLS LAST, c.created_at DESC
    LIMIT ${opts.limit ?? 200}
  `)) as unknown as Record<string, unknown>[];
  return rows.map((r) => {
    const views = nn(r.views);
    const leads = n(r.leads);
    const sales = n(r.sales);
    const revenue = n(r.revenue);
    return {
      id: r.id as string,
      number: n(r.number),
      workspaceId: r.workspace_id as string,
      title: r.title as string,
      status: r.status as string,
      hook: (r.hook as string) ?? null,
      hookType: (r.hook_type as string) ?? null,
      angle: (r.angle as string) ?? null,
      templateId: (r.template_id as string) ?? null,
      ctaType: (r.cta_type as string) ?? null,
      durationSec: nn(r.duration_sec),
      publishedAt: r.published_at ? new Date(r.published_at as string) : null,
      scheduledFor: r.scheduled_for ? new Date(r.scheduled_for as string) : null,
      posts: n(r.posts),
      views,
      reach: nn(r.reach),
      likes: nn(r.likes),
      comments: nn(r.comments),
      shares: nn(r.shares),
      saves: nn(r.saves),
      clicks: n(r.clicks),
      leads,
      qualifiedLeads: n(r.qualified),
      checkouts: n(r.checkouts),
      sales,
      revenueCents: revenue,
      leadPerView: ratio(leads, views),
      salePerLead: ratio(sales, leads),
      revenuePer1kViews: views ? (revenue / views) * 1000 : null,
      revenuePerLead: ratio(revenue, leads),
      isDemo: Boolean(r.is_demo),
    };
  });
}

export interface Totals {
  revenueCents: number;
  sales: number;
  leads: number;
  qualifiedLeads: number;
  checkouts: number;
  postsPublished: number;
  contentsPublished: number;
  readyContent: number;
  scheduledContent: number;
  views: number;
  aiCostUsd: number;
}

export async function totals(workspaceIds: string[], from: Date, to: Date = new Date(8640000000000000)): Promise<Totals> {
  if (workspaceIds.length === 0) return { revenueCents: 0, sales: 0, leads: 0, qualifiedLeads: 0, checkouts: 0, postsPublished: 0, contentsPublished: 0, readyContent: 0, scheduledContent: 0, views: 0, aiCostUsd: 0 };
  const ws = uuidArray(workspaceIds);
  const [r] = (await db().execute(sql`
    SELECT
      (SELECT coalesce(sum(amount_cents),0) FROM payments WHERE workspace_id = ANY(${ws}) AND status='APPROVED' AND approved_at >= ${from} AND approved_at < ${to}) AS revenue,
      (SELECT count(*) FROM payments WHERE workspace_id = ANY(${ws}) AND status='APPROVED' AND approved_at >= ${from} AND approved_at < ${to}) AS sales,
      (SELECT count(*) FROM leads WHERE workspace_id = ANY(${ws}) AND created_at >= ${from} AND created_at < ${to}) AS leads,
      (SELECT count(*) FROM leads WHERE workspace_id = ANY(${ws}) AND qualified_at >= ${from} AND qualified_at < ${to}) AS qualified,
      (SELECT count(*) FROM checkouts WHERE workspace_id = ANY(${ws}) AND created_at >= ${from} AND created_at < ${to}) AS checkouts,
      (SELECT count(*) FROM social_posts WHERE workspace_id = ANY(${ws}) AND status='PUBLISHED' AND published_at >= ${from} AND published_at < ${to}) AS posts,
      (SELECT count(*) FROM contents WHERE workspace_id = ANY(${ws}) AND published_at >= ${from} AND published_at < ${to}) AS contents_published,
      (SELECT count(*) FROM contents WHERE workspace_id = ANY(${ws}) AND status = 'READY') AS ready,
      (SELECT count(*) FROM contents WHERE workspace_id = ANY(${ws}) AND status = 'SCHEDULED') AS scheduled,
      (SELECT coalesce(sum(v),0) FROM (
          SELECT DISTINCT ON (sm.social_post_id) sm.views AS v FROM social_metrics sm JOIN social_posts sp ON sp.id = sm.social_post_id
          WHERE sm.workspace_id = ANY(${ws}) AND sp.published_at >= ${from} AND sp.published_at < ${to}
          ORDER BY sm.social_post_id, sm.captured_at DESC) x) AS views,
      (SELECT coalesce(sum(estimated_cost_usd),0) FROM ai_usage WHERE workspace_id = ANY(${ws}) AND created_at >= ${from} AND created_at < ${to}) AS ai_cost
  `)) as unknown as Record<string, unknown>[];
  return {
    revenueCents: n(r!.revenue),
    sales: n(r!.sales),
    leads: n(r!.leads),
    qualifiedLeads: n(r!.qualified),
    checkouts: n(r!.checkouts),
    postsPublished: n(r!.posts),
    contentsPublished: n(r!.contents_published),
    readyContent: n(r!.ready),
    scheduledContent: n(r!.scheduled),
    views: n(r!.views),
    aiCostUsd: Number(n(r!.ai_cost).toFixed(4)),
  };
}

/** Daily attributed revenue/sales/leads series (in the workspace timezone). */
export async function dailySeries(workspaceIds: string[], days: number, timezone: string): Promise<{ date: string; revenueCents: number; sales: number; leads: number }[]> {
  if (workspaceIds.length === 0) return [];
  const ws = uuidArray(workspaceIds);
  const tz = /^[A-Za-z_/+-]+$/.test(timezone) ? timezone : "UTC";
  const rows = (await db().execute(sql`
    WITH d AS (
      SELECT generate_series((now() AT TIME ZONE ${tz})::date - ${days - 1}::int, (now() AT TIME ZONE ${tz})::date, interval '1 day')::date AS day
    )
    SELECT d.day::text AS date,
      coalesce((SELECT sum(amount_cents) FROM payments p WHERE p.workspace_id = ANY(${ws}) AND p.status='APPROVED' AND (p.approved_at AT TIME ZONE ${tz})::date = d.day), 0) AS revenue,
      coalesce((SELECT count(*) FROM payments p WHERE p.workspace_id = ANY(${ws}) AND p.status='APPROVED' AND (p.approved_at AT TIME ZONE ${tz})::date = d.day), 0) AS sales,
      coalesce((SELECT count(*) FROM leads l WHERE l.workspace_id = ANY(${ws}) AND (l.created_at AT TIME ZONE ${tz})::date = d.day), 0) AS leads
    FROM d ORDER BY d.day
  `)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({ date: r.date as string, revenueCents: n(r.revenue), sales: n(r.sales), leads: n(r.leads) }));
}

export async function funnel(workspaceIds: string[], from: Date): Promise<{ stage: string; value: number | null }[]> {
  const t = await totals(workspaceIds, from);
  const ws = uuidArray(workspaceIds);
  const [c] = (await db().execute(sql`SELECT count(*) AS clicks FROM attribution_events WHERE workspace_id = ANY(${ws}) AND event_type='CLICK' AND occurred_at >= ${from}`)) as unknown as Record<string, unknown>[];
  return [
    { stage: "Views", value: t.views || null },
    { stage: "Clicks", value: n(c?.clicks) },
    { stage: "Leads", value: t.leads },
    { stage: "Qualified", value: t.qualifiedLeads },
    { stage: "Checkouts", value: t.checkouts },
    { stage: "Sales", value: t.sales },
  ];
}

export async function aiSpend(workspaceIds: string[] | null, from: Date): Promise<{ total: number; byAgent: { agent: string; cost: number }[]; byModel: { model: string; cost: number; input: number; output: number }[] }> {
  const filter = workspaceIds ? sql`AND workspace_id = ANY(${uuidArray(workspaceIds)})` : sql``;
  const byAgent = (await db().execute(sql`SELECT agent_role AS agent, sum(estimated_cost_usd) AS cost FROM ai_usage WHERE created_at >= ${from} ${filter} GROUP BY agent_role ORDER BY cost DESC`)) as unknown as Record<string, unknown>[];
  const byModel = (await db().execute(
    sql`SELECT model, sum(estimated_cost_usd) AS cost, sum(input_tokens + cache_read_tokens + cache_write_tokens) AS input, sum(output_tokens) AS output FROM ai_usage WHERE created_at >= ${from} ${filter} GROUP BY model ORDER BY cost DESC`,
  )) as unknown as Record<string, unknown>[];
  const total = byAgent.reduce((s, r) => s + n(r.cost), 0);
  return {
    total: Number(total.toFixed(4)),
    byAgent: byAgent.map((r) => ({ agent: r.agent as string, cost: n(r.cost) })),
    byModel: byModel.map((r) => ({ model: r.model as string, cost: n(r.cost), input: n(r.input), output: n(r.output) })),
  };
}

/** Real (non-demo) AI spend for budget enforcement. */
export async function realAiSpend(workspaceId: string | null, from: Date): Promise<number> {
  const filter = workspaceId ? sql`AND workspace_id = ${workspaceId}` : sql``;
  const [r] = (await db().execute(sql`SELECT coalesce(sum(estimated_cost_usd),0) AS c FROM ai_usage WHERE is_demo = false AND created_at >= ${from} ${filter}`)) as unknown as Record<string, unknown>[];
  return n(r?.c);
}
