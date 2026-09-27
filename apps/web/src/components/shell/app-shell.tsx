"use client";
import { Cpu, LogOut, Menu, Moon, OctagonX, Search, Sparkles, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { useTheme } from "@/components/theme";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import type { ShellData } from "@/server/queries";
import { logoutAction } from "@/server/actions/auth";
import { emergencyStopAction, simulateDayAction } from "@/server/actions/global";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { Avatar, Kbd } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { ago, cn } from "@/lib/utils";
import { CommandPalette } from "./command-palette";
import { Notifications } from "./notifications";
import { Sidebar } from "./sidebar";

export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-border bg-sidebar lg:block">
        <Sidebar data={data} />
      </aside>
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-sidebar lg:hidden">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Main navigation</DialogPrimitive.Description>
            <Sidebar data={data} onNavigate={() => setMobileOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <div className="flex min-w-0 flex-1 flex-col">
        {data.emergencyStop ? <EmergencyBanner /> : null}
        <TopBar data={data} onMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
      <CommandPalette data={data} />
    </div>
  );
}

function EmergencyBanner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center justify-center gap-3 bg-danger px-4 py-2 text-sm font-medium text-white">
      <OctagonX className="size-4" />
      EMERGENCY STOP is active — no publishing, messages or checkouts are being sent. Payments and attribution keep running.
      <button
        className="rounded bg-white/20 px-2 py-0.5 text-xs font-semibold hover:bg-white/30"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (!confirm("Lift the emergency stop and resume automation?")) return;
            const r = await emergencyStopAction(false);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
            router.refresh();
          })
        }
      >
        Resume
      </button>
    </div>
  );
}

function TopBar({ data, onMenu }: { data: ShellData; onMenu: () => void }) {
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  const [simulating, startSim] = useTransition();
  const [stopping, startStop] = useTransition();
  const hasDemo = data.workspaces.some((w) => w.environment === "DEMO");
  const hasLive = data.workspaces.some((w) => w.environment === "LIVE");
  const w = data.worker;
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur-md md:px-8">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu />
      </Button>
      <button
        onClick={() => window.dispatchEvent(new Event("rvos:command"))}
        className="flex h-8 w-full max-w-xs items-center gap-2 rounded-md border border-border bg-card px-2.5 text-[13px] text-subtle shadow-card transition hover:border-border-strong"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-1.5">
        {hasDemo || hasLive ? (
          <Tooltip content={hasDemo && hasLive ? "You have LIVE businesses (real publishing) and DEMO businesses (simulated)." : hasDemo ? "Demo mode: simulated accounts, nothing is published for real." : "Live: real accounts, real publishing."}>
            <span className={cn("hidden h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold tracking-wide sm:inline-flex", hasLive ? "border-success/30 text-success" : "border-info/30 text-info")}>
              <Dot tone={hasLive ? "success" : "info"} />
              {hasLive && hasDemo ? "LIVE + DEMO" : hasLive ? "LIVE" : "DEMO"}
            </span>
          </Tooltip>
        ) : null}
        <Tooltip content={w.online ? `${w.name} — ${w.paused ? "paused" : w.jobs ? `${w.jobs} job(s) running` : "idle"}` : `Local worker offline${"lastSeen" in w && w.lastSeen ? ` (last seen ${ago(w.lastSeen)})` : ""}. Renders wait in the queue.`}>
          <Link href="/settings?tab=worker" className="hidden h-6 items-center gap-1.5 rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground sm:inline-flex">
            <Cpu className="size-3.5" />
            <Dot tone={!w.online ? "danger" : w.paused ? "warning" : "success"} pulse={w.online && w.jobs > 0} />
            {!w.online ? "Worker offline" : w.paused ? "Worker paused" : w.jobs ? "Rendering" : "Worker online"}
          </Link>
        </Tooltip>
        {hasDemo ? (
          <Button
            variant="secondary"
            size="sm"
            loading={simulating}
            className="hidden md:inline-flex"
            onClick={() =>
              startSim(async () => {
                const id = toast.loading("Simulating a full day on the demo businesses…");
                const r = await simulateDayAction();
                toast.dismiss(id);
                if (r.ok) {
                  const sales = r.data.workspaces.reduce((s, x) => s + x.sales, 0);
                  toast.success(`Day simulated: ${r.data.workspaces.reduce((s, x) => s + x.published, 0)} posts, ${r.data.workspaces.reduce((s, x) => s + x.leads, 0)} leads, ${sales} sales (DEMO data)`);
                } else toast.error(r.error);
                router.refresh();
              })
            }
          >
            <Sparkles /> Simulate Day
          </Button>
        ) : null}
        <Tooltip content={data.emergencyStop ? "Emergency stop is active" : "Emergency stop: halt all outbound automation"}>
          <Button
            variant={data.emergencyStop ? "danger" : "danger-outline"}
            size="sm"
            loading={stopping}
            onClick={() =>
              startStop(async () => {
                if (!confirm(data.emergencyStop ? "Lift the emergency stop and resume automation?" : "EMERGENCY STOP: halt all publishing, messages and checkouts in every business now?")) return;
                const r = await emergencyStopAction(!data.emergencyStop);
                if (r.ok) toast.success(r.data.scope === "DEMO_WORKSPACES" ? "Demo businesses paused" : r.message);
                else toast.error(r.error);
                router.refresh();
              })
            }
          >
            <OctagonX /> <span className="hidden xl:inline">{data.emergencyStop ? "Stopped" : "Stop all"}</span>
          </Button>
        </Tooltip>
        <Notifications initialUnread={data.unread} />
        <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          {resolvedTheme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
              <Avatar name={data.user.name} size={28} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>
              <div className="text-sm font-medium text-foreground">{data.user.name}</div>
              <div className="text-xs font-normal">{data.user.email}</div>
              {data.user.isDemo ? <div className="mt-1 text-[11px] text-info">Demo account</div> : data.user.isAdmin ? <div className="mt-1 text-[11px] text-primary">Administrator</div> : null}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings?tab=account">
                <UserRound /> Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={() => void logoutAction()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
