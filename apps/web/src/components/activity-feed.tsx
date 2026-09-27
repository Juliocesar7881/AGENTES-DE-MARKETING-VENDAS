import { Bot, CircleDollarSign, Cpu, Film, MessageCircle, Send, Settings2, UserRound, Zap } from "lucide-react";
import Link from "next/link";
import { ago, cn } from "@/lib/utils";

interface Activity {
  id: string;
  type: string;
  title: string;
  actorType: string;
  agentRole: string | null;
  createdAt: Date | string;
  entityType: string | null;
  entityId: string | null;
}

function iconFor(a: Activity) {
  if (/PAYMENT|SALE|REVENUE|CHECKOUT/.test(a.type)) return { Icon: CircleDollarSign, cls: "text-success bg-success-soft" };
  if (/RENDER/.test(a.type)) return { Icon: Cpu, cls: "text-primary bg-primary-soft" };
  if (/PUBLISH|POST/.test(a.type)) return { Icon: Send, cls: "text-info bg-info-soft" };
  if (/MESSAGE|REPLY|CONVERSATION/.test(a.type)) return { Icon: MessageCircle, cls: "text-info bg-info-soft" };
  if (/CONTENT|CREATIVE|STRATEG|QA/.test(a.type)) return { Icon: Film, cls: "text-primary bg-primary-soft" };
  if (/LEAD/.test(a.type)) return { Icon: UserRound, cls: "text-warning bg-warning-soft" };
  if (/MODE|AUTOPILOT|PAUSED|RESUMED/.test(a.type)) return { Icon: Zap, cls: "text-warning bg-warning-soft" };
  if (a.agentRole) return { Icon: Bot, cls: "text-primary bg-primary-soft" };
  return { Icon: Settings2, cls: "text-muted-foreground bg-muted" };
}

export function ActivityFeed({ items, workspace, slugOf }: { items: { a: Activity; wsName?: string; wsSlug?: string; wsColor?: string }[]; workspace?: boolean; slugOf?: string }) {
  if (!items.length) return <div className="py-8 text-center text-sm text-muted-foreground">No activity yet.</div>;
  return (
    <ol className="relative space-y-0.5">
      {items.map(({ a, wsName, wsSlug, wsColor }) => {
        const { Icon, cls } = iconFor(a);
        const slug = wsSlug ?? slugOf;
        const href = a.entityType === "content" && a.entityId && slug ? `/w/${slug}/content/${a.entityId}` : a.entityType === "lead" && a.entityId && slug ? `/w/${slug}/crm/${a.entityId}` : null;
        const body = (
          <div className="flex gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50">
            <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", cls)}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] leading-snug">{a.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-subtle">
                {!workspace && wsName ? (
                  <>
                    <span className="size-1.5 rounded-full" style={{ background: wsColor }} />
                    <span>{wsName}</span>
                    <span>·</span>
                  </>
                ) : null}
                <span>{a.agentRole ? `${a.agentRole.replace("_", " ").toLowerCase()} agent` : a.actorType.toLowerCase()}</span>
                <span>·</span>
                <span>{ago(a.createdAt)}</span>
              </div>
            </div>
          </div>
        );
        return <li key={a.id}>{href ? <Link href={href}>{body}</Link> : body}</li>;
      })}
    </ol>
  );
}
