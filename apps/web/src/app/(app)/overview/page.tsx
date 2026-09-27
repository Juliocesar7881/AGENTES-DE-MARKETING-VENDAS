import { ArrowUpRight, CircleAlert, CircleDollarSign, Cpu, Eye, Film, Plus, Sparkles, Target, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActivityFeed } from "@/components/activity-feed";
import { RevenueChart, Sparkline } from "@/components/charts/revenue-chart";
import { PlatformIcon } from "@/components/platform-icon";
import { RangeTabs, parseRange } from "@/components/range-tabs";
import { StatusBadge } from "@/components/status-badge";
import { Badge, Dot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Progress, StatCard, Table, TBody, TD, TH, THead, TR } from "@/components/ui/misc";
import { MODE } from "@/lib/status";
import { compact, dateTime, money, num, usd } from "@/lib/utils";
import { overviewData } from "@/server/overview";

export const metadata: Metadata = { title: "All businesses" };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const d = await overviewData(range);
  const currency = d.businesses[0]?.ws.currency ?? "BRL";
  const hasDemo = d.businesses.some((b) => b.ws.environment === "DEMO");

  if (d.businesses.length === 0) {
    return (
      <>
        <PageHeader title="Welcome to RevenueOS" description="Create your first business — RevenueOS will analyze it, plan content, render videos on your computer and turn views into sales." />
        <EmptyState
          icon={Sparkles}
          title="No businesses yet"
          description="Onboarding takes about 5 minutes: website, brand, products, audience, posting schedule and connections."
          action={
            <Button asChild variant="primary">
              <Link href="/onboarding">
                <Plus /> Create business
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="All businesses"
        description={`${d.businesses.length} business${d.businesses.length > 1 ? "es" : ""} · revenue shown is attributed from confirmed payments only.`}
        actions={
          <>
            <RangeTabs value={range} base="/overview" />
            <Button asChild variant="secondary" size="sm">
              <Link href="/onboarding">
                <Plus /> New business
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Attributed revenue" value={money(d.all.revenueCents, currency)} icon={CircleDollarSign} hint={`${d.all.sales} confirmed sale${d.all.sales === 1 ? "" : "s"}`} />
        <StatCard label="Leads" value={num(d.all.leads)} icon={UserRound} hint={`${d.all.qualifiedLeads} qualified`} />
        <StatCard label="Checkouts" value={num(d.all.checkouts)} icon={Target} hint={d.all.checkouts ? `${((d.all.sales / d.all.checkouts) * 100).toFixed(0)}% paid` : "—"} />
        <StatCard label="Posts published" value={num(d.all.postsPublished)} icon={Film} hint={`${d.all.readyContent} ready · ${d.all.scheduledContent} scheduled`} />
        <StatCard label="Views" value={d.all.views ? compact(d.all.views) : "—"} icon={Eye} hint={d.all.views ? "latest platform metrics" : "no metrics yet"} />
        <StatCard label="AI cost" value={usd(d.all.aiCostUsd)} icon={Cpu} hint={d.all.revenueCents && d.all.aiCostUsd ? `${Math.round(d.all.revenueCents / 100 / d.all.aiCostUsd)}× revenue / AI cost` : `last ${range} days`} />
      </div>

      {d.actions.length ? (
        <Card className="mt-4 border-warning/30">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CircleAlert className="size-4 text-warning" />
              <CardTitle>Action required</CardTitle>
              <Badge tone="warning">{d.actions.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            {d.actions.slice(0, 8).map((a, i) => (
              <Link key={i} href={a.href} className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5 transition hover:border-border-strong hover:bg-muted/40">
                <Dot tone={a.kind === "FAILED_CONTENT" ? "danger" : "warning"} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{a.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {a.workspaceName} · {a.detail}
                  </div>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-subtle" />
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Attributed revenue & leads</CardTitle>
              <CardDescription>All businesses · last {range} days</CardDescription>
            </div>
            <div className="text-right">
              <div className="tabular text-xl font-semibold">{money(d.all.revenueCents, currency)}</div>
              <div className="text-xs text-muted-foreground">{d.all.sales} sales</div>
            </div>
          </CardHeader>
          <CardContent>
            <RevenueChart data={d.series} currency={currency} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Live activity</CardTitle>
              <CardDescription>What the agents and the system are doing</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="max-h-[300px] overflow-y-auto px-3">
            <ActivityFeed items={d.feed} />
          </CardContent>
        </Card>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold">Businesses</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {d.businesses.map((b, i) => {
          const buffer = b.ready + b.inProgress;
          return (
            <Link key={b.ws.id} href={`/w/${b.ws.slug}`} className="group">
              <Card className="h-full transition group-hover:border-border-strong">
                <CardHeader className="pb-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: b.ws.color }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{b.ws.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {b.ws.environment === "DEMO" ? <Badge tone="info">DEMO</Badge> : <Badge tone="success">LIVE</Badge>}
                        <StatusBadge map={MODE} value={b.ws.operatingMode} />
                        {b.ws.status === "PAUSED" ? <Badge tone="warning">Paused</Badge> : null}
                      </div>
                    </div>
                  </div>
                  <ArrowUpRight className="size-4 text-subtle transition group-hover:text-foreground" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-[11px] text-muted-foreground">Revenue</div>
                      <div className="tabular text-[15px] font-semibold">{money(b.totals.revenueCents, b.ws.currency)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Sales</div>
                      <div className="tabular text-[15px] font-semibold">{b.totals.sales}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Leads</div>
                      <div className="tabular text-[15px] font-semibold">{b.totals.leads}</div>
                    </div>
                  </div>
                  <Sparkline data={b.spark} />
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                      <span>Content buffer</span>
                      <span className="tabular">
                        {b.ready} ready · {b.inProgress} in progress / target {b.ws.targetReadyBuffer}
                      </span>
                    </div>
                    <Progress value={(buffer / Math.max(1, b.ws.targetReadyBuffer)) * 100} tone={b.ready >= b.ws.targetReadyBuffer / 2 ? "success" : "warning"} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Next post: {b.nextPostAt ? dateTime(b.nextPostAt, b.ws.timezone) : "not scheduled"}</span>
                    <span className="flex -space-x-1">
                      {["INSTAGRAM", "TIKTOK", "YOUTUBE"].map((p) => (
                        <PlatformIcon key={p} platform={p} size={16} />
                      ))}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {b.agents.map((a) => (
                      <span key={a.role} title={a.task ?? undefined} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        <Dot tone={a.paused ? "warning" : a.status === "WORKING" ? "primary" : a.status === "ERROR" ? "danger" : "neutral"} pulse={a.status === "WORKING"} className="size-1.5" />
                        {a.role === "CUSTOMER_SUCCESS" ? "CS" : a.role[0] + a.role.slice(1).toLowerCase()}
                      </span>
                    ))}
                    {b.failed ? <Badge tone="danger">{b.failed} failed</Badge> : null}
                    {b.approvals ? <Badge tone="warning">{b.approvals} to approve</Badge> : null}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="mt-8 grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Which content made money</CardTitle>
              <CardDescription>Revenue attributed through tracked links, referral codes and platform referrals — observational, not causal.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2">
            {d.top.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Content</TH>
                    <TH className="text-right">Views</TH>
                    <TH className="text-right">Leads</TH>
                    <TH className="text-right">Sales</TH>
                    <TH className="text-right">Revenue</TH>
                  </TR>
                </THead>
                <TBody>
                  {d.top.map((c) => {
                    const w = d.wsMap[c.workspaceId];
                    return (
                      <TR key={c.id}>
                        <TD className="max-w-[340px]">
                          <Link href={`/w/${w?.slug}/content/${c.id}`} className="block truncate font-medium hover:underline">
                            {c.hook ?? c.title}
                          </Link>
                          <div className="flex items-center gap-1.5 text-[11px] text-subtle">
                            <span className="size-1.5 rounded-full" style={{ background: w?.color }} />
                            {w?.name} · #{c.number} · {c.templateId?.replace(/_/g, " ").toLowerCase()}
                          </div>
                        </TD>
                        <TD className="tabular text-right">{c.views == null ? "—" : compact(c.views)}</TD>
                        <TD className="tabular text-right">{c.leads}</TD>
                        <TD className="tabular text-right">{c.sales}</TD>
                        <TD className="tabular text-right font-medium">{money(c.revenueCents, w?.currency)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <EmptyState icon={Film} title="No published content in this period" description="Once videos are published and leads arrive, this table ranks content by attributed revenue." className="mx-3" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent sales</CardTitle>
              <CardDescription>Confirmed by payment webhook or manual entry</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 px-3">
            {d.sales.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No confirmed sales yet.</div> : null}
            {d.sales.map((s) => {
              const w = d.wsMap[s.workspaceId];
              return (
                <div key={s.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-success-soft text-success">
                    <CircleDollarSign className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">
                      {s.leadName || "Customer"} · {s.productName ?? "Sale"}
                    </div>
                    <div className="truncate text-[11px] text-subtle">
                      {w?.name} · {s.provider === "MANUAL" ? "manual" : s.provider.toLowerCase()} · {dateTime(s.approvedAt, w?.timezone)}
                      {s.isDemo ? " · demo" : ""}
                    </div>
                  </div>
                  <div className="tabular text-sm font-semibold text-success">{money(s.amountCents, s.currency)}</div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
      {hasDemo ? <p className="mt-6 text-center text-xs text-subtle">Demo businesses use simulated accounts, metrics and payments — clearly labeled DEMO and never mixed with LIVE data.</p> : null}
    </>
  );
}

