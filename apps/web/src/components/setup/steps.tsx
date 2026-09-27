"use client";
import { Bot, CircleAlert, CircleCheck, Cloud, Film, Globe, HardDrive, Loader2, PlayCircle, Rocket, ShieldCheck, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CopyField } from "@/components/connections/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/action";
import { saveAISettingsAction, saveAnthropicKeyAction, saveGlobalSettingsAction, testAnthropicAction } from "@/server/actions/connections";
import { saveAppUrlAction, saveStorageAction, testEverythingAction, type CheckResult } from "@/server/actions/setup";
import { requestContentAction, setModeAction, setWorkspaceStatusAction } from "@/server/actions/workspace";

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = <T,>(fn: () => Promise<ActionResult<T>>, ok?: (d: T) => string | null, after?: (d: T) => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        const msg = ok ? ok(r.data) : (r.message ?? "Saved");
        if (msg) toast.success(msg);
        after?.(r.data);
      } else toast.error(r.error);
      router.refresh();
    });
  return { pending, act };
}

function Choice({ active, onClick, icon: Icon, title, text, badge }: { active: boolean; onClick: () => void; icon: typeof Bot; title: string; text: string; badge?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn("rounded-xl border p-4 text-left transition", active ? "border-primary bg-primary-soft ring-1 ring-primary" : "border-border hover:border-border-strong")}>
      <div className="mb-2 flex items-center justify-between">
        <Icon className={cn("size-5", active ? "text-primary" : "text-muted-foreground")} />
        {badge ? <Badge tone="success">{badge}</Badge> : null}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-[12px] leading-snug text-muted-foreground">{text}</div>
    </button>
  );
}

/* ───────────────────────────── Claude ───────────────────────────── */

type ModelMap = Record<"strategist" | "creative" | "sales" | "classification", { model: string; effort: "default" | "low" | "medium" | "high"; maxTokens: number }>;

