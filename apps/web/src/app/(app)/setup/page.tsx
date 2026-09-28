import { ArrowRight, CircleAlert, CircleCheck, CircleDashed, Cpu, ExternalLink, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_AI_SETTINGS, ECONOMY_MODEL_PRESET } from "@revenueos/shared";
import { getGlobalSettings } from "@revenueos/core";
import { AutoRefresh } from "@/components/auto-refresh";
import { CopyField } from "@/components/connections/copy-field";
import { PaymentsSection, SocialAccountsSection, WhatsAppCard } from "@/components/connections/connections-panel";
import { AppsPanel } from "@/components/settings/apps-panel";
import { AiStep, LaunchStep, PublicStep } from "@/components/setup/steps";
import { Badge, Dot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, Progress } from "@/components/ui/misc";
import { ago, cn } from "@/lib/utils";
import { postingReadiness, SETUP_STEPS, setupModel, type SetupModel, type SetupStepId, type StepState } from "@/server/setup";

export const metadata: Metadata = { title: "Setup" };

const DESCRIPTIONS: Record<SetupStepId, string> = {
  ai: "The Strategist, Creative and Sales agents run on Claude. Connect it once for every business.",
  worker: "Renders the videos (Remotion + FFmpeg) and runs the content agents on your computer — no cloud rendering costs.",
  business: "Each business has its own brand, products, accounts, schedule and data, fully isolated from the others.",
  apps: "Free developer apps, created once, let RevenueOS publish through each platform's official API. Your businesses then connect their accounts with OAuth.",
  accounts: "Log in on each platform's own page. RevenueOS never sees your password; tokens are encrypted.",
  payments: "The Sales Agent sends checkout links. A sale only counts after the provider confirms the payment (signed webhook).",
  whatsapp: "Lets the Sales Agent answer leads on WhatsApp. Without it, leads still arrive through the tracked links and the lead form.",
  public: "Publishing works without it. Payment confirmations, WhatsApp/Instagram messages and counting link clicks need an address reachable from the internet.",
  launch: "Choose how autonomous each business is, test every connection and start the first video.",
};

const GUIDES: Record<string, string[]> = {
  INSTAGRAM: [
    "developers.facebook.com → My Apps → Create app → Business.",
    "Add the product “Instagram” → API setup with Instagram login.",
    "Paste the redirect URI below under Business login settings.",
    "Copy the Instagram app ID and secret here. In Development mode add your Instagram account as tester (App roles).",
  ],
  TIKTOK: ["developers.tiktok.com → Manage apps → Connect an app.", "Add Login Kit and Content Posting API (Direct Post).", "Paste the redirect URI below under Login Kit.", "Copy the Client key and secret here. Until TikTok audits the app, posts are private or go to drafts."],
  YOUTUBE: ["console.cloud.google.com → new project → enable YouTube Data API v3.", "OAuth consent screen: External, add yourself as test user.", "Credentials → OAuth client ID → Web application → paste the redirect URI below.", "Copy the Client ID and secret here."],
  FACEBOOK: ["Use a Meta Business app with Facebook Login for Business.", "Paste the redirect URI below.", "Copy the Meta app ID and secret here."],
};

function StateIcon({ s, className }: { s: StepState; className?: string }) {
  if (s === "done") return <CircleCheck className={cn("size-[18px] text-success", className)} />;
  if (s === "warn") return <CircleAlert className={cn("size-[18px] text-warning", className)} />;
  return <CircleDashed className={cn("size-[18px] text-subtle", className)} />;
}

function firstOpen(m: SetupModel): SetupStepId {
  return SETUP_STEPS.find((s) => s.essential && m.state[s.id] !== "done")?.id ?? "launch";
}

function BusinessPicker({ m, step }: { m: SetupModel; step: SetupStepId }) {
  if (m.live.length < 2 || !m.business) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px]">
      <span className="mr-1 text-muted-foreground">Business:</span>
      {m.live.map((w) => (
        <Link key={w.id} href={`/setup?step=${step}&ws=${w.slug}`} className={cn("rounded-md border px-2.5 py-1", w.id === m.business!.ws.id ? "border-primary bg-primary-soft font-medium" : "border-border hover:bg-muted")}>
          {w.name}
        </Link>
      ))}
    </div>
  );
}

function NeedsBusiness() {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
      Create your first business, then connect its accounts here.
      <div className="mt-3">
        <Button asChild variant="primary" size="sm">
          <Link href="/onboarding?from=setup">
            <Plus /> Create a business
          </Link>
        </Button>
      </div>
    </div>
  );
}

