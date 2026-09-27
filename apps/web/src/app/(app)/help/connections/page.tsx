import type { Metadata } from "next";
import { getConfig, oauthRedirectUri, webhookUrls } from "@revenueos/core";
import { PLATFORM_CAPABILITIES } from "@revenueos/shared";
import { CopyField } from "@/components/connections/copy-field";
import { PlatformIcon } from "@/components/platform-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Help · Connections" };

interface Guide {
  id: string;
  platform: string;
  title: string;
  summary: string;
  steps: string[];
  limits: string[];
  copy?: { label: string; value: string }[];
  links: { label: string; url: string }[];
}

export default async function HelpConnections() {
  await requireUser();
  const base = getConfig().appUrl;
  const hooks = webhookUrls("<workspace-id>");
  const cap = PLATFORM_CAPABILITIES;
  const guides: Guide[] = [
    {
      id: "instagram",
      platform: "INSTAGRAM",
      title: "Instagram Reels (Instagram API with Instagram Login)",
      summary: "Requires an Instagram Professional account (Business or Creator). No Facebook Page needed.",
      steps: [
        "Go to developers.facebook.com → My Apps → Create app → type “Business”.",
        "Add the product “Instagram” → “API setup with Instagram login”.",
        `Under Business login settings, add the OAuth redirect URI shown below.`,
        `Request the permissions: ${cap.INSTAGRAM.oauthScopes.join(", ")}.`,
        "Copy the Instagram app ID and app secret into RevenueOS → Settings → Developer apps.",
        "While the app is in Development mode, add your Instagram account as a tester (App roles). For other accounts, submit App Review.",
        "In each business → Connections → Connect Instagram. You log in on Instagram's own page; RevenueOS never sees your password.",
      ],
      limits: [`Reels ${cap.INSTAGRAM.minDurationSec}–${cap.INSTAGRAM.maxDurationSec}s, up to ${cap.INSTAGRAM.dailyPublishLimit} API posts per 24h.`, "Scheduling is done by RevenueOS (the API publishes immediately).", "Metrics (views, reach, likes…) come from the Insights API."],
      copy: [{ label: "OAuth redirect URI", value: oauthRedirectUri("INSTAGRAM") }, { label: "Messages webhook (Direct)", value: hooks.instagram }],
      links: [{ label: "Content publishing docs", url: cap.INSTAGRAM.docsUrl }],
    },
    {
      id: "tiktok",
      platform: "TIKTOK",
      title: "TikTok (Content Posting API)",
      summary: "Direct posting requires TikTok's app audit. Before approval, posts are private (only you can see) or can be sent to the TikTok inbox as drafts.",
      steps: [
        "Go to developers.tiktok.com → Manage apps → Connect an app.",
        "Add the products “Login Kit” and “Content Posting API” (enable Direct Post).",
        "Add the redirect URI below under Login Kit.",
        `Scopes: ${cap.TIKTOK.oauthScopes.join(", ")}.`,
        "Copy the Client key and Client secret into Settings → Developer apps.",
        "Submit the app for audit. After approval, check “My app passed TikTok's audit” to allow public posts.",
      ],
      limits: ["Unaudited apps: SELF_ONLY visibility (RevenueOS labels these posts “private”).", "Every post is marked as AI-generated content (is_aigc).", "Creator-specific limits (max duration, privacy options) are read from creator_info before each post."],
      copy: [{ label: "OAuth redirect URI", value: oauthRedirectUri("TIKTOK") }],
      links: [{ label: "Content Posting API docs", url: cap.TIKTOK.docsUrl }],
    },
    {
      id: "youtube",
      platform: "YOUTUBE",
      title: "YouTube Shorts (YouTube Data API v3)",
      summary: "Uses a Google Cloud OAuth client. Vertical videos up to 3 minutes are published as Shorts.",
      steps: [
        "console.cloud.google.com → create a project → enable “YouTube Data API v3”.",
        "OAuth consent screen: External; add the scopes below; add yourself as a test user.",
        "Credentials → Create OAuth client ID → Web application → add the redirect URI below.",
        "Copy the Client ID and Client secret into Settings → Developer apps.",
        "Connect in each business. Google shows its own consent screen.",
      ],
      limits: ["Default quota ≈ 6 uploads/day per project (10,000 units; 1,600 per upload). Request more quota in Google Cloud if needed.", "Videos are marked with containsSyntheticMedia = true.", "Unverified apps show a warning screen during connection; verification removes it."],
      copy: [{ label: "OAuth redirect URI", value: oauthRedirectUri("YOUTUBE") }],
      links: [{ label: "Upload docs", url: cap.YOUTUBE.docsUrl }],
    },
    {
      id: "facebook",
      platform: "FACEBOOK",
      title: "Facebook Page Reels",
      summary: "Optional. Publishes Reels to a Facebook Page you manage.",
      steps: ["Use a Meta app of type Business with “Facebook Login for Business”.", "Add the redirect URI below.", `Permissions: ${cap.FACEBOOK.oauthScopes.join(", ")}.`, "Copy the Meta app ID and secret into Settings → Developer apps."],
      limits: ["Page Reels must be 3–90 seconds, 9:16."],
      copy: [{ label: "OAuth redirect URI", value: oauthRedirectUri("FACEBOOK") }],
      links: [{ label: "Reels publishing docs", url: cap.FACEBOOK.docsUrl }],
    },
    {
      id: "whatsapp",
      platform: "WHATSAPP",
      title: "WhatsApp Business (Cloud API)",
      summary: "Lets the Sales Agent reply on WhatsApp. Uses Meta's official Cloud API — no unofficial WhatsApp Web automation.",
      steps: [
        "In your Meta app, add the product “WhatsApp” and link a WhatsApp Business Account and phone number.",
        "Create a System User in Business Settings with the whatsapp_business_messaging permission and generate a permanent token.",
        "In the business → Connections → WhatsApp: paste the Phone number ID, the token and the app secret.",
        "In the Meta app → WhatsApp → Configuration: set the callback URL and verify token shown in Connections; subscribe to “messages”.",
        "Create an approved message template for follow-ups outside the 24-hour window and enter its name in the business Settings.",
      ],
      limits: ["Free-form replies only within 24 hours of the customer's last message; after that, only approved templates.", "Opt-out words (parar, sair, stop, cancelar…) mark the lead DO NOT CONTACT automatically."],
      copy: [{ label: "Callback URL", value: hooks.whatsapp }],
      links: [{ label: "Cloud API docs", url: "https://developers.facebook.com/docs/whatsapp/cloud-api" }],
    },
    {
      id: "mercadopago",
      platform: "WEBFORM",
      title: "Mercado Pago",
      summary: "Checkout Pro links (Pix, cards, boleto). Priority provider for Brazil.",
      steps: ["mercadopago.com.br/developers → Your integrations → Create application (Checkout Pro).", "Copy the production Access token (APP_USR-…).", "Webhooks → configure the notification URL shown in the business Connections page, event “Payments”, and copy the secret signature.", "Paste token and secret in the business → Connections → Mercado Pago → Save & test."],
      limits: ["A payment counts only after the signed webhook arrives and RevenueOS confirms the status through the official /v1/payments API.", "Test with TEST- credentials before going live."],
      copy: [{ label: "Notification URL format", value: hooks.mercadopago }],
      links: [{ label: "Checkout Pro docs", url: "https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/landing" }],
    },
    {
      id: "stripe",
      platform: "WEBFORM",
      title: "Stripe",
      summary: "Checkout Sessions for card payments (international).",
      steps: ["dashboard.stripe.com → Developers → API keys → create a restricted key (Checkout Sessions write, Charges read) or use the secret key.", "Developers → Webhooks → add endpoint (URL from Connections) with events checkout.session.completed and charge.refunded.", "Paste the key and the signing secret (whsec_…) in Connections → Stripe."],
      limits: ["Signatures older than 5 minutes are rejected (replay protection)."],
      copy: [{ label: "Endpoint URL format", value: hooks.stripe }],
      links: [{ label: "Stripe Checkout docs", url: "https://docs.stripe.com/payments/checkout" }],
    },
    {
      id: "storage",
      platform: "MOCK",
      title: "Cloud storage (Supabase)",
      summary: "Needed when the dashboard is hosted (e.g. Vercel) and the worker runs at home: rendered videos are uploaded shortly before posting time.",
      steps: ["Create a free project at supabase.com (also usable as the Postgres database).", "Project Settings → API: copy the Project URL and the service_role key.", "Set STORAGE_DRIVER=supabase, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the dashboard and in the worker setup.", "The bucket is created automatically (private). Delivery files are deleted after publication."],
      limits: ["Local storage is fine when everything runs on one computer."],
      links: [{ label: "Supabase Storage", url: "https://supabase.com/docs/guides/storage" }],
    },
    {
      id: "cron",
      platform: "MOCK",
      title: "Scheduler on Vercel",
      summary: "Self-hosted and local installs run the scheduler automatically. On Vercel, call the tick endpoint every minute.",
      steps: ["Set CRON_SECRET in the Vercel project.", "Add a cron (vercel.json is included) or use Supabase pg_cron / any uptime service to call the URL below with the header Authorization: Bearer <CRON_SECRET>.", "The local worker also runs the scheduler while it is online."],
      limits: ["Vercel Hobby crons run at most once per day — use Supabase pg_cron + pg_net or an external pinger for per-minute ticks."],
      copy: [{ label: "Tick URL", value: `${base}/api/cron/tick` }],
      links: [],
    },
  ];

  return (
    <>
      <PageHeader title="Help · Connections" description="Everything that needs an external account, step by step. RevenueOS only uses official APIs and OAuth — never your social passwords, browser cookies or private endpoints." />
      <nav className="mb-6 flex flex-wrap gap-2">
        {guides.map((g) => (
          <a key={g.id} href={`#${g.id}`} className="rounded-md border border-border px-2.5 py-1 text-[12px] hover:bg-muted">
            {g.title.split(" (")[0]}
          </a>
        ))}
      </nav>
      <div className="space-y-4">
        {guides.map((g) => (
          <Card key={g.id} id={g.id} className="scroll-mt-20">
            <CardHeader>
              <div className="flex items-center gap-3">
                <PlatformIcon platform={g.platform} size={28} />
                <div>
                  <CardTitle>{g.title}</CardTitle>
                  <CardDescription>{g.summary}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <ol className="list-decimal space-y-1.5 pl-5 text-[13px]">
                {g.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <div className="space-y-3">
                {g.copy?.map((c) => <CopyField key={c.label} label={c.label} value={c.value} />)}
                <div className="space-y-1">
                  {g.limits.map((l) => (
                    <div key={l} className="flex gap-2 text-[12px] text-muted-foreground">
                      <Badge tone="warning" className="shrink-0">
                        limit
                      </Badge>
                      {l}
                    </div>
                  ))}
                </div>
                {g.links.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="block text-[12px] text-primary hover:underline">
                    {l.label} ↗
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
