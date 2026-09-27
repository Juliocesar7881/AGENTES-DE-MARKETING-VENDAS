import { CircleCheck, CircleDashed, CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAISettings, getConfig, integrationOverview, isPlatformAppConfigured } from "@revenueos/core";
import { and, count, eq, integrations, socialAccounts, sql, withUser } from "@revenueos/database";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, Progress } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { workerStatuses } from "@/server/queries";
import { listWorkspaces, requireAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Setup" };

interface Step {
  title: string;
  detail: string;
  state: "done" | "todo" | "warn";
  href?: string;
  cta?: string;
  optional?: boolean;
}

export default async function SetupPage() {
  const user = await requireAdmin();
  const cfg = getConfig();
  const [ai, globalInteg, workers, list] = await Promise.all([getAISettings(), integrationOverview(null), workerStatuses(), listWorkspaces()]);
  const live = list.filter((w) => w.environment === "LIVE");
  const liveIds = live.map((w) => w.id);
  const counts = await withUser(user.id, async (tx) => {
    const [social] = liveIds.length ? await tx.select({ n: count() }).from(socialAccounts).where(and(eq(socialAccounts.isDemo, false), eq(socialAccounts.status, "CONNECTED"))) : [{ n: 0 }];
    const [pay] = liveIds.length ? await tx.select({ n: count() }).from(integrations).where(and(sql`${integrations.key} IN ('mercadopago','stripe')`, eq(integrations.status, "CONNECTED"))) : [{ n: 0 }];
    const [wa] = liveIds.length ? await tx.select({ n: count() }).from(integrations).where(and(eq(integrations.key, "whatsapp"), eq(integrations.status, "CONNECTED"))) : [{ n: 0 }];
    return { social: Number(social?.n ?? 0), pay: Number(pay?.n ?? 0), wa: Number(wa?.n ?? 0) };
  });
  const aiOk = ai.provider === "claude-code-cli" ? workers.some((w) => w.online) : Boolean(globalInteg.find((i) => i.key === "anthropic" && i.status === "CONNECTED")) || Boolean(process.env.ANTHROPIC_API_KEY);
  const appsConfigured = (await Promise.all((["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK"] as const).map((p) => isPlatformAppConfigured(p)))).filter(Boolean).length;
  const workerOnline = workers.some((w) => w.online);

  const steps: Step[] = [
    { title: "Database & security", detail: "Migrations applied, Row Level Security active, encryption key configured.", state: process.env.APP_ENCRYPTION_KEY ? "done" : "warn" },
    { title: "Administrator account", detail: `Signed in as ${user.email}.`, state: "done" },
    { title: "Connect Claude", detail: aiOk ? `Using ${ai.provider === "anthropic" ? "the Anthropic API" : "Claude Code CLI on the worker"}.` : "Add an Anthropic API key (or use the official Claude Code CLI on the worker).", state: aiOk ? "done" : "todo", href: "/settings?tab=ai", cta: "AI settings" },
    { title: "Install the local worker", detail: workerOnline ? "Worker online — renders run on your computer." : workers.length ? "Worker installed but offline. Start it with start-worker.bat." : "Renders MP4s with Remotion + FFmpeg on your PC. Run setup-worker.bat.", state: workerOnline ? "done" : workers.length ? "warn" : "todo", href: "/settings?tab=worker", cta: "How to install" },
    { title: "Create your first LIVE business", detail: live.length ? `${live.length} live business${live.length > 1 ? "es" : ""}.` : "Onboarding: website, brand, products, audience, schedule.", state: live.length ? "done" : "todo", href: "/onboarding", cta: "Create business" },
    { title: "Developer apps for social platforms", detail: `${appsConfigured} of 4 configured (Instagram, TikTok, YouTube, Facebook).`, state: appsConfigured >= 1 ? "done" : "todo", href: "/settings?tab=integrations", cta: "Developer apps" },
    { title: "Connect social accounts", detail: counts.social ? `${counts.social} account(s) connected and tested.` : "Each business connects its own accounts via official OAuth.", state: counts.social ? "done" : "todo", href: live[0] ? `/w/${live[0].slug}/connections` : "/onboarding", cta: "Connections" },
    { title: "Cloud storage for publishing", detail: cfg.storageDriver === "supabase" ? "Supabase Storage configured." : "Local storage works when dashboard and worker run on the same PC. For a hosted dashboard, use Supabase Storage.", state: cfg.storageDriver === "supabase" ? "done" : "warn", optional: true, href: "/help/connections#storage", cta: "Guide" },
    { title: "Payments", detail: counts.pay ? "Mercado Pago / Stripe connected." : "Connect Mercado Pago (Pix, cards) or Stripe so the Sales Agent can send checkout links.", state: counts.pay ? "done" : "todo", href: live[0] ? `/w/${live[0].slug}/connections` : "/onboarding", cta: "Connect payments" },
    { title: "WhatsApp Business", detail: counts.wa ? "WhatsApp Cloud API connected." : "Lets the Sales Agent answer leads on WhatsApp (the lead form works without it).", state: counts.wa ? "done" : "todo", optional: true, href: live[0] ? `/w/${live[0].slug}/connections` : "/onboarding", cta: "Connect WhatsApp" },
    { title: "Scheduler", detail: process.env.VERCEL ? (cfg.cronSecret ? "Vercel Cron calls /api/cron/tick (protected by CRON_SECRET)." : "Set CRON_SECRET and configure Vercel Cron.") : "Runs inside the dashboard and the worker automatically.", state: process.env.VERCEL && !cfg.cronSecret ? "warn" : "done", href: "/help/connections#cron", cta: "Guide" },
  ];
  const done = steps.filter((s) => s.state === "done").length;

  return (
    <>
      <PageHeader title="Setup checklist" description="Everything RevenueOS needs to run for real. The demo businesses work without any of it." />
      <Card className="mb-4">
        <CardContent className="pt-5">
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-medium">
              {done} of {steps.length} complete
            </span>
            <span className="text-muted-foreground">{Math.round((done / steps.length) * 100)}%</span>
          </div>
          <Progress value={(done / steps.length) * 100} tone={done === steps.length ? "success" : "primary"} />
        </CardContent>
      </Card>
      <div className="space-y-2">
        {steps.map((s) => (
          <div key={s.title} className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
            {s.state === "done" ? <CircleCheck className="mt-0.5 size-5 text-success" /> : s.state === "warn" ? <CircleAlert className="mt-0.5 size-5 text-warning" /> : <CircleDashed className="mt-0.5 size-5 text-subtle" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {s.title}
                {s.optional ? <span className="text-[11px] font-normal text-subtle">optional</span> : null}
              </div>
              <div className={cn("text-[13px]", s.state === "done" ? "text-muted-foreground" : "text-foreground/80")}>{s.detail}</div>
            </div>
            {s.href && s.state !== "done" ? (
              <Link href={s.href} className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium hover:bg-muted">
                {s.cta}
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
