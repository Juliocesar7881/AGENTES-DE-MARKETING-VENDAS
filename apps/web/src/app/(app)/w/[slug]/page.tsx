import { CircleDollarSign, Cpu, Eye, Film, Target, UserRound } from "lucide-react";
import Link from "next/link";
import { aiSpend, bufferState, dailySeries, funnel, getWorkspace, totals } from "@revenueos/core";
import { activities, agentRuns, agents, and, asc, contents, creativeInsights, desc, eq, gte, inArray, sql, withUser } from "@revenueos/database";
import { ActivityFeed } from "@/components/activity-feed";
import { FunnelBars, RevenueChart } from "@/components/charts/revenue-chart";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { PlatformIcon } from "@/components/platform-icon";
import { RangeTabs, parseRange } from "@/components/range-tabs";
import { StatusBadge } from "@/components/status-badge";
import { AgentsPanel } from "@/components/workspace/agents-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Progress, StatCard } from "@/components/ui/misc";
import { CONTENT_STATUS } from "@/lib/status";
import { compact, dateTime, money, num, usd } from "@/lib/utils";
import { requireWorkspace } from "@/server/session";

export default async function WorkspaceOverview({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ range?: string }> }) {
  const { slug } = await params;
  const range = parseRange((await searchParams).range);
  const { user, ws } = await requireWorkspace(slug);
  const from = new Date(Date.now() - range * 86400_000);
  const since7 = new Date(Date.now() - 7 * 86400_000);
  const [t, series, fun, buffer, spend, data] = await Promise.all([
    totals([ws.id], from),
    dailySeries([ws.id], range, ws.timezone),
    funnel([ws.id], from),
    bufferState(await getWorkspace(ws.id)),
    aiSpend([ws.id], from),
    withUser(user.id, async (tx) => {
      const agentRows = await tx.select().from(agents).where(eq(agents.workspaceId, ws.id));
      const runs = await tx
        .select({ role: agentRuns.agentRole, n: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${agentRuns.costUsd}),0)::float` })
        .from(agentRuns)
        .where(and(eq(agentRuns.workspaceId, ws.id), gte(agentRuns.createdAt, since7)))
        .groupBy(agentRuns.agentRole);
      const upcoming = await tx
        .select({ id: contents.id, number: contents.number, title: contents.title, hook: contents.hook, status: contents.status, scheduledFor: contents.scheduledFor, platforms: contents.targetPlatforms })
        .from(contents)
        .where(and(eq(contents.workspaceId, ws.id), inArray(contents.status, ["SCHEDULED", "READY", "RENDERING", "GENERATING", "READY_TO_RENDER"])))
        .orderBy(sql`${contents.scheduledFor} ASC NULLS LAST`, asc(contents.createdAt))
        .limit(6);
      const insights = await tx
        .select()
        .from(creativeInsights)
        .where(and(eq(creativeInsights.workspaceId, ws.id), eq(creativeInsights.isLatest, true)))
        .orderBy(sql`CASE ${creativeInsights.confidence} WHEN 'STRONG_EVIDENCE' THEN 0 WHEN 'CONSISTENT' THEN 1 WHEN 'PROMISING' THEN 2 ELSE 3 END`, desc(creativeInsights.sampleSize))
        .limit(5);
      const feed = await tx.select().from(activities).where(eq(activities.workspaceId, ws.id)).orderBy(desc(activities.createdAt)).limit(15);
      return { agentRows, runs, upcoming, insights, feed };
    }),
  ]);
  const weekly = ws.weeklyStrategy as { summary?: string; priorities?: string[]; focusProducts?: string[] } | null;
  const readyPct = ((buffer.available) / Math.max(1, ws.targetReadyBuffer)) * 100;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <RangeTabs value={range} base={`/w/${slug}`} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Attributed revenue" value={money(t.revenueCents, ws.currency)} icon={CircleDollarSign} hint={`${t.sales} sale${t.sales === 1 ? "" : "s"}`} />
        <StatCard label="Leads" value={num(t.leads)} icon={UserRound} hint={`${t.qualifiedLeads} qualified`} />
        <StatCard label="Checkouts" value={num(t.checkouts)} icon={Target} hint={t.checkouts ? `${Math.round((t.sales / t.checkouts) * 100)}% paid` : "—"} />
        <StatCard label="Posts" value={num(t.postsPublished)} icon={Film} hint={`${t.contentsPublished} videos published`} />
        <StatCard label="Views" value={t.views ? compact(t.views) : "—"} icon={Eye} />
        <StatCard label="AI cost" value={usd(spend.total)} icon={Cpu} hint={spend.byAgent[0] ? `top: ${spend.byAgent[0].agent.toLowerCase()}` : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Attributed revenue & leads</CardTitle>
              <CardDescription>Last {range} days · confirmed payments only</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <RevenueChart data={series} currency={ws.currency} height={220} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Funnel</CardTitle>
              <CardDescription>Views → sales, last {range} days</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <FunnelBars data={fun} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Agents</CardTitle>
              <CardDescription>Pause any agent — its automatic jobs wait.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pb-2">
            <AgentsPanel
              workspaceId={ws.id}
              agents={data.agentRows.map((a) => ({ role: a.role, status: a.status, paused: a.paused, currentTask: a.currentTask, lastRunAt: a.lastRunAt?.toISOString() ?? null, lastError: a.lastError, runs7d: data.runs.find((r) => r.role === a.role)?.n ?? 0, cost7d: data.runs.find((r) => r.role === a.role)?.cost ?? 0 }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Content buffer</CardTitle>
              <CardDescription>
                Keeps {ws.targetReadyBuffer} videos ahead · max {ws.maxContentGeneratedPerDay} generated/day
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1.5 flex justify-between text-xs">
                <span className="text-muted-foreground">Ready + in progress</span>
                <span className="tabular font-medium">
                  {buffer.available} / {ws.targetReadyBuffer}
                </span>
              </div>
              <Progress value={readyPct} tone={buffer.deficit === 0 ? "success" : "warning"} />
              <p className="mt-2 text-xs text-muted-foreground">
                {buffer.deficit === 0 ? "Buffer is full." : `Needs ${buffer.deficit} more · ${buffer.remainingToday} can still be generated today.`}
              </p>
            </div>
            <div className="space-y-1.5">
              {data.upcoming.length === 0 ? <EmptyState title="Nothing queued" description="Click “New content” or let the autopilot fill the buffer." className="py-6" /> : null}
              {data.upcoming.map((c) => (
                <Link key={c.id} href={`/w/${slug}/content/${c.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
                  <span className="tabular w-24 shrink-0 text-[11px] text-muted-foreground">{c.scheduledFor ? dateTime(c.scheduledFor, ws.timezone) : "unscheduled"}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{c.hook ?? c.title}</span>
                  <span className="flex -space-x-1">
                    {c.platforms.slice(0, 3).map((p) => (
                      <PlatformIcon key={p} platform={p} size={14} />
                    ))}
                  </span>
                  <StatusBadge map={CONTENT_STATUS} value={c.status} />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>What the data says</CardTitle>
              <CardDescription>Observed patterns with transparent confidence rules</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {weekly?.summary ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-[13px]">
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">This week&apos;s strategy</div>
                {weekly.summary}
              </div>
            ) : null}
            {data.insights.length === 0 ? <p className="text-sm text-muted-foreground">Not enough data yet. Insights appear after the first published videos collect views and leads.</p> : null}
            {data.insights.map((i) => (
              <div key={i.id} className="flex items-start gap-2">
                <ConfidenceBadge level={i.confidence} />
                <div className="min-w-0 text-[13px] leading-snug">
                  {i.summary}
                  <div className="text-[11px] text-subtle">
                    n={i.sampleSize} · {i.rule}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Activity</CardTitle>
            <CardDescription>Every action by agents, the worker, webhooks and people</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-3">
          <ActivityFeed items={data.feed.map((a) => ({ a }))} workspace slugOf={slug} />
        </CardContent>
      </Card>
    </div>
  );
}
