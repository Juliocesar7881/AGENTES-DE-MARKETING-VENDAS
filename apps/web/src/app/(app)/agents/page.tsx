import type { Metadata } from "next";
import Link from "next/link";
import { aiSpend } from "@revenueos/core";
import { activities, agentRuns, agents, desc, eq, gte, sql, withUser, workspaces } from "@revenueos/database";
import { ActivityFeed } from "@/components/activity-feed";
import { AutoRefresh } from "@/components/auto-refresh";
import { AgentsPanel } from "@/components/workspace/agents-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui/misc";
import { AGENT_LABEL } from "@/lib/status";
import { ago, usd } from "@/lib/utils";
import { listWorkspaces, requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  const user = await requireUser();
  const list = await listWorkspaces();
  const since7 = new Date(Date.now() - 7 * 86400_000);
  const [spend, d] = await Promise.all([
    aiSpend(list.map((w) => w.id), since7),
    withUser(user.id, async (tx) => ({
      agentRows: await tx.select().from(agents),
      runs: await tx
        .select({ r: agentRuns, ws: workspaces.name, slug: workspaces.slug, color: workspaces.color })
        .from(agentRuns)
        .leftJoin(workspaces, eq(workspaces.id, agentRuns.workspaceId))
        .orderBy(desc(agentRuns.createdAt))
        .limit(40),
      stats: await tx
        .select({ ws: agentRuns.workspaceId, role: agentRuns.agentRole, n: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${agentRuns.costUsd}),0)::float` })
        .from(agentRuns)
        .where(gte(agentRuns.createdAt, since7))
        .groupBy(agentRuns.workspaceId, agentRuns.agentRole),
      feed: await tx
        .select({ a: activities, wsName: workspaces.name, wsSlug: workspaces.slug, wsColor: workspaces.color })
        .from(activities)
        .innerJoin(workspaces, eq(workspaces.id, activities.workspaceId))
        .where(sql`${activities.agentRole} IS NOT NULL`)
        .orderBy(desc(activities.createdAt))
        .limit(20),
    })),
  ]);
  return (
    <>
      <AutoRefresh ms={10000} />
      <PageHeader title="Agents command center" description="Five agents per business — Strategist, Creative, Growth, Sales and Customer Success. Each runs only within its business's data." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((w) => (
          <Card key={w.id}>
            <CardHeader className="pb-1">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-sm" style={{ background: w.color }} />
                <Link href={`/w/${w.slug}`} className="text-sm font-semibold hover:underline">
                  {w.name}
                </Link>
                {w.environment === "DEMO" ? <Badge tone="info">Demo</Badge> : null}
              </div>
            </CardHeader>
            <CardContent className="pb-2">
              <AgentsPanel
                compact
                workspaceId={w.id}
                agents={d.agentRows
                  .filter((a) => a.workspaceId === w.id)
                  .map((a) => {
                    const st = d.stats.find((s) => s.ws === w.id && s.role === a.role);
                    return { role: a.role, status: a.status, paused: a.paused, currentTask: a.currentTask, lastRunAt: a.lastRunAt?.toISOString() ?? null, lastError: a.lastError, runs7d: st?.n ?? 0, cost7d: st?.cost ?? 0 };
                  })}
              />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent agent runs</CardTitle>
              <CardDescription>Every AI call is logged with prompt version, model, tokens and cost.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2">
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Agent</TH>
                  <TH>Task</TH>
                  <TH>Model</TH>
                  <TH className="text-right">Tokens</TH>
                  <TH className="text-right">Cost</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {d.runs.map(({ r, ws }) => (
                  <TR key={r.id}>
                    <TD className="text-[12px] whitespace-nowrap text-muted-foreground">{ago(r.createdAt)}</TD>
                    <TD className="text-[12px]">
                      {AGENT_LABEL[r.agentRole]?.name ?? r.agentRole}
                      <div className="text-[10px] text-subtle">{ws}</div>
                    </TD>
                    <TD className="max-w-[260px] truncate text-[12px]" title={r.inputSummary}>
                      {r.task}
                    </TD>
                    <TD className="font-mono text-[11px]">
                      {r.model}
                      <div className="text-[10px] text-subtle">
                        {r.provider} · {r.promptVersion}
                      </div>
                    </TD>
                    <TD className="tabular text-right text-[12px]">
                      {r.inputTokens + r.cacheReadTokens}/{r.outputTokens}
                      {r.cacheReadTokens ? <div className="text-[10px] text-success">{Math.round((r.cacheReadTokens / Math.max(1, r.inputTokens + r.cacheReadTokens)) * 100)}% cached</div> : null}
                    </TD>
                    <TD className="tabular text-right text-[12px]">{usd(r.costUsd)}</TD>
                    <TD>{r.status === "SUCCESS" ? <Badge tone="success">ok</Badge> : <Badge tone="danger" title={r.error ?? undefined}>error</Badge>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>AI spend · 7 days</CardTitle>
                <CardDescription>{usd(spend.total)} across all businesses</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-[13px]">
              {spend.byAgent.map((a) => (
                <div key={a.agent} className="flex justify-between">
                  <span>{AGENT_LABEL[a.agent]?.name ?? a.agent}</span>
                  <span className="tabular">{usd(a.cost)}</span>
                </div>
              ))}
              {spend.byAgent.length === 0 ? <p className="text-muted-foreground">No usage yet.</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Agent activity</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[480px] overflow-y-auto px-3">
              <ActivityFeed items={d.feed} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
