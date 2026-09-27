import { MessagesSquare } from "lucide-react";
import Link from "next/link";
import { conversations, desc, eq, leads, sql, withUser } from "@revenueos/database";
import { AutoRefresh } from "@/components/auto-refresh";
import { Thread } from "@/components/inbox/thread";
import { PlatformIcon } from "@/components/platform-icon";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { ago, cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/session";

export default async function InboxPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ c?: string; f?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { user, ws } = await requireWorkspace(slug);
  const filter = sp.f === "human" ? "human" : sp.f === "unread" ? "unread" : "all";
  const rows = await withUser(user.id, (tx) =>
    tx
      .select({
        c: conversations,
        name: leads.name,
        stage: leads.stage,
        score: leads.score,
        dnc: leads.doNotContact,
        last: sql<string | null>`(SELECT m.body FROM messages m WHERE m.conversation_id = "conversations"."id" ORDER BY m.created_at DESC LIMIT 1)`,
      })
      .from(conversations)
      .innerJoin(leads, eq(leads.id, conversations.leadId))
      .where(
        filter === "human"
          ? sql`${conversations.workspaceId} = ${ws.id} AND ${conversations.aiMode} <> 'AI'`
          : filter === "unread"
            ? sql`${conversations.workspaceId} = ${ws.id} AND ${conversations.unreadCount} > 0`
            : eq(conversations.workspaceId, ws.id),
      )
      .orderBy(desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`))
      .limit(200),
  );
  const selected = rows.find((r) => r.c.id === sp.c)?.c.id ?? rows[0]?.c.id ?? null;

  if (rows.length === 0 && filter === "all") {
    return <EmptyState icon={MessagesSquare} title="No conversations yet" description="Messages from WhatsApp, Instagram Direct and the lead form appear here. The Sales Agent replies automatically within the rules you set." />;
  }

  return (
    <div className="grid h-[calc(100dvh-260px)] min-h-[520px] overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[320px_1fr]">
      <AutoRefresh ms={15000} />
      <div className="flex min-h-0 flex-col border-r border-border">
        <div className="flex gap-1 border-b border-border p-2">
          {[
            ["all", "All"],
            ["unread", "Unread"],
            ["human", "Needs you"],
          ].map(([k, label]) => (
            <Link key={k} href={`/w/${slug}/inbox?f=${k}`} className={cn("rounded-md px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted", filter === k && "bg-muted text-foreground")}>
              {label}
            </Link>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((r) => (
            <Link key={r.c.id} href={`/w/${slug}/inbox?f=${filter}&c=${r.c.id}`} className={cn("flex gap-3 border-b border-border px-3 py-3 transition-colors hover:bg-muted/50", selected === r.c.id && "bg-muted")}>
              <PlatformIcon platform={r.c.channel} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn("truncate text-[13px]", r.c.unreadCount > 0 ? "font-semibold" : "font-medium")}>{r.name || "Lead"}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-subtle">{ago(r.c.lastMessageAt ?? r.c.createdAt)}</span>
                </div>
                <div className="truncate text-[12px] text-muted-foreground">{r.last ?? "—"}</div>
                <div className="mt-1 flex items-center gap-1">
                  {r.c.aiMode !== "AI" ? <Badge tone={r.c.aiMode === "HUMAN" ? "info" : "warning"}>{r.c.aiMode === "HUMAN" ? "you" : "AI paused"}</Badge> : <Badge tone="success">AI</Badge>}
                  <Badge>{r.stage.toLowerCase()}</Badge>
                  {r.dnc ? <Badge tone="danger">DNC</Badge> : null}
                  {r.c.unreadCount > 0 ? <span className="ml-auto grid size-4 place-items-center rounded-full bg-primary text-[9px] font-bold text-white">{r.c.unreadCount}</span> : null}
                </div>
              </div>
            </Link>
          ))}
          {rows.length === 0 ? <p className="p-4 text-center text-sm text-muted-foreground">Nothing here.</p> : null}
        </div>
      </div>
      <div className="hidden min-h-0 md:block">{selected ? <Thread key={selected} conversationId={selected} slug={slug} timezone={ws.timezone} /> : null}</div>
    </div>
  );
}