function PublicNotice({ m }: { m: SetupModel }) {
  if (m.infra.publicUrl) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[13px]">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>
        These providers send confirmations to your dashboard address, which is currently only reachable on this computer.{" "}
        <Link href="/setup?step=public" className="font-medium text-primary hover:underline">
          Set a public address
        </Link>{" "}
        before going live.
      </span>
    </div>
  );
}

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string; ws?: string }> }) {
  const sp = await searchParams;
  const m = await setupModel(sp.ws);
  const step: SetupStepId = SETUP_STEPS.find((s) => s.id === sp.step)?.id ?? firstOpen(m);
  const idx = SETUP_STEPS.findIndex((s) => s.id === step);
  const next = SETUP_STEPS[idx + 1];
  const essentials = SETUP_STEPS.filter((s) => s.essential && s.id !== "launch");
  const doneCount = essentials.filter((s) => m.state[s.id] === "done").length;
  const wsQuery = m.business ? `&ws=${m.business.ws.slug}` : "";
  const connectionProps = m.business
    ? {
        workspace: { id: m.business.ws.id, slug: m.business.ws.slug, environment: m.business.ws.environment, targetPlatforms: m.business.ws.targetPlatforms },
        accounts: m.business.social.accounts.map((a) => ({
          id: a.id,
          platform: a.platform,
          username: a.username,
          displayName: a.displayName,
          status: a.status,
          isDemo: a.isDemo,
          scopes: a.scopes,
          lastValidatedAt: a.lastValidatedAt?.toISOString() ?? null,
          lastError: a.lastError,
          tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null,
          actionRequired: a.actionRequired,
          enabled: a.enabled,
        })),
        appConfigured: m.business.social.appConfigured,
        integrations: m.business.integrations.map((i) => ({ key: i.key, status: i.status, config: i.config, lastTestedAt: i.lastTestedAt?.toISOString() ?? null, testResult: i.testResult as { ok?: boolean; message?: string } | null, credentials: i.credentials.map((c) => ({ type: c.type, last4: c.last4 })) })),
        webhooks: m.business.webhooks,
        verifyToken: m.verifyToken,
        isAdmin: true,
        appsHref: `/setup?step=apps${wsQuery}`,
      }
    : null;

  let body: React.ReactNode;
  switch (step) {
    case "ai": {
      const g = await getGlobalSettings();
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      body = (
        <AiStep
          provider={m.ai.ai.provider}
          keyStatus={m.ai.keyStatus}
          preset={same(m.ai.ai.models, DEFAULT_AI_SETTINGS.models) ? "quality" : same(m.ai.ai.models, ECONOMY_MODEL_PRESET) ? "economy" : "custom"}
          presets={{ quality: DEFAULT_AI_SETTINGS.models, economy: ECONOMY_MODEL_PRESET }}
          budget={g.globalMonthlyAiBudgetUsd}
        />
      );
      break;
    }
    case "worker":
      body = (
        <div className="grid gap-5">
          {!m.workerOnline ? <AutoRefresh ms={5000} /> : null}
          {m.workers.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4">
              <Cpu className="size-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Dot tone={!w.online ? "danger" : w.paused ? "warning" : "success"} pulse={w.online} />
                  {w.name}
                  <Badge tone={w.online ? "success" : "danger"}>{w.online ? (w.paused ? "paused" : "online") : "offline"}</Badge>
                </div>
                <div className="text-[12px] text-muted-foreground">
                  {w.platform ?? ""} · v{w.version ?? "?"} · last seen {ago(w.lastHeartbeatAt)}
                </div>
              </div>
              {w.online && w.localUiUrl ? (
                <Button asChild size="sm">
                  <a href={w.localUiUrl} target="_blank" rel="noopener noreferrer">
                    Worker panel <ExternalLink />
                  </a>
                </Button>
              ) : null}
            </div>
          ))}
          {m.workerOnline ? (
            <p className="flex items-center gap-2 text-[13px] text-success">
              <CircleCheck className="size-4" /> The worker is online — renders and content generation run on it.
            </p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border p-4 text-[13px]">
                  <div className="font-semibold">Windows</div>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
                    <li>
                      Double-click <code className="font-mono text-foreground">RevenueOS.bat</code> in the RevenueOS folder — it starts the dashboard <em>and</em> the worker (icon in the system tray).
                    </li>
                    <li>
                      Worker on another computer: run <code className="font-mono text-foreground">setup-worker.bat</code> there once, then <code className="font-mono text-foreground">start-worker.bat</code>.
                    </li>
                  </ol>
                </div>
                <div className="rounded-xl border border-border p-4 text-[13px]">
                  <div className="font-semibold">macOS / Linux</div>
                  <div className="mt-2 grid gap-2">
                    <CopyField label="In the RevenueOS folder" value="pnpm launch" />
                    <p className="text-[12px] text-muted-foreground">
                      Or only the worker: <code className="font-mono">pnpm worker</code>
                    </p>
                  </div>
                </div>
              </div>
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
                  <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </span>
                Waiting for the worker… this page updates by itself.
              </p>
            </>
          )}
        </div>
      );
      break;
    case "business":
      body = (
        <div className="grid gap-3">
          {m.live.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-4">
              <div>
                <div className="text-sm font-semibold">{w.name}</div>
                <div className="text-[12px] text-muted-foreground">
                  {w.operatingMode.toLowerCase()} · {w.status.toLowerCase()} · {w.targetPlatforms.map((p) => p.toLowerCase()).join(", ")}
                </div>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/w/${w.slug}/brand`}>Brand</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/w/${w.slug}/products`}>Products</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href={`/w/${w.slug}`}>Open</Link>
                </Button>
              </div>
            </div>
          ))}
          <Button asChild variant={m.live.length ? "secondary" : "primary"} className="justify-self-start">
            <Link href="/onboarding?from=setup">
              <Plus /> {m.live.length ? "Add another business" : "Create your first business"}
            </Link>
          </Button>
        </div>
      );
      break;
    case "apps": {
      const targeted = new Set(m.live.flatMap((w) => w.targetPlatforms));
      const apps = [...m.apps].sort((a, b) => Number(targeted.has(b.platform)) - Number(targeted.has(a.platform)));
      body = <AppsPanel apps={apps} guides={GUIDES} targeted={[...targeted]} />;
      break;
    }
    case "accounts":
      body = connectionProps ? (
        <>
          <BusinessPicker m={m} step={step} />
          <SocialAccountsSection {...connectionProps} />
        </>
      ) : (
        <NeedsBusiness />
      );
      break;
    case "payments":
      body = connectionProps ? (
        <>
          <BusinessPicker m={m} step={step} />
          <PublicNotice m={m} />
          <PaymentsSection workspaceId={connectionProps.workspace.id} integrations={connectionProps.integrations} webhooks={connectionProps.webhooks} />
        </>
      ) : (
        <NeedsBusiness />
      );
      break;
    case "whatsapp":
      body = connectionProps ? (
        <>
          <BusinessPicker m={m} step={step} />
          <PublicNotice m={m} />
          <WhatsAppCard workspaceId={connectionProps.workspace.id} integ={connectionProps.integrations.find((i) => i.key === "whatsapp") ?? null} webhook={connectionProps.webhooks.whatsapp} verifyToken={m.verifyToken} />
        </>
      ) : (
        <NeedsBusiness />
      );
      break;
    case "public":
      body = <PublicStep {...m.infra} tickUrl={`${m.infra.appUrl}/api/cron/tick`} />;
      break;
    case "launch":
      body = <LaunchStep businesses={m.live} essentialsDone={m.essentialsDone} missing={essentials.filter((s) => m.state[s.id] !== "done").map((s) => s.title)} readiness={await postingReadiness(m)} />;
      break;
  }

  return (
    <>
      <PageHeader title="Setup" description="Everything RevenueOS needs to run for real, in one place. The demo businesses work without any of it." />
      <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="mb-2 flex items-baseline justify-between text-[13px]">
              <span className="font-medium">Essentials</span>
              <span className="text-muted-foreground">
                {doneCount}/{essentials.length}
              </span>
            </div>
            <Progress value={(doneCount / essentials.length) * 100} tone={doneCount === essentials.length ? "success" : "primary"} />
          </div>
          <nav className="grid gap-0.5" aria-label="Setup steps">
            {SETUP_STEPS.map((s, i) => (
              <Link key={s.id} href={`/setup?step=${s.id}${wsQuery}`} aria-current={s.id === step ? "step" : undefined} className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors", s.id === step ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
                <StateIcon s={m.state[s.id]} />
                <span className="flex-1">
                  {i + 1}. {s.title}
                </span>
                {!s.essential && m.state[s.id] !== "done" ? <span className="text-[10px] text-subtle">optional</span> : null}
              </Link>
            ))}
          </nav>
        </aside>
        <section className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-7">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
            <div className="max-w-2xl">
              <div className="text-[12px] font-medium text-muted-foreground">
                Step {idx + 1} of {SETUP_STEPS.length}
              </div>
              <h2 className="mt-0.5 text-lg font-semibold tracking-[-0.01em]">{SETUP_STEPS[idx]!.title}</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">{DESCRIPTIONS[step]}</p>
            </div>
            <Badge tone={m.state[step] === "done" ? "success" : m.state[step] === "warn" ? "warning" : "neutral"}>{m.state[step] === "done" ? "done" : m.state[step] === "warn" ? "needs attention" : m.state[step] === "optional" ? "optional" : "to do"}</Badge>
          </div>
          {body}
          {next ? (
            <div className="mt-8 flex justify-end border-t border-border pt-5">
              <Button asChild variant={m.state[step] === "done" ? "primary" : "ghost"}>
                <Link href={`/setup?step=${next.id}${wsQuery}`}>
                  {m.state[step] === "done" ? "Next" : "Skip for now"}: {next.title} <ArrowRight />
                </Link>
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
