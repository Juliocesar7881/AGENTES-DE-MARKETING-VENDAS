"use client";
import { KeyRound, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { refreshModelsAction, saveAISettingsAction, saveAnthropicKeyAction, saveGlobalSettingsAction, testAnthropicAction } from "@/server/actions/connections";
import { SettingsSection } from "./section";

type Slot = "strategist" | "creative" | "sales" | "classification";
interface ModelCfg {
  model: string;
  effort: "default" | "low" | "medium" | "high";
  maxTokens: number;
}

const SLOT_INFO: Record<Slot, string> = {
  strategist: "Strategist — plans content from sales data (quality matters most)",
  creative: "Creative — scripts, hooks and VideoSpecs",
  sales: "Sales — replies to leads (high volume, fast)",
  classification: "Classification — intents, summaries, small tasks",
};

export function AISettingsPanel(props: {
  provider: string;
  demoProvider: string;
  models: Record<Slot, ModelCfg>;
  promptCaching: boolean;
  claudeCliPath: string;
  availableModels: { id: string; displayName?: string }[];
  keyStatus: { configured: boolean; last4: string | null; fromEnv: boolean; lastTest: string | null; ok: boolean | null };
  economy: Record<Slot, ModelCfg>;
  defaults: Record<Slot, ModelCfg>;
  globalBudget: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [key, setKey] = useState("");
  const [provider, setProvider] = useState(props.provider);
  const [demoProvider, setDemoProvider] = useState(props.demoProvider);
  const [models, setModels] = useState(props.models);
  const [caching, setCaching] = useState(props.promptCaching);
  const [cliPath, setCliPath] = useState(props.claudeCliPath);
  const [budget, setBudget] = useState(props.globalBudget?.toString() ?? "");
  const options = [...new Set([...props.availableModels.map((m) => m.id), ...Object.values(props.defaults).map((m) => m.model), ...Object.values(props.economy).map((m) => m.model), ...Object.values(models).map((m) => m.model)])];

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; data?: unknown }>, msg?: (d: unknown) => string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(msg ? msg(r.data) : (r.message ?? "Saved"));
      else toast.error(r.error ?? "Failed");
      router.refresh();
    });

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SettingsSection title="Claude connection" description="Official mechanisms only: the Anthropic API (recommended) or the official Claude Code CLI on the local worker.">
        <Field label="Provider for LIVE businesses">
          <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="anthropic">Anthropic API (API key)</option>
            <option value="claude-code-cli">Claude Code CLI (official, runs on the local worker)</option>
          </Select>
        </Field>
        {provider === "anthropic" ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[13px]">
              <KeyRound className="size-4 text-muted-foreground" />
              {props.keyStatus.configured ? (
                <>
                  <Badge tone={props.keyStatus.ok === false ? "danger" : "success"}>{props.keyStatus.fromEnv ? "from ANTHROPIC_API_KEY" : `saved …${props.keyStatus.last4 ?? "****"}`}</Badge>
                  {props.keyStatus.lastTest ? <span className="text-xs text-muted-foreground">{props.keyStatus.lastTest}</span> : null}
                </>
              ) : (
                <Badge tone="warning">No API key — LIVE businesses cannot generate content yet</Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
              <Button
                variant="primary"
                loading={pending}
                disabled={!key}
                onClick={() =>
                  run(
                    () => saveAnthropicKeyAction(key),
                    (d) => {
                      setKey("");
                      return (d as { message: string }).message;
                    },
                  )
                }
              >
                Save & test
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Create a key at console.anthropic.com → API keys. It is tested, then stored encrypted — it is never shown again.</p>
          </div>
        ) : (
          <Field label="Claude Code CLI path on the worker" hint="Leave empty to use “claude” from PATH. The worker calls it in non-interactive mode (claude -p) with tools disabled.">
            <Input value={cliPath} onChange={(e) => setCliPath(e.target.value)} placeholder="claude" />
          </Field>
        )}
        <Field label="DEMO businesses use">
          <Select value={demoProvider} onChange={(e) => setDemoProvider(e.target.value)}>
            <option value="mock">Mock AI (free, deterministic)</option>
            <option value="same">The real provider above (costs tokens)</option>
          </Select>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button loading={pending} onClick={() => run(() => saveAISettingsAction({ provider, demoProvider, claudeCliPath: cliPath || undefined }))}>
            Save provider
          </Button>
          <Button variant="ghost" loading={pending} onClick={() => run(() => testAnthropicAction(), (d) => { const x = d as { ok: boolean; message: string }; return x.ok ? `Claude OK — ${x.message}` : `Test failed: ${x.message}`; })}>
            Test connection
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Models per agent"
        description="Pick the model and effort for each role. Prompt caching reuses the stable business context between calls."
        onSave={() => run(() => saveAISettingsAction({ models, promptCaching: caching }))}
        pending={pending}
        footer={
          <div className="mr-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setModels(props.economy)}>
              Economy preset
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setModels(props.defaults)}>
              Quality preset
            </Button>
            <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => refreshModelsAction(), (d) => `${(d as { count: number }).count} models available`)}>
              <RefreshCw /> Refresh list
            </Button>
          </div>
        }
      >
        {(Object.keys(SLOT_INFO) as Slot[]).map((slot) => (
          <div key={slot} className="grid gap-2 sm:grid-cols-[1fr_120px_110px]">
            <Field label={SLOT_INFO[slot]}>
              <Select value={models[slot].model} onChange={(e) => setModels({ ...models, [slot]: { ...models[slot], model: e.target.value } })}>
                {options.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="Effort">
              <Select value={models[slot].effort} onChange={(e) => setModels({ ...models, [slot]: { ...models[slot], effort: e.target.value as ModelCfg["effort"] } })}>
                <option value="default">default</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </Select>
            </Field>
            <Field label="Max tokens">
              <Input type="number" min={256} max={64000} value={models[slot].maxTokens} onChange={(e) => setModels({ ...models, [slot]: { ...models[slot], maxTokens: Number(e.target.value) } })} />
            </Field>
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={caching} onChange={(e) => setCaching(e.target.checked)} /> Prompt caching (recommended)
        </label>
      </SettingsSection>

      <SettingsSection title="Global AI budget" description="Monthly ceiling across all businesses. Per-business limits are in each business's Settings." onSave={() => run(() => saveGlobalSettingsAction({ globalMonthlyAiBudgetUsd: budget === "" ? null : Number(budget) }))} pending={pending}>
        <Field label="Monthly limit (USD)" hint="empty = no global limit">
          <Input type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
        </Field>
      </SettingsSection>
    </div>
  );
}
