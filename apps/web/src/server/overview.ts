import "server-only";
import { contentPerformance, dailySeries, recentSales, totals } from "@revenueos/core";
import { activities, agents, and, approvalRequests, contents, count, desc, eq, inArray, integrations, isNotNull, min, ne, socialAccounts, sql, withUser, workspaces } from "@revenueos/database";
import { listWorkspaces, requireUser, type Workspace } from "./session";

export interface ActionItem {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  kind: "SOCIAL" | "INTEGRATION" | "FAILED_CONTENT" | "APPROVAL";
  title: string;
  detail: string;
  href: string;
}

/** Everything the "All businesses" dashboard needs, scoped to the user's workspaces. */
export async function overviewData(days: number) {
  const user = await requireUser();
  const list = await listWorkspaces();
  const ids = list.map((w) => w.id);
  const from = new Date(Date.now() - days * 24 * 3600 * 1000);
  const tz = list[0]?.timezone ?? "America/Sao_Paulo";

  const [all, series, perWs, topContent, sales, rls] = await Promise.all([
    totals(ids, from),
    dailySeries(ids, days, tz),
    Promise.all(list.map(async (w) => ({ ws: w, totals: await totals([w.id], from), series: await dailySeries([w.id], 14, w.timezone) }))),
    contentPerformance(ids, { since: from, limit: 200 }),
    recentSales(ids, 8),
    withUser(user.id, async (tx) => {
      const agentRows = await tx.select({ ws: agents.workspaceId, role: agents.role, status: agents.status, paused: agents.paused, task: agents.currentTask }).from(agents);
      const next = await tx
        .select({ ws: contents.workspaceId, at: min(contents.scheduledFor) })
        .from(contents)
        .where(and(eq(contents.status, "SCHEDULED"), sql`${contents.scheduledFor} > now()`))
        .groupBy(contents.workspaceId);
      const ready = await tx
        .select({ ws: contents.workspaceId, n: count() })
        .from(contents)
        .where(inArray(contents.status, ["READY", "SCHEDULED"]))
        .groupBy(contents.workspaceId);
      const inProgress = await tx
        .select({ ws: contents.workspaceId, n: count() })
        .from(contents)
        .where(inArray(contents.status, ["IDEA", "PLANNING", "SCRIPTING", "GENERATING", "READY_TO_RENDER", "RENDERING", "RENDERED"]))
        .groupBy(contents.workspaceId);
      const feed = await tx
        .select({ a: activities, wsName: workspaces.name, wsSlug: workspaces.slug, wsColor: workspaces.color })
        .from(activities)
        .innerJoin(workspaces, eq(workspaces.id, activities.workspaceId))
        .orderBy(desc(activities.createdAt))
        .limit(14);
      const social = await tx
        .select({ ws: socialAccounts.workspaceId, platform: socialAccounts.platform, status: socialAccounts.status, username: socialAccounts.username, reason: socialAccounts.lastError })
        .from(socialAccounts)
        .where(and(eq(socialAccounts.enabled, true), ne(socialAccounts.status, "CONNECTED")));
      const integ = await tx
        .select({ ws: integrations.workspaceId, key: integrations.key, status: integrations.status })
        .from(integrations)
        .where(and(isNotNull(integrations.workspaceId), inArray(integrations.status, ["NEEDS_ACTION", "ERROR"])));
      const failed = await tx.select({ ws: contents.workspaceId, n: count() }).from(contents).where(eq(contents.status, "FAILED")).groupBy(contents.workspaceId);
      const approvals = await tx.select({ ws: approvalRequests.workspaceId, n: count() }).from(approvalRequests).where(eq(approvalRequests.status, "PENDING")).groupBy(approvalRequests.workspaceId);
      return { agentRows, next, ready, inProgress, feed, social, integ, failed, approvals };
    }),
  ]);

  const byWs = <T extends { ws: string | null }>(rows: T[], id: string) => rows.filter((r) => r.ws === id);
  const businesses = perWs.map(({ ws, totals: t, series: s }) => ({
    ws: pick(ws),
    totals: t,
    spark: s.map((p) => p.revenueCents),
    ready: Number(byWs(rls.ready, ws.id)[0]?.n ?? 0),
    inProgress: Number(byWs(rls.inProgress, ws.id)[0]?.n ?? 0),
    nextPostAt: byWs(rls.next, ws.id)[0]?.at ?? null,
    agents: byWs(rls.agentRows, ws.id).map((a) => ({ role: a.role, status: a.status, paused: a.paused, task: a.task })),
    failed: Number(byWs(rls.failed, ws.id)[0]?.n ?? 0),
    approvals: Number(byWs(rls.approvals, ws.id)[0]?.n ?? 0),
  }));

  const wsMap = new Map(list.map((w) => [w.id, w]));
  const actions: ActionItem[] = [];
  for (const s of rls.social) {
    const w = wsMap.get(s.ws);
    if (!w) continue;
    actions.push({ workspaceId: w.id, workspaceSlug: w.slug, workspaceName: w.name, kind: "SOCIAL", title: `${s.platform} @${s.username}: ${s.status.replace("_", " ").toLowerCase()}`, detail: s.reason ?? "Reconnect or review permissions.", href: `/w/${w.slug}/connections` });
  }
  for (const i of rls.integ) {
    const w = i.ws ? wsMap.get(i.ws) : null;
    if (!w) continue;
    actions.push({ workspaceId: w.id, workspaceSlug: w.slug, workspaceName: w.name, kind: "INTEGRATION", title: `${i.key} needs attention`, detail: i.status === "ERROR" ? "Connection test failed." : "Finish the connection setup.", href: `/w/${w.slug}/connections` });
  }
  for (const f of rls.failed) {
    const w = wsMap.get(f.ws);
    if (!w) continue;
    actions.push({ workspaceId: w.id, workspaceSlug: w.slug, workspaceName: w.name, kind: "FAILED_CONTENT", title: `${f.n} content item${Number(f.n) > 1 ? "s" : ""} failed`, detail: "Review the reason and retry or regenerate.", href: `/w/${w.slug}/content?status=FAILED` });
  }
  for (const a of rls.approvals) {
    const w = wsMap.get(a.ws);
    if (!w) continue;
    actions.push({ workspaceId: w.id, workspaceSlug: w.slug, workspaceName: w.name, kind: "APPROVAL", title: `${a.n} approval${Number(a.n) > 1 ? "s" : ""} waiting`, detail: "Publishing or checkout links need your OK (Assisted mode).", href: `/approvals` });
  }

  const top = [...topContent].sort((a, b) => b.revenueCents - a.revenueCents || b.leads - a.leads).slice(0, 8);
  return { user, all, series, businesses, top, sales, feed: rls.feed, actions, wsMap: Object.fromEntries(list.map((w) => [w.id, pick(w)])) };
}

function pick(w: Workspace) {
  return { id: w.id, slug: w.slug, name: w.name, color: w.color, environment: w.environment, status: w.status, operatingMode: w.operatingMode, targetReadyBuffer: w.targetReadyBuffer, currency: w.currency, timezone: w.timezone, postingSchedule: w.postingSchedule };
}
