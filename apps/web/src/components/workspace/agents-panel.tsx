"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import type { AgentRole } from "@revenueos/shared";
import { Dot } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { AGENT_LABEL, AGENT_STATUS, statusOf } from "@/lib/status";
import { ago } from "@/lib/utils";
import { setAgentPausedAction } from "@/server/actions/workspace";

export interface AgentRow {
  role: string;
  status: string;
  paused: boolean;
  currentTask: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  runs7d?: number;
  cost7d?: number;
}

export function AgentsPanel({ workspaceId, agents, compact }: { workspaceId: string; agents: AgentRow[]; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const order = ["STRATEGIST", "CREATIVE", "GROWTH", "SALES", "CUSTOMER_SUCCESS"];
  const sorted = [...agents].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  return (
    <div className="divide-y divide-border">
      {sorted.map((a) => {
        const st = statusOf(AGENT_STATUS, a.paused ? "PAUSED" : a.status);
        return (
          <div key={a.role} className="flex items-center gap-3 py-2.5">
            <Dot tone={st.tone === "neutral" ? "neutral" : st.tone} pulse={a.status === "WORKING" && !a.paused} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px] font-medium">
                {AGENT_LABEL[a.role]?.name ?? a.role}
                <span className="text-[11px] font-normal text-subtle">{st.label}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {a.status === "ERROR" && a.lastError ? <span className="text-danger">{a.lastError}</span> : (a.currentTask ?? (compact ? (a.lastRunAt ? `Last run ${ago(a.lastRunAt)}` : "Waiting for work") : AGENT_LABEL[a.role]?.description))}
              </div>
            </div>
            {!compact && a.runs7d != null ? (
              <div className="hidden text-right text-[11px] text-subtle sm:block">
                <div>{a.runs7d} runs · 7d</div>
                <div>${(a.cost7d ?? 0).toFixed(3)}</div>
              </div>
            ) : null}
            <Tooltip content={a.paused ? "Resume agent" : "Pause agent (its automatic jobs wait)"}>
              <span>
                <Switch
                  checked={!a.paused}
                  disabled={pending}
                  aria-label={`${a.paused ? "Resume" : "Pause"} ${a.role}`}
                  onCheckedChange={(on) =>
                    start(async () => {
                      const r = await setAgentPausedAction(workspaceId, a.role as AgentRole, !on);
                      if (r.ok) toast.success(r.message);
                      else toast.error(r.error);
                      router.refresh();
                    })
                  }
                />
              </span>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}
