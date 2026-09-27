"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/input";
import { saveGlobalSettingsAction } from "@/server/actions/connections";
import { SettingsSection } from "./section";

export function SystemPanel({ info, settings, audit }: { info: { label: string; value: string; ok: boolean }[]; settings: { deliveryLeadHours: number; workerOfflineAfterSec: number }; audit: { id: string; action: string; actor: string; at: string; ws: string | null }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [s, setS] = useState(settings);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SettingsSection title="Environment" description="Read from the server environment (.env / hosting). Secret values are never displayed.">
        <div className="divide-y divide-border">
          {info.map((i) => (
            <div key={i.label} className="flex items-center justify-between gap-3 py-2 text-[13px]">
              <span className="text-muted-foreground">{i.label}</span>
              <span className="flex items-center gap-2 text-right">
                <span className="max-w-[260px] truncate font-mono text-[12px]">{i.value}</span>
                <Badge tone={i.ok ? "success" : "warning"}>{i.ok ? "ok" : "check"}</Badge>
              </span>
            </div>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection
        title="Automation timing"
        onSave={() =>
          start(async () => {
            const r = await saveGlobalSettingsAction(s);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
            router.refresh();
          })
        }
        pending={pending}
      >
        <Field label="Upload rendered videos to cloud storage this many hours before posting" hint="The worker prepares delivery early, so posts go out even if the PC is off at publish time.">
          <Input type="number" min={1} max={72} value={s.deliveryLeadHours} onChange={(e) => setS({ ...s, deliveryLeadHours: Number(e.target.value) })} />
        </Field>
        <Field label="Consider the worker offline after (seconds without heartbeat)">
          <Input type="number" min={30} max={3600} value={s.workerOfflineAfterSec} onChange={(e) => setS({ ...s, workerOfflineAfterSec: Number(e.target.value) })} />
        </Field>
      </SettingsSection>
      <SettingsSection title="Audit log" description="Security-relevant actions (logins, credentials, approvals, sales, deletions).">
        <div className="max-h-96 divide-y divide-border overflow-y-auto">
          {audit.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
              <span className="font-mono">{a.action}</span>
              <span className="truncate text-right text-muted-foreground">
                {a.ws ? `${a.ws} · ` : ""}
                {a.actor} · {new Date(a.at).toLocaleString("pt-BR")}
              </span>
            </div>
          ))}
          {audit.length === 0 ? <p className="text-sm text-muted-foreground">No entries yet.</p> : null}
        </div>
      </SettingsSection>
    </div>
  );
}
