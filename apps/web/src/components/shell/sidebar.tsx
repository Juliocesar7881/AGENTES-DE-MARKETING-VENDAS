"use client";
import { Bot, CircleCheck, LayoutDashboard, LifeBuoy, ListChecks, Plus, Rocket, Settings, Workflow, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ShellData } from "@/server/queries";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

function NavLink({ href, icon: Icon, label, count, exact }: { href: string; icon: typeof Bot; label: string; count?: number; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground",
      )}
    >
      <Icon className={cn("size-4 shrink-0 text-subtle group-hover:text-foreground", active && "text-foreground")} />
      <span className="truncate">{label}</span>
      {count ? <span className="ml-auto rounded bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground">{count}</span> : null}
    </Link>
  );
}

export function Sidebar({ data, onNavigate }: { data: ShellData; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <div className="flex h-full flex-col" onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate?.()}>
      <div className="flex h-14 items-center px-4">
        <Link href="/overview" aria-label="RevenueOS home">
          <Logo />
        </Link>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pt-2 pb-4">
        <div className="space-y-0.5">
          <NavLink href="/overview" icon={LayoutDashboard} label="All businesses" exact />
          <NavLink href="/autopilot" icon={Zap} label="Autopilot" />
          <NavLink href="/agents" icon={Bot} label="Agents" />
          <NavLink href="/approvals" icon={CircleCheck} label="Approvals" count={data.approvals} />
          <NavLink href="/jobs" icon={Workflow} label="Jobs" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-[11px] font-medium tracking-wide text-subtle uppercase">Businesses</span>
            <Link href="/onboarding" className="rounded p-0.5 text-subtle hover:bg-muted hover:text-foreground" aria-label="New business">
              <Plus className="size-3.5" />
            </Link>
          </div>
          <div className="space-y-0.5">
            {data.workspaces.map((w, i) => {
              const active = path.startsWith(`/w/${w.slug}`);
              return (
                <Link
                  key={w.id}
                  href={`/w/${w.slug}`}
                  className={cn("flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", active && "bg-muted text-foreground")}
                >
                  <span className="grid size-4 shrink-0 place-items-center rounded text-[9px] font-bold text-white" style={{ background: w.color }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="truncate">{w.name}</span>
                  <span className="ml-auto flex items-center gap-1">
                    {w.status === "PAUSED" ? <Badge tone="warning">Paused</Badge> : null}
                    {w.environment === "DEMO" ? <Badge tone="info">Demo</Badge> : null}
                  </span>
                </Link>
              );
            })}
            {data.workspaces.length === 0 ? (
              <Link href="/onboarding" className="flex h-8 items-center gap-2 rounded-md border border-dashed border-border px-2 text-[13px] text-muted-foreground hover:text-foreground">
                <Rocket className="size-4" /> Create your first business
              </Link>
            ) : null}
          </div>
        </div>
      </nav>
      <div className="space-y-0.5 border-t border-border px-3 py-3">
        {data.user.isAdmin ? <NavLink href="/setup" icon={ListChecks} label="Setup" /> : null}
        <NavLink href="/settings" icon={Settings} label="Settings" />
        <NavLink href="/help/connections" icon={LifeBuoy} label="Help · Connections" />
      </div>
    </div>
  );
}
