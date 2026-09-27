import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_AI_SETTINGS, ECONOMY_MODEL_PRESET } from "@revenueos/shared";
import { getAISettings, getConfig, getGlobalSettings, integrationOverview, oauthRedirectUri } from "@revenueos/core";
import { auditLogs, desc, eq, withUser, workspaces } from "@revenueos/database";
import { AccountPanel } from "@/components/settings/account-panel";
import { AISettingsPanel } from "@/components/settings/ai-settings";
import { AppsPanel, type AppView } from "@/components/settings/apps-panel";
import { SystemPanel } from "@/components/settings/system-panel";
import { WorkerPanel } from "@/components/settings/worker-panel";
import { PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { workerStatuses } from "@/server/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Settings" };

const TABS = [
  ["ai", "AI & Claude", true],
  ["integrations", "Developer apps", true],
  ["worker", "Local worker", false],
  ["system", "System & security", true],
  ["account", "Account", false],
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const requested = (await searchParams).tab ?? (user.isAdmin ? "ai" : "account");
  const tabs = TABS.filter(([, , adminOnly]) => !adminOnly || user.isAdmin);
  const tab = tabs.find(([k]) => k === requested)?.[0] ?? tabs[0]![0];

  let body: React.ReactNode = null;
  if (tab === "ai") {
    const [ai, global, integ] = await Promise.all([getAISettings(), getGlobalSettings(), integrationOverview(null)]);
    const anth = integ.find((i) => i.key === "anthropic");
    const cred = anth?.credentials.find((c) => c.type === "API_KEY");
    const tr = anth?.testResult as { ok?: boolean; message?: string } | null;
    body = (
      <AISettingsPanel
        provider={ai.provider === "mock" ? "anthropic" : ai.provider}
        demoProvider={ai.demoProvider}
        models={ai.models}
        promptCaching={ai.promptCaching}
        claudeCliPath={ai.claudeCliPath ?? ""}
        availableModels={ai.availableModels}
        keyStatus={{ configured: Boolean(cred) || Boolean(process.env.ANTHROPIC_API_KEY), last4: cred?.last4 ?? null, fromEnv: !cred && Boolean(process.env.ANTHROPIC_API_KEY), lastTest: tr?.message ?? null, ok: tr?.ok ?? null }}
        economy={ECONOMY_MODEL_PRESET}
        defaults={DEFAULT_AI_SETTINGS.models}
        globalBudget={global.globalMonthlyAiBudgetUsd}
      />
    );
  } else if (tab === "integrations") {
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
    body = (
      <AppsPanel
        apps={[
          def("INSTAGRAM", "instagram", "Instagram (API with Instagram Login)", "Instagram app ID", "Instagram app secret", "https://developers.facebook.com/apps", "appId", "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"),
          def("TIKTOK", "tiktok", "TikTok (Content Posting API)", "Client key", "Client secret", "https://developers.tiktok.com/apps", "clientKey", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"),
          def("YOUTUBE", "google", "YouTube (Google OAuth client)", "OAuth client ID", "OAuth client secret", "https://console.cloud.google.com/apis/credentials", "clientId", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
          def("FACEBOOK", "meta", "Facebook Pages (Meta app)", "Meta app ID", "Meta app secret", "https://developers.facebook.com/apps", "appId", "META_APP_ID", "META_APP_SECRET"),
        ]}
      />
    );
  } else if (tab === "worker") {
    body = <WorkerPanel workers={await workerStatuses()} isAdmin={user.isAdmin} />;
  } else if (tab === "system") {
    const cfg = getConfig();
    const global = await getGlobalSettings();
    const audit = await withUser(user.id, (tx) =>
      tx.select({ a: auditLogs, ws: workspaces.name }).from(auditLogs).leftJoin(workspaces, eq(workspaces.id, auditLogs.workspaceId)).orderBy(desc(auditLogs.createdAt)).limit(60),
    );
    body = (
      <SystemPanel
        settings={{ deliveryLeadHours: global.deliveryLeadHours, workerOfflineAfterSec: global.workerOfflineAfterSec }}
        info={[
          { label: "App URL", value: cfg.appUrl, ok: cfg.env !== "production" || cfg.appUrl.startsWith("https://") },
          { label: "Environment", value: cfg.env, ok: true },
          { label: "Encryption key", value: process.env.APP_ENCRYPTION_KEY ? "configured" : "missing", ok: Boolean(process.env.APP_ENCRYPTION_KEY) },
          { label: "Storage", value: cfg.storageDriver === "supabase" ? `Supabase (${cfg.supabaseBucket})` : "local disk", ok: cfg.storageDriver === "supabase" || cfg.env !== "production" },
          { label: "Cron secret", value: cfg.cronSecret ? "configured" : "not set", ok: Boolean(cfg.cronSecret) },
          { label: "Demo mode", value: cfg.demoEnabled ? "enabled" : "disabled", ok: true },
          { label: "Scheduler", value: process.env.VERCEL ? "Vercel Cron → /api/cron/tick" : "embedded in the dashboard + local worker", ok: true },
        ]}
        audit={audit.map(({ a, ws }) => ({ id: a.id, action: a.action, actor: a.actorType.toLowerCase(), at: a.createdAt.toISOString(), ws }))}
      />
    );
  } else {
    body = <AccountPanel name={user.name} email={user.email} isDemo={user.isDemo} />;
  }

  return (
    <>
      <PageHeader title="Settings" description={user.isAdmin ? "System-wide configuration. Business-specific settings live in each business." : "Your account."} />
      <div className="mb-6 flex flex-wrap gap-1 border-b border-border">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/settings?tab=${k}`} className={cn("relative -mb-px border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground", tab === k && "border-primary text-foreground")}>
            {label}
          </Link>
        ))}
      </div>
      {body}
    </>
  );
}
