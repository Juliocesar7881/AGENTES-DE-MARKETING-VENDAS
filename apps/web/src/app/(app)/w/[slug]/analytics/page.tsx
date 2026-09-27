import Link from "next/link";
import { aiSpend, contentPerformance, dailySeries, funnel } from "@revenueos/core";
import { and, creativeInsights, desc, eq, sql, withUser } from "@revenueos/database";
import { FunnelBars, RevenueChart } from "@/components/charts/revenue-chart";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { RangeTabs, parseRange } from "@/components/range-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Table, TBody, TD, TH, THead, TR } from "@/components/ui/misc";
import { compact, money, pct, usd } from "@/lib/utils";
import { requireWorkspace } from "@/server/session";

type Row = Awaited<ReturnType<typeof contentPerformance>>[number];

function groupBy(rows: Row[], key: (r: Row) => string | null) {
  const map = new Map<string, { key: string; contents: number; views: number; viewsKnown: boolean; leads: number; sales: number; revenue: number }>();
  for (const r of rows) {
    const k = key(r) ?? "—";
    const g = map.get(k) ?? { key: k, contents: 0, views: 0, viewsKnown: false, leads: 0, sales: 0, revenue: 0 };
    g.contents++;
    if (r.views != null) {
      g.views += r.views;
      g.viewsKnown = true;
    }
    g.leads += r.leads;
    g.sales += r.sales;
    g.revenue += r.revenueCents;
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
}

export default async function AnalyticsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ range?: string }> }) {
  const { slug } = await params;
  const range = parseRange((await searchParams).range, 30);
  const { user, ws } = await requireWorkspace(slug);
  const from = new Date(Date.now() - range * 86400_000);
  const [rows, series, fun, spend, insights] = await Promise.all([
    contentPerformance([ws.id], { since: from, limit: 300 }),
    dailySeries([ws.id], range, ws.timezone),
    funnel([ws.id], from),
    aiSpend([ws.id], from),
    withUser(user.id, (tx) =>
      tx
        .select()
        .from(creativeInsights)
        .where(and(eq(creativeInsights.workspaceId, ws.id), eq(creativeInsights.isLatest, true)))
        .orderBy(sql`CASE ${creativeInsights.confidence} WHEN 'STRONG_EVIDENCE' THEN 0 WHEN 'CONSISTENT' THEN 1 WHEN 'PROMISING' THEN 2 ELSE 3 END`, desc(creativeInsights.sampleSize))
        .limit(30),
    ),
  ]);
  const published = rows.filter((r) => r.publishedAt);
  const dims = [
    { title: "By template", rows: groupBy(published, (r) => r.templateId?.replace(/_/g, " ").toLowerCase() ?? null) },
    { title: "By hook type", rows: groupBy(published, (r) => r.hookType?.replace(/_/g, " ").toLowerCase() ?? null) },
    { title: "By CTA", rows: groupBy(published, (r) => r.ctaType?.replace(/_/g, " ").toLowerCase() ?? null) },
  ];
  const revenue = series.reduce((s, p) => s + p.revenueCents, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="max-w-3xl text-xs text-muted-foreground">
          All numbers are <strong>attributed</strong> and <strong>observational</strong>: revenue is linked to content through tracked links, reference codes and platform referrals. Correlation is not proof of causation; small samples are labeled.
        </p>
        <RangeTabs value={range} base={`/w/${slug}/analytics`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Attributed revenue</CardTitle>
              <CardDescription>{money(revenue, ws.currency)} in {range} days</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <RevenueChart data={series} currency={ws.currency} height={220} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelBars data={fun} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Which content made money</CardTitle>
            <CardDescription>Per video: views → leads → sales → revenue. “—” means the platform did not provide the metric (never invented).</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-2">
          {published.length === 0 ? (
            <EmptyState title="No published content in this period" className="mx-3" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Content</TH>
                  <TH className="text-right">Views</TH>
                  <TH className="text-right">Clicks</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Lead rate</TH>
                  <TH className="text-right">Sales</TH>
                  <TH className="text-right">Sale / lead</TH>
                  <TH className="text-right">Revenue</TH>
                  <TH className="text-right">Rev / 1k views</TH>
                </TR>
              </THead>
              <TBody>
                {[...published]
                  .sort((a, b) => b.revenueCents - a.revenueCents || b.leads - a.leads)
                  .map((r) => (
                    <TR key={r.id}>
                      <TD className="max-w-[320px]">
                        <Link href={`/w/${slug}/content/${r.id}`} className="block truncate font-medium hover:underline">
                          {r.hook ?? r.title}
                        </Link>
                        <div className="text-[11px] text-subtle">
                          #{r.number} · {r.templateId?.replace(/_/g, " ").toLowerCase()} · {r.hookType?.toLowerCase()}
                        </div>
                      </TD>
                      <TD className="tabular text-right">{r.views == null ? "—" : compact(r.views)}</TD>
                      <TD className="tabular text-right">{r.clicks}</TD>
                      <TD className="tabular text-right">{r.leads}</TD>
                      <TD className="tabular text-right">{pct(r.leadPerView, 2)}</TD>
                      <TD className="tabular text-right">{r.sales}</TD>
                      <TD className="tabular text-right">{pct(r.salePerLead, 0)}</TD>
                      <TD className="tabular text-right font-medium">{money(r.revenueCents, ws.currency)}</TD>
                      <TD className="tabular text-right">{r.revenuePer1kViews == null ? "—" : money(Math.round(r.revenuePer1kViews), ws.currency)}</TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {dims.map((dim) => (
          <Card key={dim.title}>
            <CardHeader>
              <CardTitle>{dim.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {dim.rows.length === 0 ? <p className="text-sm text-muted-foreground">No data.</p> : null}
              {dim.rows.map((g) => (
                <div key={g.key} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="truncate capitalize">{g.key}</span>
                  <span className="tabular shrink-0 text-right text-muted-foreground">
                    {g.contents} videos · {g.leads} leads · <span className="font-medium text-foreground">{money(g.revenue, ws.currency)}</span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Creative insights</CardTitle>
              <CardDescription>Transparent rules: LOW_DATA (&lt;3 contents or &lt;500 exposures) · PROMISING · CONSISTENT · STRONG_EVIDENCE (large sample and |z| ≥ 2)</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {insights.length === 0 ? <p className="text-sm text-muted-foreground">Insights are computed nightly from published content.</p> : null}
            {insights.map((i) => (
              <div key={i.id} className="flex items-start gap-3 border-b border-border pb-3 last:border-0">
                <ConfidenceBadge level={i.confidence} />
                <div className="min-w-0 text-[13px]">
                  <div>{i.summary}</div>
                  <div className="mt-0.5 text-[11px] text-subtle">
                    {i.dimension.toLowerCase()} = {i.key} · metric {i.metric} · n={i.sampleSize} · exposures {i.exposures} · events {i.events}
                    {i.zScore != null ? ` · z=${Number(i.zScore).toFixed(2)}` : ""} · {i.rule}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>AI cost</CardTitle>
              <CardDescription>
                {usd(spend.total)} in {range} days{revenue && spend.total ? ` · ${Math.round(revenue / 100 / spend.total)}× revenue per $ of AI` : ""}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-[13px]">
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">By agent</div>
              {spend.byAgent.map((a) => (
                <div key={a.agent} className="flex justify-between">
                  <span className="capitalize">{a.agent.toLowerCase().replace("_", " ")}</span>
                  <span className="tabular">{usd(a.cost)}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">By model</div>
              {spend.byModel.map((m) => (
                <div key={m.model} className="flex justify-between gap-2">
                  <span className="truncate font-mono text-[12px]">{m.model}</span>
                  <span className="tabular shrink-0">
                    {usd(m.cost)} · {compact(m.input)} in / {compact(m.output)} out
                  </span>
                </div>
              ))}
              {spend.byModel.length === 0 ? <p className="text-muted-foreground">No AI usage yet.</p> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
