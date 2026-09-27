import type { Metadata } from "next";
import Link from "next/link";
import { JOB_TYPES } from "@revenueos/shared";
import { and, count, desc, eq, jobs, sql, withUser, workspaces } from "@revenueos/database";
import { AutoRefresh } from "@/components/auto-refresh";
import { RetryJobButton } from "@/components/retry-job-button";
import { StatusBadge } from "@/components/status-badge";
import { Badge, Dot } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui/misc";
import { JOB_STATUS } from "@/lib/status";
import { ago, cn, dateTime } from "@/lib/utils";
import { workerStatuses } from "@/server/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Jobs" };

const STATUS_FILTERS = ["ALL", "QUEUED", "RUNNING", "RETRYING", "FAILED", "COMPLETED", "CANCELLED"] as const;

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = (STATUS_FILTERS as readonly string[]).includes(sp.status ?? "") ? sp.status! : "ALL";
  const type = (JOB_TYPES as readonly string[]).includes(sp.type ?? "") ? sp.type! : null;
  const [workers, d] = await Promise.all([
    workerStatuses(),
    withUser(user.id, async (tx) => {
      const conds = [];
      if (status !== "ALL") conds.push(eq(jobs.status, status as (typeof jobs.$inferSelect)["status"]));
      if (type) conds.push(eq(jobs.type, type as (typeof jobs.$inferSelect)["type"]));
      const rows = await tx
        .select({ j: jobs, ws: workspaces.name, slug: workspaces.slug })
        .from(jobs)
        .leftJoin(workspaces, eq(workspaces.id, jobs.workspaceId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(sql`CASE ${jobs.status} WHEN 'RUNNING' THEN 0 WHEN 'FAILED' THEN 1 WHEN 'RETRYING' THEN 2 WHEN 'QUEUED' THEN 3 ELSE 4 END`, desc(jobs.updatedAt))
        .limit(150);
      const counts = await tx.select({ status: jobs.status, n: count() }).from(jobs).groupBy(jobs.status);
      return { rows, counts };
    }),
  ]);
  const cnt = (s: string) => (s === "ALL" ? d.counts.reduce((a, c) => a + Number(c.n), 0) : Number(d.counts.find((c) => c.status === s)?.n ?? 0));
  const pendingLocal = d.rows.filter((r) => r.j.runner === "LOCAL" && ["QUEUED", "RETRYING"].includes(r.j.status)).length;

  return (
    <>
      <AutoRefresh ms={8000} />
      <PageHeader title="Jobs" description="Every unit of work — strategy, creative, render, publish, sales replies, attribution — is a persisted job with retries and backoff. Nothing disappears silently." />
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        {workers.length === 0 ? (
          <Card>
            <CardContent className="pt-4 text-[13px]">
              <div className="font-medium">No local worker has connected yet</div>
              <p className="text-muted-foreground">
                Renders and AI generation wait in the queue until the worker runs. Windows: run <code className="font-mono">setup-worker.bat</code> then <code className="font-mono">start-worker.bat</code>.{" "}
                <Link href="/settings?tab=worker" className="text-primary hover:underline">
                  Worker settings
                </Link>
              </p>
            </CardContent>
          </Card>
        ) : (
          workers.slice(0, 2).map((w) => (
            <Card key={w.id}>
              <CardContent className="flex items-center justify-between gap-3 pt-4">
                <div className="flex items-center gap-3">
                  <Dot tone={!w.online ? "danger" : w.paused ? "warning" : "success"} pulse={w.online && w.currentJobs.length > 0} />
                  <div>
                    <div className="text-[13px] font-medium">{w.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {w.online ? (w.paused ? "paused" : `${w.currentJobs.length} running`) : `offline · last seen ${ago(w.lastHeartbeatAt)}`} · v{w.version} · {w.platform}
                    </div>
                  </div>
                </div>
                <div className="text-right text-[11px] text-muted-foreground">
                  {String((w.stats as { renderedToday?: number }).renderedToday ?? 0)} renders today
                  <div>{w.currentJobs.map((j) => j.type.toLowerCase().replace(/_/g, " ")).join(", ")}</div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      {pendingLocal > 0 && !workers.some((w) => w.online) ? <p className="mb-3 text-[13px] text-warning">{pendingLocal} local job(s) are queued and will run as soon as the worker is online.</p> : null}
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {STATUS_FILTERS.map((s) => (
          <Link key={s} href={`/jobs?status=${s}${type ? `&type=${type}` : ""}`} className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-muted", status === s && "bg-muted text-foreground")}>
            {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            <span className="tabular text-[11px] text-subtle">{cnt(s)}</span>
          </Link>
        ))}
        {type ? (
          <Link href={`/jobs?status=${status}`} className="ml-2 text-xs text-primary hover:underline">
            clear type filter ({type})
          </Link>
        ) : null}
      </div>
      <div className="rounded-xl border border-border bg-card">
        <Table>
          <THead>
            <TR>
              <TH>Type</TH>
              <TH>Business</TH>
              <TH>Runner</TH>
              <TH>Status</TH>
              <TH>Attempts</TH>
              <TH>Scheduled</TH>
              <TH>Detail</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {d.rows.map(({ j, ws, slug }) => (
              <TR key={j.id}>
                <TD>
                  <Link href={`/jobs?status=${status}&type=${j.type}`} className="font-mono text-[12px] hover:underline">
                    {j.type}
                  </Link>
                  <div className="text-[10px] text-subtle">{String(j.payload.origin ?? "automation").toLowerCase()}</div>
                </TD>
                <TD className="text-[12px]">{slug ? <Link href={`/w/${slug}`} className="hover:underline">{ws}</Link> : <span className="text-subtle">system</span>}</TD>
                <TD>
                  <Badge tone={j.runner === "LOCAL" ? "primary" : "neutral"}>{j.runner.toLowerCase()}</Badge>
                </TD>
                <TD>
                  <StatusBadge map={JOB_STATUS} value={j.status} />
                </TD>
                <TD className="tabular text-[12px]">
                  {j.attempts}/{j.maxAttempts}
                </TD>
                <TD className="text-[12px] whitespace-nowrap text-muted-foreground">{j.status === "COMPLETED" ? `done ${ago(j.completedAt)}` : dateTime(j.scheduledAt)}</TD>
                <TD className="max-w-[340px] text-[12px]">
                  {j.lastError ? <span className="line-clamp-2 text-danger">{j.lastError}</span> : j.result && Object.keys(j.result).length ? <span className="line-clamp-1 font-mono text-[11px] text-subtle">{JSON.stringify(j.result).slice(0, 140)}</span> : null}
                </TD>
                <TD>{j.status === "FAILED" || j.status === "CANCELLED" ? <RetryJobButton id={j.id} /> : null}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {d.rows.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No jobs match.</p> : null}
      </div>
    </>
  );
}
