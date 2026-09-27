"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/badge";
import { markNotificationsReadAction } from "@/server/actions/global";
import { ago, cn } from "@/lib/utils";

interface Item {
  id: string;
  title: string;
  body: string;
  link: string | null;
  severity: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  type: string;
  readAt: string | null;
  createdAt: string;
}

const TONE = { INFO: "info", SUCCESS: "success", WARNING: "warning", ERROR: "danger" } as const;

export function Notifications({ initialUnread }: { initialUnread: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await fetch("/api/notifications").then((r) => r.json())) as { items: Item[]; unread: number },
    refetchInterval: 20_000,
  });
  const unread = data?.unread ?? initialUnread;
  const markAll = async () => {
    await markNotificationsReadAction("all");
    await qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Notifications (${unread} unread)`} className="relative">
          <Bell />
          {unread > 0 ? <span className="absolute top-1 right-1 grid min-w-3.5 place-items-center rounded-full bg-danger px-1 text-[9px] leading-3.5 font-bold text-white">{unread > 99 ? "99+" : unread}</span> : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[380px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            <Button variant="ghost" size="xs" onClick={markAll} disabled={!unread}>
              <CheckCheck /> Mark all read
            </Button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {(data?.items ?? []).length === 0 ? <div className="px-4 py-10 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div> : null}
            {(data?.items ?? []).map((n) => {
              const inner = (
                <div className={cn("flex gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-muted/60", !n.readAt && "bg-primary-soft/40")}>
                  <Dot tone={TONE[n.severity]} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-snug font-medium">{n.title}</div>
                    {n.body ? <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</div> : null}
                    <div className="mt-1 text-[11px] text-subtle">{ago(n.createdAt)}</div>
                  </div>
                </div>
              );
              return n.link ? (
                <Popover.Close asChild key={n.id}>
                  <Link href={n.link} onClick={() => void markNotificationsReadAction([n.id])}>
                    {inner}
                  </Link>
                </Popover.Close>
              ) : (
                <div key={n.id}>{inner}</div>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