export function AiStep(props: {
  provider: string;
  keyStatus: { configured: boolean; last4: string | null; fromEnv: boolean; lastTest: string | null; ok: boolean | null };
  preset: "quality" | "economy" | "custom";
  presets: { quality: ModelMap; economy: ModelMap };
  budget: number | null;
}) {
  const { pending, act } = useAct();
  const [provider, setProvider] = useState(props.provider === "claude-code-cli" ? "claude-code-cli" : "anthropic");
  const [key, setKey] = useState("");
  const [budget, setBudget] = useState(props.budget?.toString() ?? "");
  const k = props.keyStatus;
  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice active={provider === "anthropic"} onClick={() => setProvider("anthropic")} icon={Zap} title="Anthropic API key" badge="Recommended" text="Pay per use. Works for the dashboard (sales replies) and the worker (videos)." />
        <Choice active={provider === "claude-code-cli"} onClick={() => setProvider("claude-code-cli")} icon={Bot} title="Claude Code on the worker" text="Uses the official Claude Code CLI already signed in on the worker computer (non-interactive mode, tools disabled)." />
      </div>

      {provider === "anthropic" ? (
        <div className="grid gap-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-medium">API key</span>
            {k.configured ? <Badge tone={k.ok === false ? "danger" : "success"}>{k.fromEnv ? "from .env" : `saved …${k.last4 ?? "****"}`}</Badge> : <Badge tone="warning">not connected</Badge>}
            {k.lastTest ? <span className="text-xs text-muted-foreground">{k.lastTest}</span> : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Anthropic API key" />
            <Button variant="primary" loading={pending} disabled={!key} onClick={() => act(() => saveAnthropicKeyAction(key), (d) => (d as { message: string }).message, () => setKey(""))}>
              Save &amp; test
            </Button>
            {k.configured ? (
              <Button loading={pending} onClick={() => act(() => testAnthropicAction(), (d) => (d.ok ? `Claude OK — ${d.message}` : `Test failed: ${d.message}`))}>
                Test again
              </Button>
            ) : null}
          </div>
          <ol className="list-decimal space-y-0.5 pl-5 text-[12px] text-muted-foreground">
            <li>
              Open{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                console.anthropic.com → API keys
              </a>{" "}
              and create a key (add a payment method / credits in Billing).
            </li>
            <li>Paste it above. It is tested first, then stored encrypted — it is never shown again.</li>
          </ol>
          {props.provider === "claude-code-cli" ? (
            <Button className="justify-self-start" loading={pending} onClick={() => act(() => saveAISettingsAction({ provider: "anthropic" }), () => "Using the Anthropic API")}>
              Use the API key for AI
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 rounded-xl border border-border p-4 text-[13px]">
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>On the worker computer, install Claude Code and sign in once (<code className="font-mono text-foreground">claude</code> in a terminal).</li>
            <li>Keep the RevenueOS worker running there — content is generated by it. Sales replies also run there.</li>
          </ol>
          <Button className="justify-self-start" variant="primary" loading={pending} disabled={props.provider === "claude-code-cli"} onClick={() => act(() => saveAISettingsAction({ provider: "claude-code-cli" }), () => "Using Claude Code on the worker")}>
            {props.provider === "claude-code-cli" ? "In use" : "Use Claude Code"}
          </Button>
        </div>
      )}

      <div className="grid gap-3">
        <div className="text-sm font-semibold">Quality vs. cost</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice active={props.preset === "quality"} onClick={() => act(() => saveAISettingsAction({ models: props.presets.quality }), () => "Quality preset selected")} icon={Sparkles} title="Best quality" text="Most capable model for strategy and scripts, faster models for conversations." />
          <Choice active={props.preset === "economy"} onClick={() => act(() => saveAISettingsAction({ models: props.presets.economy }), () => "Economy preset selected")} icon={Zap} title="Economy" text="About 60% cheaper per video. Good to start and test." />
        </div>
        {props.preset === "custom" ? <p className="text-[12px] text-muted-foreground">Custom models are set in Settings → AI.</p> : null}
      </div>

      <div className="grid gap-2 sm:max-w-sm">
        <Field label="Monthly AI budget (USD)" htmlFor="ai-budget" hint="Non-essential AI work pauses when reached. Empty = no global limit. Per-business limits are in each business's Settings.">
          <div className="flex gap-2">
            <Input id="ai-budget" type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 30" />
            <Button loading={pending} onClick={() => act(() => saveGlobalSettingsAction({ globalMonthlyAiBudgetUsd: budget === "" ? null : Number(budget) }), () => "Budget saved")}>
              Save
            </Button>
          </div>
        </Field>
      </div>
      <Link href="/settings?tab=ai" className="text-[12px] text-primary hover:underline">
        Advanced: models per agent, prompt caching →
      </Link>
    </div>
  );
}

/* ───────────────────────── Public address & storage ───────────────────────── */

export function PublicStep(props: {
  appUrl: string;
  publicUrl: boolean;
  writable: boolean;
  vercel: boolean;
  storageDriver: "local" | "supabase";
  supabaseUrl: string | null;
  supabaseBucket: string;
  hasServiceKey: boolean;
  lastTick: string | null;
  cronSecret: boolean;
  tickUrl: string;
}) {
  const { pending, act } = useAct();
  const [url, setUrl] = useState(props.appUrl);
  const [driver, setDriver] = useState(props.storageDriver);
  const [sb, setSb] = useState({ supabaseUrl: props.supabaseUrl ?? "", serviceRoleKey: "", bucket: props.supabaseBucket });
  const tickAgo = props.lastTick ? Math.round((Date.now() - new Date(props.lastTick).getTime()) / 60000) : null;
  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Globe className="size-4 text-primary" /> Dashboard address
          {props.publicUrl ? <Badge tone="success">public</Badge> : <Badge tone="warning">only on this computer</Badge>}
        </div>
        <p className="text-[13px] text-muted-foreground">
          Mercado Pago/Stripe payment confirmations, WhatsApp and Instagram messages arrive at this address, and Instagram downloads videos from it. With <code className="font-mono">localhost</code>, videos still render and TikTok/YouTube can publish, but those need a public <strong>https</strong> address.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} disabled={!props.writable} aria-label="Dashboard address" />
          <Button variant="primary" loading={pending} disabled={!props.writable || url === props.appUrl} onClick={() => act(() => saveAppUrlAction(url))}>
            Save address
          </Button>
        </div>
        {!props.writable ? <p className="text-[12px] text-muted-foreground">Set APP_URL in your hosting provider and redeploy.</p> : null}
        <details className="rounded-lg border border-border p-3 text-[13px]">
          <summary className="cursor-pointer font-medium">How to get a public address</summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <div className="font-medium">Option A — Free tunnel from this computer</div>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>
                  Install{" "}
                  <a className="text-primary hover:underline" href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" target="_blank" rel="noopener noreferrer">
                    cloudflared
                  </a>{" "}
                  (Windows: <code className="font-mono">winget install Cloudflare.cloudflared</code>).
                </li>
                <li>
                  Run <code className="font-mono">cloudflared tunnel --url http://127.0.0.1:3000</code> (keep it open while RevenueOS runs).
                </li>
                <li>Paste the https://…trycloudflare.com address above. For a permanent address, create a named tunnel with your domain.</li>
              </ol>
            </div>
            <div>
              <div className="font-medium">Option B — Host the dashboard online</div>
              <p className="mt-1 text-muted-foreground">Vercel (free) + Supabase (free) for the dashboard and database; the worker keeps rendering on your computer. Guide: docs/deploy.md.</p>
            </div>
          </div>
        </details>
      </section>

      <section className="grid gap-3">
        <div className="text-sm font-semibold">Video storage</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice active={driver === "local"} onClick={() => setDriver("local")} icon={HardDrive} title="This computer" text="Right when the dashboard and the worker run on the same computer." />
          <Choice active={driver === "supabase"} onClick={() => setDriver("supabase")} icon={Cloud} title="Supabase Storage" text="Needed when the dashboard is hosted online. Videos are uploaded shortly before posting and removed after." />
        </div>
        {driver === "supabase" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project URL" htmlFor="sb-url" hint="Supabase → Project Settings → API">
              <Input id="sb-url" value={sb.supabaseUrl} onChange={(e) => setSb({ ...sb, supabaseUrl: e.target.value })} placeholder="https://abcd1234.supabase.co" />
            </Field>
            <Field label="service_role key" htmlFor="sb-key" hint={props.hasServiceKey ? "Saved. Leave empty to keep." : "Server-side only — never shared with browsers."}>
              <Input id="sb-key" type="password" autoComplete="off" value={sb.serviceRoleKey} onChange={(e) => setSb({ ...sb, serviceRoleKey: e.target.value })} />
            </Field>
            <Field label="Bucket" htmlFor="sb-bucket" hint="Created automatically (private)">
              <Input id="sb-bucket" value={sb.bucket} onChange={(e) => setSb({ ...sb, bucket: e.target.value })} />
            </Field>
          </div>
        ) : null}
        <Button
          className="justify-self-start"
          variant="primary"
          loading={pending}
          disabled={!props.writable || (driver === props.storageDriver && driver === "local")}
          onClick={() => act(() => saveStorageAction(driver === "local" ? { driver } : { driver, supabaseUrl: sb.supabaseUrl, serviceRoleKey: sb.serviceRoleKey || undefined, bucket: sb.bucket }))}
        >
          {driver === "supabase" ? "Save & test storage" : "Use this computer"}
        </Button>
      </section>

      <section className="grid gap-2">
        <div className="text-sm font-semibold">Scheduler</div>
        {props.vercel ? (
          <div className="grid gap-2 text-[13px] text-muted-foreground">
            <p>On Vercel the scheduler runs when {props.tickUrl} is called every minute (Supabase pg_cron or any pinger; see docs/deploy.md).{props.cronSecret ? "" : " Set CRON_SECRET first."}</p>
            <CopyField label="Tick URL" value={props.tickUrl} />
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">Runs automatically inside RevenueOS and the worker.</p>
        )}
        <p className="flex items-center gap-1.5 text-[13px]">
          {tickAgo != null && tickAgo < 5 ? <CircleCheck className="size-4 text-success" /> : <CircleAlert className="size-4 text-warning" />}
          {tickAgo == null ? "No scheduler tick recorded yet." : `Last tick ${tickAgo < 1 ? "less than a minute" : `${tickAgo} min`} ago.`}
        </p>
      </section>
    </div>
  );
}

