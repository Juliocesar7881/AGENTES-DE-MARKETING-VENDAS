"use client";
import { OctagonX, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { AUTOPILOT_PERMISSION_KEYS, AUTOPILOT_PERMISSION_LABELS, type AutopilotPermissions, type OperatingMode } from "@revenueos/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { emergencyStopAction } from "@/server/actions/global";
import { setModeAction, setWorkspaceStatusAction, updateWorkspaceSection } from "@/server/actions/workspace";

export interface AutopilotRow {
  id: string;
  name: string;
  slug: string;
  color: string;
  environment: string;
  status: string;
  mode: OperatingMode;
  permissions: AutopilotPermissions;
}

export function AutopilotMatrix({ rows, emergency, canLift }: { rows: AutopilotRow[]; emergency: { active: boolean; at: string | null }; canLift: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Saved");
      else toast.error(r.error ?? "Failed");
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <Card className={cn(emergency.active ? "border-danger bg-danger-soft" : "border-danger/30")}>
        <CardContent className="flex flex-col gap-4 pt-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <span className={cn("grid size-11 place-items-center rounded-xl", emergency.active ? "bg-danger text-white" : "bg-danger-soft text-danger")}>
              <OctagonX className="size-6" />
            </span>
            <div>
              <div className="text-base font-semibold">Global emergency stop</div>
              <p className="max-w-xl text-[13px] text-muted-foreground">
                {emergency.active
                  ? `Active since ${emergency.at ? new Date(emergency.at).toLocaleString("pt-BR") : "now"}. No publishing, sales messages or checkout links in any business. Payment webhooks, attribution and rendering continue.`
                  : "Instantly halts every outbound action in every business: publishing, sales messages, follow-ups and checkout links. Payment confirmations and attribution keep working."}
              </p>
            </div>
          </div>
          {emergency.active ? (
            <Button variant="success" size="lg" loading={pending} disabled={!canLift} onClick={() => confirm("Lift the emergency stop and resume automation?") && run(() => emergencyStopAction(false))}>
              <Play /> Resume automation
            </Button>
          ) : (
            <Button variant="danger" size="lg" loading={pending} onClick={() => confirm("EMERGENCY STOP: halt all outbound automation in every business now?") && run(() => emergencyStopAction(true))}>
              <OctagonX /> Stop everything
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">Business</th>
              <th className="px-2 py-3 text-left font-medium">Mode</th>
              <th className="px-2 py-3 text-left font-medium">Running</th>
              {AUTOPILOT_PERMISSION_KEYS.map((k) => (
                <th key={k} className="px-1 py-3 text-center text-[10px] font-medium leading-tight">
                  {AUTOPILOT_PERMISSION_LABELS[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-sm" style={{ background: w.color }} />
                    <span className="font-medium">{w.name}</span>
                    {w.environment === "DEMO" ? <Badge tone="info">Demo</Badge> : null}
                  </div>
                </td>
                <td className="px-2 py-3">
                  <Select className="h-8 w-32 text-xs" value={w.mode} disabled={pending} onChange={(e) => run(() => setModeAction(w.id, e.target.value as OperatingMode))}>
                    <option value="MANUAL">Manual</option>
                    <option value="ASSISTED">Assisted</option>
                    <option value="AUTOPILOT">Autopilot</option>
                  </Select>
                </td>
                <td className="px-2 py-3">
                  <Switch checked={w.status === "ACTIVE"} disabled={pending} aria-label={`${w.name} running`} onCheckedChange={(on) => run(() => setWorkspaceStatusAction(w.id, on ? "ACTIVE" : "PAUSED"))} />
                </td>
                {AUTOPILOT_PERMISSION_KEYS.map((k) => (
                  <td key={k} className="px-1 py-3 text-center">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-[var(--primary)] disabled:opacity-40"
                      checked={w.permissions[k] !== false}
                      disabled={pending || w.mode === "MANUAL"}
                      aria-label={`${w.name}: ${AUTOPILOT_PERMISSION_LABELS[k]}`}
                      onChange={(e) => run(() => updateWorkspaceSection(w.id, "permissions", { [k]: e.target.checked }))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 text-[13px] text-muted-foreground md:grid-cols-3">
        <p>
          <strong className="text-foreground">Manual</strong> — nothing happens automatically; every action is a click.
        </p>
        <p>
          <strong className="text-foreground">Assisted</strong> — agents create and reply, but publishing and checkout links wait in Approvals.
        </p>
        <p>
          <strong className="text-foreground">Autopilot</strong> — agents act alone for the permissions checked above, always within buffers, daily caps, discount limits, budgets and business hours.
        </p>
      </div>
    </div>
  );
}
