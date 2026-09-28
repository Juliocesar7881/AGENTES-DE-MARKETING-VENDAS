import "server-only";
import { getAISettings, getConfig, integrationOverview, oauthRedirectUri, socialAccountSummary, webhookUrls, whatsappVerifyToken } from "@revenueos/core";
import { and, count, eq, getDb, inArray, integrations, socialAccounts, sql, systemSettings, withUser } from "@revenueos/database";
import { isPublicAppUrl, PLATFORM_LABELS, type Platform } from "@revenueos/shared";
import { envFileWritable } from "@revenueos/shared/server";
import type { AppView } from "@/components/settings/apps-panel";
import { workerStatuses } from "./queries";
import { listWorkspaces, requireAdmin } from "./session";

export const SETUP_STEPS = [
  { id: "ai", title: "Connect Claude", short: "AI", essential: true },
  { id: "worker", title: "Local worker", short: "Worker", essential: true },
  { id: "business", title: "Your business", short: "Business", essential: true },
  { id: "apps", title: "Developer apps", short: "Apps", essential: true },
  { id: "accounts", title: "Social accounts", short: "Accounts", essential: true },
  { id: "payments", title: "Payments", short: "Payments", essential: false },
  { id: "whatsapp", title: "WhatsApp", short: "WhatsApp", essential: false },
  { id: "public", title: "Public address & storage", short: "Internet", essential: false },
  { id: "launch", title: "Go live", short: "Launch", essential: true },
] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number]["id"];
export type StepState = "done" | "todo" | "warn" | "optional";