/* ───────────────────────────── Go live ───────────────────────────── */

const MODES = [
  ["MANUAL", "Manual", "You click every action."],
  ["ASSISTED", "Assisted", "AI creates and replies; you approve posts and checkout links."],
  ["AUTOPILOT", "Autopilot", "AI acts alone within your limits."],
] as const;

export function LaunchStep(props: { businesses: { id: string; slug: string; name: string; operatingMode: string; status: string }[]; essentialsDone: boolean; missing: string[] }) {
  const { pending, act } = useAct();
  const [results, setResults] = useState<CheckResult[] | null>(null);
  const [testing, startTest] = useTransition();
  const router = useRouter();
  const runTests = () =>
    startTest(async () => {
      const r = await testEverythingAction();
      if (r.ok) setResults(r.data);
      else toast.error(r.error);
      router.refresh();
    });
  const groups = results ? [...new Set(results.map((r) => r.group))] : [];
  return (
    <div className="grid gap-8">
      {props.essentialsDone ? (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft p-4 text-[13px]">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" />
          <div>
            <div className="font-semibold text-foreground">Everything essential is connected</div>
            <div className="text-muted-foreground">Choose how autonomous each business is and start the first video.</div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 text-[13px]">
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
          <div>
            <div className="font-semibold text-foreground">Still missing: {props.missing.join(", ")}</div>
            <div className="text-muted-foreground">You can already choose the mode; publishing starts once the missing steps are done.</div>
          </div>
        </div>
      )}

      <section className="grid gap-3">
        <div className="text-sm font-semibold">How autonomous should each business be?</div>
        {props.businesses.length === 0 ? <p className="text-[13px] text-muted-foreground">Create a business first.</p> : null}
        {props.businesses.map((b) => (
          <div key={b.id} className="grid gap-3 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {b.name}
                <Badge tone={b.status === "ACTIVE" ? "success" : "warning"}>{b.status.toLowerCase()}</Badge>
              </div>
              <div className="flex gap-2">
                {b.status !== "ACTIVE" ? (
                  <Button size="sm" loading={pending} onClick={() => act(() => setWorkspaceStatusAction(b.id, "ACTIVE"), () => `${b.name} is active`)}>
                    <PlayCircle /> Activate
                  </Button>
                ) : null}
                <Button size="sm" variant="primary" loading={pending} disabled={!props.essentialsDone} onClick={() => act(() => requestContentAction(b.id, { count: 1 }), () => "The Strategist is planning the first video — follow it in Content")}>
                  <Film /> Create the first video now
                </Button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {MODES.map(([m, label, text]) => (
                <button key={m} type="button" onClick={() => b.operatingMode !== m && act(() => setModeAction(b.id, m), () => `${b.name}: ${label}`)} aria-pressed={b.operatingMode === m} className={cn("rounded-lg border p-3 text-left", b.operatingMode === m ? "border-primary bg-primary-soft" : "border-border hover:border-border-strong")}>
                  <div className="text-[13px] font-semibold">{label}</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">{text}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Test everything</div>
            <div className="text-[12px] text-muted-foreground">Real checks against Claude, the worker, every connected account, payment provider and WhatsApp.</div>
          </div>
          <Button onClick={runTests} loading={testing}>
            <Rocket /> Run all tests
          </Button>
        </div>
        {testing ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Testing connections…
          </p>
        ) : null}
        {results ? (
          <div className="grid gap-4">
            {groups.map((g) => (
              <div key={g}>
                <div className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">{g}</div>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {results
                    .filter((r) => r.group === g)
                    .map((r) => (
                      <li key={`${g}-${r.label}`} className="flex items-start gap-2.5 px-3 py-2 text-[13px]">
                        {r.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />}
                        <span className="w-44 shrink-0 font-medium">{r.label}</span>
                        <span className="text-muted-foreground">{r.message}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
