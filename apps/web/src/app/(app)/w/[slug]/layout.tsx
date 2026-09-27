import type { ReactNode } from "react";
import { and, conversations, count, eq, gt, withUser } from "@revenueos/database";
import { WorkspaceHeaderActions } from "@/components/workspace/ws-header-actions";
import { WorkspaceTabs } from "@/components/workspace/ws-tabs";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { MODE } from "@/lib/status";
import { requireWorkspace } from "@/server/session";

export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, ws } = await requireWorkspace(slug);
  const counts = await withUser(user.id, async (tx) => {
    const [inbox] = await tx.select({ n: count() }).from(conversations).where(and(eq(conversations.workspaceId, ws.id), gt(conversations.unreadCount, 0)));
    return { inbox: Number(inbox?.n ?? 0) };
  });
  return (
    <>
      <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold text-white shadow-card" style={{ background: ws.color }}>
            {ws.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-[-0.02em]">{ws.name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {ws.environment === "DEMO" ? <Badge tone="info">DEMO · simulated</Badge> : <Badge tone="success">LIVE</Badge>}
              <StatusBadge map={MODE} value={ws.operatingMode} />
              {ws.status === "PAUSED" ? <Badge tone="warning">Paused</Badge> : null}
              <span>{ws.industry}</span>
              <span>·</span>
              <span>
                {ws.postsPerDay} posts/day at {ws.postingSchedule.join(", ")} ({ws.timezone})
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WorkspaceHeaderActions ws={{ id: ws.id, status: ws.status, environment: ws.environment }} />
        </div>
      </div>
      <WorkspaceTabs slug={ws.slug} counts={{ "/inbox": counts.inbox }} />
      {children}
    </>
  );
}
