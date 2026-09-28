"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { OperatingMode, SalesSettings, RetentionSettings } from "@revenueos/shared";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { setModeAction, updateWorkspaceSection } from "@/server/actions/workspace";
import { PostingModePicker, TimingInsights, type PostingModeValue, type TimingInsightsView } from "./posting-mode";
import { SettingsSection } from "./section";
import { platformLabel } from "@/components/platform-icon";

export interface WsSettingsData {
  id: string;
  name: string;
  industry: string;
  website: string | null;
  description: string;
  color: string;
  whatsappNumber: string | null;
  currency: string;
  timezone: string;
  postsPerDay: number;
  postingSchedule: string[];
  postingMode: PostingModeValue;
  targetReadyBuffer: number;
  maxContentGeneratedPerDay: number;
  maxContentPublishedPerDay: number;
  targetPlatforms: string[];
  operatingMode: OperatingMode;
  salesSettings: SalesSettings;
  retention: RetentionSettings;
  dailyAiBudgetUsd: number | null;
  monthlyAiBudgetUsd: number | null;
  environment: string;
}

const TZS = ["America/Sao_Paulo", "America/Manaus", "America/Recife", "America/Fortaleza", "America/Belem", "America/Cuiaba", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/Lisbon", "Europe/London", "UTC"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WorkspaceSettings({ data, timing }: { data: WsSettingsData; timing?: TimingInsightsView | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const save = (section: Parameters<typeof updateWorkspaceSection>[1], input: unknown) =>
    start(async () => {
      const r = await updateWorkspaceSection(data.id, section, input);
      if (r.ok) toast.success("Saved");
      else toast.error(r.error);
      router.refresh();
    });

  const [general, setGeneral] = useState({ name: data.name, industry: data.industry, website: data.website ?? "", description: data.description, color: data.color, whatsappNumber: data.whatsappNumber ?? "", currency: data.currency });
  const [sched, setSched] = useState({ timezone: data.timezone, postsPerDay: data.postsPerDay, postingSchedule: data.postingSchedule, postingMode: data.postingMode, targetReadyBuffer: data.targetReadyBuffer, maxContentGeneratedPerDay: data.maxContentGeneratedPerDay, maxContentPublishedPerDay: data.maxContentPublishedPerDay, targetPlatforms: data.targetPlatforms });
  const [sales, setSales] = useState(data.salesSettings);
  const [retention, setRetention] = useState(data.retention);
  const [budget, setBudget] = useState({ daily: data.dailyAiBudgetUsd?.toString() ?? "", monthly: data.monthlyAiBudgetUsd?.toString() ?? "" });

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SettingsSection title="Operating mode" description="How much the agents may do on their own in this business.">
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["MANUAL", "Manual", "Agents only act when you click. Nothing automatic."],
              ["ASSISTED", "Assisted", "AI creates content and replies; you approve publishing and checkout links."],
              ["AUTOPILOT", "Autopilot", "Acts alone within the permissions and limits you set."],
            ] as const
          ).map(([m, label, desc]) => (
            <button
              key={m}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (m === "AUTOPILOT" && data.environment === "LIVE" && !confirm("Enable AUTOPILOT? Content will be published and sales messages sent automatically within your permissions.")) return;
                  const r = await setModeAction(data.id, m);
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.error);
                  router.refresh();
                })
              }
              className={cn("rounded-lg border p-3 text-left transition", data.operatingMode === m ? "border-primary bg-primary-soft" : "border-border hover:border-border-strong")}
            >
              <div className="text-sm font-semibold">{label}</div>
              <div className="mt-1 text-[12px] text-muted-foreground">{desc}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Fine-grained permissions (publish, reply, send checkout…) are in{" "}
          <Link href="/autopilot" className="text-primary hover:underline">
            Autopilot
          </Link>
          .
        </p>
      </SettingsSection>

      <SettingsSection title="Business" onSave={() => save("general", { ...general, website: general.website || null, whatsappNumber: general.whatsappNumber || null })} pending={pending}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={general.name} onChange={(e) => setGeneral({ ...general, name: e.target.value })} />
          </Field>
          <Field label="Industry">
            <Input value={general.industry} onChange={(e) => setGeneral({ ...general, industry: e.target.value })} />
          </Field>
          <Field label="Website">
            <Input value={general.website} onChange={(e) => setGeneral({ ...general, website: e.target.value })} placeholder="https://" />
          </Field>
          <Field label="WhatsApp number" hint="Tracked links open a chat with this number">
            <Input value={general.whatsappNumber} onChange={(e) => setGeneral({ ...general, whatsappNumber: e.target.value })} placeholder="5511999999999" />
          </Field>
          <Field label="Color">
            <div className="flex items-center gap-2">
              <input type="color" value={general.color} onChange={(e) => setGeneral({ ...general, color: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-input bg-card" aria-label="Color" />
              <Input value={general.color} onChange={(e) => setGeneral({ ...general, color: e.target.value })} className="font-mono" />
            </div>
          </Field>
          <Field label="Currency">
            <Select value={general.currency} onChange={(e) => setGeneral({ ...general, currency: e.target.value })}>
              <option>BRL</option>
              <option>USD</option>
              <option>EUR</option>
            </Select>
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={general.description} rows={2} onChange={(e) => setGeneral({ ...general, description: e.target.value })} />
        </Field>
      </SettingsSection>

      <SettingsSection title="Posting schedule & content buffer" description="The scheduler fills these slots; the buffer analyzer keeps videos ready ahead of time without exceeding the daily caps." onSave={() => save("scheduling", { ...sched, postsPerDay: Number(sched.postsPerDay) })} pending={pending}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Time zone">
            <Select value={sched.timezone} onChange={(e) => setSched({ ...sched, timezone: e.target.value })}>
              {[...new Set([sched.timezone, ...TZS])].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Posts per day">
            <Input type="number" min={0} max={12} value={sched.postsPerDay} onChange={(e) => setSched({ ...sched, postsPerDay: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="When to post">
          <PostingModePicker mode={sched.postingMode} onMode={(m) => setSched({ ...sched, postingMode: m })} times={sched.postingSchedule} onTimes={(t) => setSched({ ...sched, postingSchedule: t })} />
        </Field>
        {timing && sched.postingMode === "smart" ? <TimingInsights data={timing} mode={sched.postingMode} /> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ready buffer target">
            <Input type="number" min={0} max={30} value={sched.targetReadyBuffer} onChange={(e) => setSched({ ...sched, targetReadyBuffer: Number(e.target.value) })} />
          </Field>
          <Field label="Max generated / day">
            <Input type="number" min={0} max={24} value={sched.maxContentGeneratedPerDay} onChange={(e) => setSched({ ...sched, maxContentGeneratedPerDay: Number(e.target.value) })} />
          </Field>
          <Field label="Max published / day">
            <Input type="number" min={0} max={24} value={sched.maxContentPublishedPerDay} onChange={(e) => setSched({ ...sched, maxContentPublishedPerDay: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Publish to">
          <div className="flex flex-wrap gap-3">
            {(data.environment === "DEMO" ? ["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK"] : ["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK"]).map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-sm">
                <Checkbox checked={sched.targetPlatforms.includes(p)} onChange={(e) => setSched({ ...sched, targetPlatforms: e.target.checked ? [...sched.targetPlatforms, p] : sched.targetPlatforms.filter((x) => x !== p) })} />
                {platformLabel(p)}
              </label>
            ))}
          </div>
        </Field>
      </SettingsSection>

      <SettingsSection title="Sales Agent safety" description="Hard limits enforced in code before any message or checkout is sent." onSave={() => save("sales", sales)} pending={pending}>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={sales.autoReply} onChange={(e) => setSales({ ...sales, autoReply: e.target.checked })} /> Reply to leads automatically
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={sales.allowCheckout} onChange={(e) => setSales({ ...sales, allowCheckout: e.target.checked })} /> Allow the agent to create checkout links
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Max follow-ups">
            <Input type="number" min={0} max={10} value={sales.maxFollowups} onChange={(e) => setSales({ ...sales, maxFollowups: Number(e.target.value) })} />
          </Field>
          <Field label="Min hours between follow-ups">
            <Input type="number" min={1} value={sales.minFollowupIntervalHours} onChange={(e) => setSales({ ...sales, minFollowupIntervalHours: Number(e.target.value) })} />
          </Field>
          <Field label="Max discount %">
            <Input type="number" min={0} max={90} value={sales.maxDiscountPct} onChange={(e) => setSales({ ...sales, maxDiscountPct: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label={`Human approval above (${data.currency})`} hint="Checkouts above this amount always wait for your approval, even in Autopilot.">
          <Input type="number" min={0} value={sales.humanApprovalThresholdCents / 100} onChange={(e) => setSales({ ...sales, humanApprovalThresholdCents: Math.round(Number(e.target.value) * 100) })} />
        </Field>
        <div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={sales.businessHours.enabled} onChange={(e) => setSales({ ...sales, businessHours: { ...sales.businessHours, enabled: e.target.checked } })} /> Only send messages during business hours
          </label>
          {sales.businessHours.enabled ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1 text-xs">
                  <Checkbox checked={sales.businessHours.days.includes(i)} onChange={(e) => setSales({ ...sales, businessHours: { ...sales.businessHours, days: e.target.checked ? [...sales.businessHours.days, i].sort() : sales.businessHours.days.filter((x) => x !== i) } })} />
                  {d}
                </label>
              ))}
              <Input type="time" className="h-8 w-28" value={sales.businessHours.start} onChange={(e) => setSales({ ...sales, businessHours: { ...sales.businessHours, start: e.target.value } })} />
              <span className="text-xs">to</span>
              <Input type="time" className="h-8 w-28" value={sales.businessHours.end} onChange={(e) => setSales({ ...sales, businessHours: { ...sales.businessHours, end: e.target.value } })} />
            </div>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="WhatsApp follow-up template" hint="Approved template name for messages after 24h">
            <Input value={sales.whatsappFollowupTemplate ?? ""} onChange={(e) => setSales({ ...sales, whatsappFollowupTemplate: e.target.value || undefined })} />
          </Field>
          <Field label="Template language">
            <Input value={sales.whatsappTemplateLanguage} onChange={(e) => setSales({ ...sales, whatsappTemplateLanguage: e.target.value })} />
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title="AI budget" description="When exceeded, non-essential AI (new content, reviews) pauses. Sales replies to existing leads and payment processing keep running." onSave={() => save("budget", { dailyAiBudgetUsd: budget.daily === "" ? null : Number(budget.daily), monthlyAiBudgetUsd: budget.monthly === "" ? null : Number(budget.monthly) })} pending={pending}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Daily limit (USD)" hint="empty = no limit">
            <Input type="number" min={0} step="0.5" value={budget.daily} onChange={(e) => setBudget({ ...budget, daily: e.target.value })} />
          </Field>
          <Field label="Monthly limit (USD)">
            <Input type="number" min={0} step="1" value={budget.monthly} onChange={(e) => setBudget({ ...budget, monthly: e.target.value })} />
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title="Data retention (LGPD)" description="Unpublished videos are never deleted automatically." onSave={() => save("retention", retention)} pending={pending}>
        <Field label="Keep local MP4 of published videos">
          <Select value={retention.localVideoRetentionDays} onChange={(e) => setRetention({ ...retention, localVideoRetentionDays: Number(e.target.value) as 7 | 30 | 90 | 0 })}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={0}>Forever</option>
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Anonymize inactive leads after (days)" hint="0 = keep">
            <Input type="number" min={0} value={retention.leadRetentionDays} onChange={(e) => setRetention({ ...retention, leadRetentionDays: Number(e.target.value) })} />
          </Field>
          <Field label="Delete message texts after (days)" hint="0 = keep">
            <Input type="number" min={0} value={retention.messageRetentionDays} onChange={(e) => setRetention({ ...retention, messageRetentionDays: Number(e.target.value) })} />
          </Field>
        </div>
      </SettingsSection>
    </div>
  );
}
