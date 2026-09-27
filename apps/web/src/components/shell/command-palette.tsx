"use client";
import { Command } from "cmdk";
import { Bot, CircleCheck, LayoutDashboard, LifeBuoy, Moon, OctagonX, Plus, Search, Settings, Sparkles, Sun, Workflow, Zap } from "lucide-react";
import { useTheme } from "@/components/theme";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { ShellData } from "@/server/queries";
import { emergencyStopAction, simulateDayAction } from "@/server/actions/global";
import { Kbd } from "@/components/ui/misc";

const SECTIONS = [
  ["", "Overview"],
  ["/content", "Content Studio"],
  ["/calendar", "Calendar"],
  ["/crm", "CRM"],
  ["/inbox", "Inbox"],
  ["/sales", "Sales"],
  ["/analytics", "Analytics"],
  ["/brand", "Brand Kit"],
  ["/products", "Products"],
  ["/connections", "Connections"],
  ["/settings", "Settings"],
] as const;

export function CommandPalette({ data }: { data: ShellData }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("rvos:command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("rvos:command", onOpen);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const hasDemo = data.workspaces.some((w) => w.environment === "DEMO");

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-pop outline-none">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search pages, businesses and actions</DialogPrimitive.Description>
          <Command loop className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 text-subtle" />
              <Command.Input autoFocus placeholder="Search businesses, pages and actions…" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle" />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
              <Command.Empty className="py-10 text-center text-sm text-muted-foreground">No results.</Command.Empty>
              <Command.Group heading="Navigate">
                <Item icon={<LayoutDashboard />} onSelect={() => go("/overview")}>All businesses</Item>
                <Item icon={<Zap />} onSelect={() => go("/autopilot")}>Autopilot</Item>
                <Item icon={<Bot />} onSelect={() => go("/agents")}>Agents command center</Item>
                <Item icon={<CircleCheck />} onSelect={() => go("/approvals")}>Approvals</Item>
                <Item icon={<Workflow />} onSelect={() => go("/jobs")}>Jobs</Item>
                <Item icon={<Settings />} onSelect={() => go("/settings")}>Settings</Item>
                <Item icon={<LifeBuoy />} onSelect={() => go("/help/connections")}>Help · Connections</Item>
              </Command.Group>
              {data.workspaces.map((w) => (
                <Command.Group key={w.id} heading={w.name}>
                  {SECTIONS.map(([path, label]) => (
                    <Item key={path} value={`${w.name} ${label}`} icon={<span className="size-2.5 rounded-sm" style={{ background: w.color }} />} onSelect={() => go(`/w/${w.slug}${path}`)}>
                      {label}
                      <span className="ml-auto text-xs text-subtle">{w.name}</span>
                    </Item>
                  ))}
                </Command.Group>
              ))}
              <Command.Group heading="Actions">
                <Item icon={<Plus />} onSelect={() => go("/onboarding")}>New business</Item>
                {hasDemo ? (
                  <Item
                    icon={<Sparkles />}
                    onSelect={() => {
                      setOpen(false);
                      toast.promise(simulateDayAction(), { loading: "Simulating a full day on the demo businesses…", success: (r) => (r.ok ? "Day simulated — check the dashboard" : r.error), error: "Simulation failed" });
                    }}
                  >
                    Simulate Day (demo)
                  </Item>
                ) : null}
                <Item icon={resolvedTheme === "dark" ? <Sun /> : <Moon />} onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                  Toggle theme
                </Item>
                <Item
                  icon={<OctagonX className="text-danger" />}
                  onSelect={async () => {
                    setOpen(false);
                    if (!confirm(data.emergencyStop ? "Lift the emergency stop and resume automation?" : "EMERGENCY STOP: halt all publishing, messages and checkouts in every business?")) return;
                    const r = await emergencyStopAction(!data.emergencyStop);
                    if (r.ok) toast.success(r.message);
                    else toast.error(r.error);
                    router.refresh();
                  }}
                >
                  {data.emergencyStop ? "Lift emergency stop" : "Emergency stop"}
                </Item>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Item({ children, icon, onSelect, value }: { children: ReactNode; icon: ReactNode; onSelect: () => void; value?: string }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground aria-selected:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      {children}
    </Command.Item>
  );
}