/** Developer-app cards (shared by the setup wizard and Settings → Developer apps). */
export async function platformApps(): Promise<AppView[]> {
  const integ = await integrationOverview(null);
  const def = (platform: AppView["platform"], key: AppView["key"], title: string, idLabel: string, secretLabel: string, portal: string, idField: string, envId: string, envSecret: string): AppView => {
    const i = integ.find((x) => x.key === key);
    return {
      platform,
      key,
      title,
      idLabel,
      secretLabel,
      portal,
      status: i?.status ?? null,
      clientId: (i?.config?.[idField] as string | undefined) ?? null,
      hasSecret: Boolean(i?.credentials.length),
      fromEnv: !i && Boolean(process.env[envId] && process.env[envSecret]),
      audited: platform === "TIKTOK" ? Boolean(i?.config?.audited) : undefined,
      redirectUri: oauthRedirectUri(platform),
    };
  };
  return [
    def("INSTAGRAM", "instagram", "Instagram (API with Instagram Login)", "Instagram app ID", "Instagram app secret", "https://developers.facebook.com/apps", "appId", "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"),
    def("TIKTOK", "tiktok", "TikTok (Content Posting API)", "Client key", "Client secret", "https://developers.tiktok.com/apps", "clientKey", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"),
    def("YOUTUBE", "google", "YouTube (Google OAuth client)", "OAuth client ID", "OAuth client secret", "https://console.cloud.google.com/apis/credentials", "clientId", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
    def("FACEBOOK", "meta", "Facebook Pages (Meta app)", "Meta app ID", "Meta app secret", "https://developers.facebook.com/apps", "appId", "META_APP_ID", "META_APP_SECRET"),
  ];
}

export const isPublicUrl = isPublicAppUrl;

export async function aiKeyStatus() {
  const [ai, integ] = await Promise.all([getAISettings(), integrationOverview(null)]);
  const anth = integ.find((i) => i.key === "anthropic");
  const cred = anth?.credentials.find((c) => c.type === "API_KEY");
  const tr = anth?.testResult as { ok?: boolean; message?: string } | null;
  return {
    ai,
    keyStatus: { configured: Boolean(cred) || Boolean(process.env.ANTHROPIC_API_KEY), last4: cred?.last4 ?? null, fromEnv: !cred && Boolean(process.env.ANTHROPIC_API_KEY), lastTest: tr?.message ?? null, ok: tr?.ok ?? null },
    connected: anth?.status === "CONNECTED" || Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

/** Everything the setup wizard shows, computed from the real configuration. */
export async function setupModel(selectedSlug?: string | null) {
  const user = await requireAdmin();
  const cfg = getConfig();
  const [aiInfo, workers, list, apps] = await Promise.all([aiKeyStatus(), workerStatuses(), listWorkspaces(), platformApps()]);
  const live = list.filter((w) => w.environment === "LIVE");
  const liveIds = live.map((w) => w.id);
  const counts = await withUser(user.id, async (tx) => {
    if (!liveIds.length) return { social: 0, pay: 0, wa: 0 };
    const [social] = await tx.select({ n: count() }).from(socialAccounts).where(and(inArray(socialAccounts.workspaceId, liveIds), eq(socialAccounts.status, "CONNECTED")));
    const [pay] = await tx.select({ n: count() }).from(integrations).where(and(inArray(integrations.workspaceId, liveIds), sql`${integrations.key} IN ('mercadopago','stripe')`, eq(integrations.status, "CONNECTED")));
    const [wa] = await tx.select({ n: count() }).from(integrations).where(and(inArray(integrations.workspaceId, liveIds), eq(integrations.key, "whatsapp"), eq(integrations.status, "CONNECTED")));
    return { social: Number(social?.n ?? 0), pay: Number(pay?.n ?? 0), wa: Number(wa?.n ?? 0) };
  });
  const workerOnline = workers.some((w) => w.online);
  const aiOk = aiInfo.ai.provider === "claude-code-cli" ? workerOnline : aiInfo.connected;
  const appsOk = apps.filter((a) => a.status === "READY" || a.status === "CONNECTED" || a.fromEnv).length;
  const publicUrl = isPublicUrl(cfg.appUrl);
  // Last scheduler tick (system table, read with the service connection — admin-only page).
  const [lease] = await getDb().select({ updatedAt: systemSettings.updatedAt }).from(systemSettings).where(eq(systemSettings.key, "scheduler_lease")).limit(1);

  const state: Record<SetupStepId, StepState> = {
    ai: aiOk ? "done" : "todo",
    worker: workerOnline ? "done" : workers.length ? "warn" : "todo",
    business: live.length ? "done" : "todo",
    apps: appsOk ? "done" : "todo",
    accounts: counts.social ? "done" : "todo",
    payments: counts.pay ? "done" : "optional",
    whatsapp: counts.wa ? "done" : "optional",
    public: publicUrl && (cfg.storageDriver === "supabase" || !process.env.VERCEL) ? "done" : publicUrl ? "warn" : "optional",
    launch: "todo",
  };
  const essentialsDone = SETUP_STEPS.filter((s) => s.essential && s.id !== "launch").every((s) => state[s.id] === "done");
  const allLiveAutomated = live.length > 0 && live.every((w) => w.status === "ACTIVE");
  state.launch = essentialsDone && allLiveAutomated ? "done" : "todo";

  const selected = live.find((w) => w.slug === selectedSlug) ?? live[0] ?? null;
  let business: null | {
    ws: { id: string; slug: string; name: string; environment: string; targetPlatforms: string[]; operatingMode: string; status: string };
    social: Awaited<ReturnType<typeof socialAccountSummary>>;
    integrations: Awaited<ReturnType<typeof integrationOverview>>;
    webhooks: ReturnType<typeof webhookUrls>;
  } = null;
  if (selected) {
    const [social, integ] = await Promise.all([socialAccountSummary(selected.id), integrationOverview(selected.id)]);
    business = {
      ws: { id: selected.id, slug: selected.slug, name: selected.name, environment: selected.environment, targetPlatforms: selected.targetPlatforms, operatingMode: selected.operatingMode, status: selected.status },
      social,
      integrations: integ,
      webhooks: webhookUrls(selected.id),
    };
  }

  return {
    user,
    state,
    essentialsDone,
    counts,
    ai: aiInfo,
    workers,
    workerOnline,
    live: live.map((w) => ({ id: w.id, slug: w.slug, name: w.name, operatingMode: w.operatingMode, status: w.status, targetPlatforms: w.targetPlatforms })),
    apps,
    business,
    verifyToken: whatsappVerifyToken(),
    infra: {
      appUrl: cfg.appUrl,
      publicUrl,
      storageDriver: cfg.storageDriver,
      supabaseUrl: cfg.supabaseUrl,
      supabaseBucket: cfg.supabaseBucket,
      hasServiceKey: Boolean(cfg.supabaseServiceRoleKey),
      writable: envFileWritable(),
      vercel: Boolean(process.env.VERCEL),
      cronSecret: Boolean(cfg.cronSecret),
      lastTick: lease?.updatedAt?.toISOString() ?? null,
    },
  };
}

export type SetupModel = Awaited<ReturnType<typeof setupModel>>;

export interface NetworkReadiness {
  platform: string;
  state: "ready" | "private" | "blocked";
  detail: string;
  fix?: { label: string; href: string };
}

export interface BusinessReadiness {
  id: string;
  slug: string;
  name: string;
  networks: NetworkReadiness[];
  notes: string[];
}

/**
 * "Will it really post?" — per business and network: ready (public posts), private (the platform
 * keeps API posts private until it audits your app) or blocked (with the exact fix).
 */
export async function postingReadiness(m: SetupModel): Promise<BusinessReadiness[]> {
  const tiktokAudited = Boolean(m.apps.find((a) => a.platform === "TIKTOK")?.audited);
  const global: NetworkReadiness | null = m.state.ai !== "done" ? { platform: "*", state: "blocked", detail: "Claude is not connected — no videos can be written.", fix: { label: "Connect Claude", href: "/setup?step=ai" } } : null;
  const out: BusinessReadiness[] = [];
  for (const w of m.live) {
    const summary = await socialAccountSummary(w.id);
    const networks: NetworkReadiness[] = [];
    for (const p of w.targetPlatforms) {
      const accs = summary.accounts.filter((a) => a.platform === p && a.enabled && !a.isDemo);
      const ok = accs.find((a) => a.status === "CONNECTED");
      const label = PLATFORM_LABELS[p as Platform] ?? p;
      if (!summary.appConfigured[p]) networks.push({ platform: p, state: "blocked", detail: `${label}: developer app not configured.`, fix: { label: "Add the app", href: "/setup?step=apps" } });
      else if (!ok) networks.push({ platform: p, state: "blocked", detail: accs.length ? `${label}: the connected account needs attention (${accs[0]!.status.toLowerCase().replace("_", " ")}).` : `${label}: no account connected.`, fix: { label: accs.length ? "Reconnect" : "Connect", href: `/setup?step=accounts&ws=${w.slug}` } });
      else if (p === "TIKTOK" && !tiktokAudited) networks.push({ platform: p, state: "private", detail: `TikTok @${ok.username}: posts are visible only to you until TikTok audits your app (you can then enable public posting).` });
      else if (p === "YOUTUBE") networks.push({ platform: p, state: "ready", detail: `YouTube @${ok.username}: public once your Google project passed the YouTube API audit — before that, YouTube keeps API uploads private.` });
      else networks.push({ platform: p, state: "ready", detail: `${label} @${ok.username}: posts go out publicly.` });
    }
    if (global) networks.unshift(global);
    if (!m.workerOnline) networks.unshift({ platform: "*", state: "blocked", detail: "The local worker is offline — videos cannot be rendered.", fix: { label: "Start the worker", href: "/setup?step=worker" } });
    const notes: string[] = [];
    if (!m.infra.publicUrl) notes.push("No public address yet: captions link straight to your WhatsApp with the video's code (leads are still attributed), but link clicks are not counted and payment confirmations cannot arrive.");
    out.push({ id: w.id, slug: w.slug, name: w.name, networks, notes });
  }
  return out;
}
