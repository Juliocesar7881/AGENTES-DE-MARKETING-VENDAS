import { and, eq, socialAccounts, type workspaces } from "@revenueos/database";
import type { AgentRuntime } from "@revenueos/agents";
import { AnthropicAPIProvider, ClaudeCodeCLIProvider, MockAIProvider, type AIProvider } from "@revenueos/providers/ai";
import { InstagramDMProvider, MockMessagingProvider, WhatsAppCloudProvider, type MessagingProvider } from "@revenueos/providers/messaging";
import { MercadoPagoProvider, MockPaymentProvider, StripeProvider, type PaymentProvider } from "@revenueos/providers/payment";
import {
  FacebookProvider,
  InstagramProvider,
  MockSocialProvider,
  TikTokProvider,
  YouTubeProvider,
  type SocialAccountInfo,
  type SocialCredentials,
  type SocialProvider,
} from "@revenueos/providers/social";
import { LocalStorageProvider, SupabaseStorageProvider, type StorageProvider } from "@revenueos/providers/storage";
import { AppError, NotConfiguredError, type MessagingChannel, type ModelSlot, type Platform } from "@revenueos/shared";
import { deriveKey, getConfig } from "../config";
import { db, isLocalWorker, overrides } from "../deps";
import { getIntegration, integrationSecret, readCredential, saveCredential } from "../secrets";
import { getAISettings } from "../settings";

export type Workspace = typeof workspaces.$inferSelect;
export type SocialAccount = typeof socialAccounts.$inferSelect;

export function isDemo(ws: Pick<Workspace, "environment">): boolean {
  return ws.environment === "DEMO";
}

/* ------------------------------ AI ------------------------------ */

export interface ResolvedAI {
  runtime: AgentRuntime;
  providerId: AIProvider["id"];
  isMock: boolean;
}

/**
 * Resolves the AI provider for a workspace + model slot. DEMO workspaces use
 * the MockAIProvider (unless the admin opts in to real AI for demos). LIVE
 * workspaces NEVER fall back to mock: missing credentials raise a clear error.
 */
export async function resolveAI(ws: Pick<Workspace, "id" | "environment"> | null, slot: ModelSlot): Promise<ResolvedAI> {
  const settings = await getAISettings();
  const model = settings.models[slot];
  const demo = ws ? isDemo(ws) : false;
  const override = overrides().ai?.({ workspaceId: ws?.id ?? null, isDemo: demo });
  const opts = { prices: settings.prices, timeoutMs: settings.requestTimeoutMs, promptCaching: settings.promptCaching };
  let ai: AIProvider;
  if (override) ai = override;
  else if (demo && settings.demoProvider === "mock") ai = new MockAIProvider(opts);
  else if (settings.provider === "mock") ai = new MockAIProvider(opts);
  else if (settings.provider === "claude-code-cli") {
    if (!isLocalWorker()) {
      throw new AppError({
        code: "AI_CLI_REMOTE",
        userMessage: "The Claude Code (local login) provider only runs on the local worker. Start the worker or switch Settings → AI to the Anthropic API.",
        retryable: true,
        retryAfterSec: 600,
      });
    }
    ai = new ClaudeCodeCLIProvider(settings.claudeCliPath || process.env.CLAUDE_CLI_PATH || "claude", opts);
  } else {
    const key = await integrationSecret("anthropic", null, "API_KEY", "ANTHROPIC_API_KEY");
    if (!key) throw new NotConfiguredError("Claude (Anthropic API)", "Add your Anthropic API key in Settings → AI.");
    ai = new AnthropicAPIProvider(key, opts);
  }
  return { runtime: { ai, model, timeoutMs: settings.requestTimeoutMs }, providerId: ai.id, isMock: ai.isMock };
}

/** Runner for AI jobs: the local CLI provider forces AI work onto the local worker. */
export async function aiRunnerFor(defaultRunner: "ANY" | "LOCAL"): Promise<"ANY" | "LOCAL"> {
  const s = await getAISettings();
  return s.provider === "claude-code-cli" ? "LOCAL" : defaultRunner;
}

/* ------------------------------ Social ------------------------------ */

async function appConfig(platform: Platform): Promise<{ clientId: string; clientSecret: string; audited?: boolean; apiVersion?: string } | null> {
  const cfg = getConfig();
  const map: Record<string, { key: "instagram" | "meta" | "tiktok" | "google"; idEnv: string; secretEnv: string; idField: string; secretType: "APP_SECRET" | "CLIENT_SECRET" }> = {
    INSTAGRAM: { key: "instagram", idEnv: "INSTAGRAM_APP_ID", secretEnv: "INSTAGRAM_APP_SECRET", idField: "appId", secretType: "APP_SECRET" },
    FACEBOOK: { key: "meta", idEnv: "META_APP_ID", secretEnv: "META_APP_SECRET", idField: "appId", secretType: "APP_SECRET" },
    TIKTOK: { key: "tiktok", idEnv: "TIKTOK_CLIENT_KEY", secretEnv: "TIKTOK_CLIENT_SECRET", idField: "clientKey", secretType: "CLIENT_SECRET" },
    YOUTUBE: { key: "google", idEnv: "GOOGLE_CLIENT_ID", secretEnv: "GOOGLE_CLIENT_SECRET", idField: "clientId", secretType: "CLIENT_SECRET" },
  };
  const m = map[platform];
  if (!m) return null;
  const integ = await getIntegration(m.key, null);
  const clientId = (integ?.config?.[m.idField] as string | undefined) || process.env[m.idEnv] || "";
  const clientSecret = (await integrationSecret(m.key, null, m.secretType, m.secretEnv)) ?? "";
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    audited: platform === "TIKTOK" ? Boolean(integ?.config?.audited ?? process.env.TIKTOK_APP_AUDITED === "true") : undefined,
    apiVersion: platform === "INSTAGRAM" || platform === "FACEBOOK" ? cfg.metaGraphVersion : undefined,
  };
}

export function oauthRedirectUri(platform: Platform): string {
  return `${getConfig().appUrl}/api/oauth/${platform.toLowerCase()}/callback`;
}

export async function isPlatformAppConfigured(platform: Platform): Promise<boolean> {
  if (platform === "MOCK") return true;
  return (await appConfig(platform)) != null;
}

export async function socialProviderFor(platform: Platform, opts: { workspaceId: string; isDemo: boolean; accountIsDemo?: boolean }): Promise<SocialProvider> {
  const override = overrides().social?.({ workspaceId: opts.workspaceId, platform, isDemo: opts.isDemo });
  if (override) return override;
  if (platform === "MOCK" || opts.accountIsDemo) return new MockSocialProvider({ platform: platform === "MOCK" ? "MOCK" : platform });
  const cfg = await appConfig(platform);
  if (!cfg) {
    throw new NotConfiguredError(`${platform} developer app`, `Add the app credentials in Integrations → ${platform} (step-by-step guide in Help → Connections).`);
  }
  const app = { ...cfg, redirectUri: oauthRedirectUri(platform) };
  switch (platform) {
    case "INSTAGRAM":
      return new InstagramProvider(app);
    case "FACEBOOK":
      return new FacebookProvider(app);
    case "TIKTOK":
      return new TikTokProvider(app);
    case "YOUTUBE":
      return new YouTubeProvider(app);
    default:
      throw new AppError({ code: "UNKNOWN_PLATFORM", userMessage: `Unsupported platform ${platform}` });
  }
}

export async function loadSocialCredentials(accountId: string): Promise<SocialCredentials> {
  const accessToken = await readCredential({ socialAccountId: accountId }, "ACCESS_TOKEN");
  if (!accessToken) throw new AppError({ code: "SOCIAL_NO_TOKEN", userMessage: "This social account has no stored credentials. Reconnect it in Integrations." });
  const refreshToken = await readCredential({ socialAccountId: accountId }, "REFRESH_TOKEN");
  const extraRaw = await readCredential({ socialAccountId: accountId }, "EXTRA_JSON");
  const account = (await db().select().from(socialAccounts).where(eq(socialAccounts.id, accountId)).limit(1))[0];
  return {
    accessToken,
    refreshToken,
    expiresAt: account?.tokenExpiresAt ?? null,
    refreshExpiresAt: account?.refreshExpiresAt ?? null,
    extra: extraRaw ? (JSON.parse(extraRaw) as Record<string, string>) : undefined,
  };
}

export async function storeSocialCredentials(account: Pick<SocialAccount, "id" | "workspaceId">, creds: SocialCredentials): Promise<void> {
  const owner = { workspaceId: account.workspaceId, socialAccountId: account.id };
  await saveCredential(owner, "ACCESS_TOKEN", creds.accessToken, creds.expiresAt ?? null);
  if (creds.refreshToken) await saveCredential(owner, "REFRESH_TOKEN", creds.refreshToken, creds.refreshExpiresAt ?? null);
  if (creds.extra) await saveCredential(owner, "EXTRA_JSON", JSON.stringify(creds.extra));
  await db()
    .update(socialAccounts)
    .set({ tokenExpiresAt: creds.expiresAt ?? null, refreshExpiresAt: creds.refreshExpiresAt ?? null })
    .where(eq(socialAccounts.id, account.id));
}

export function accountInfo(a: SocialAccount): SocialAccountInfo {
  return { externalAccountId: a.externalAccountId, username: a.username, displayName: a.displayName, avatarUrl: a.avatarUrl, scopes: a.scopes, metadata: a.metadata };
}

/**
 * Returns fresh credentials, refreshing tokens that expire within 24h when the
 * provider supports it. Marks the account EXPIRED when refresh is impossible.
 */
export async function freshCredentials(provider: SocialProvider, account: SocialAccount): Promise<SocialCredentials> {
  let creds = await loadSocialCredentials(account.id);
  const soon = creds.expiresAt && creds.expiresAt.getTime() - Date.now() < 24 * 3600 * 1000;
  if (soon) {
    try {
      const refreshed = await provider.refreshAuth(creds);
      if (refreshed) {
        await storeSocialCredentials(account, { ...refreshed, extra: refreshed.extra ?? creds.extra });
        creds = { ...refreshed, extra: refreshed.extra ?? creds.extra };
      }
    } catch (e) {
      if (creds.expiresAt && creds.expiresAt.getTime() < Date.now()) {
        await db()
          .update(socialAccounts)
          .set({ status: "EXPIRED", lastError: e instanceof AppError ? e.userMessage : "Token refresh failed" })
          .where(eq(socialAccounts.id, account.id));
        throw e;
      }
    }
  }
  return creds;
}

export async function connectedAccounts(workspaceId: string) {
  return db()
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.workspaceId, workspaceId), eq(socialAccounts.enabled, true)));
}

/* ------------------------------ Messaging ------------------------------ */

export async function messagingProviderFor(ws: Workspace, channel: MessagingChannel): Promise<MessagingProvider> {
  const demo = isDemo(ws);
  const override = overrides().messaging?.({ workspaceId: ws.id, channel, isDemo: demo });
  if (override) return override;
  if (demo || channel === "MOCK") return new MockMessagingProvider(channel);
  if (channel === "WHATSAPP") {
    const integ = await getIntegration("whatsapp", ws.id);
    const phoneNumberId = integ?.config?.phoneNumberId as string | undefined;
    const accessToken = await integrationSecret("whatsapp", ws.id, "ACCESS_TOKEN");
    const appSecret = (await integrationSecret("whatsapp", ws.id, "APP_SECRET")) ?? (await integrationSecret("meta", null, "APP_SECRET", "META_APP_SECRET")) ?? "";
    if (!phoneNumberId || !accessToken) throw new NotConfiguredError("WhatsApp Business", "Connect WhatsApp in Integrations → WhatsApp.");
    return new WhatsAppCloudProvider({ phoneNumberId, accessToken, appSecret, apiVersion: getConfig().metaGraphVersion });
  }
  if (channel === "INSTAGRAM") {
    const [ig] = await db()
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.workspaceId, ws.id), eq(socialAccounts.platform, "INSTAGRAM")))
      .limit(1);
    if (!ig || !ig.scopes.includes("instagram_business_manage_messages")) {
      throw new NotConfiguredError("Instagram Direct messaging", "Reconnect Instagram and approve the messaging permission (instagram_business_manage_messages).");
    }
    const creds = await loadSocialCredentials(ig.id);
    const appSecret = (await integrationSecret("instagram", null, "APP_SECRET", "INSTAGRAM_APP_SECRET")) ?? "";
    return new InstagramDMProvider({ igUserId: ig.externalAccountId, accessToken: creds.accessToken, appSecret, apiVersion: getConfig().metaGraphVersion });
  }
  throw new AppError({ code: "CHANNEL_NO_OUTBOUND", userMessage: "This lead came from a web form. Reply by phone/email or start a WhatsApp conversation.", retryable: false });
}

/* ------------------------------ Payments ------------------------------ */

export async function paymentProviderFor(ws: Workspace, preferred?: "MERCADOPAGO" | "STRIPE" | "MOCK"): Promise<PaymentProvider> {
  const demo = isDemo(ws);
  const override = overrides().payment?.({ workspaceId: ws.id, isDemo: demo });
  if (override) return override;
  if (demo || preferred === "MOCK") {
    if (!demo) throw new AppError({ code: "MOCK_PAYMENT_LIVE", userMessage: "Mock payments are only available in DEMO workspaces." });
    return new MockPaymentProvider(deriveKey("mock-payments"), getConfig().appUrl);
  }
  if (preferred !== "STRIPE") {
    const token = await integrationSecret("mercadopago", ws.id, "ACCESS_TOKEN");
    if (token) return new MercadoPagoProvider({ accessToken: token, webhookSecret: (await integrationSecret("mercadopago", ws.id, "WEBHOOK_SECRET")) ?? "" });
    if (preferred === "MERCADOPAGO") throw new NotConfiguredError("Mercado Pago", "Connect Mercado Pago in Integrations → Payments.");
  }
  const sk = await integrationSecret("stripe", ws.id, "SECRET_KEY");
  if (sk) return new StripeProvider({ secretKey: sk, webhookSecret: (await integrationSecret("stripe", ws.id, "WEBHOOK_SECRET")) ?? "" });
  throw new NotConfiguredError("A payment provider", "Connect Mercado Pago or Stripe in Integrations → Payments to send checkout links.");
}

/* ------------------------------ Storage ------------------------------ */

let storageSingleton: StorageProvider | null = null;

export function storage(): StorageProvider {
  const o = overrides().storage;
  if (o) return o();
  if (storageSingleton) return storageSingleton;
  const cfg = getConfig();
  storageSingleton =
    cfg.storageDriver === "supabase"
      ? new SupabaseStorageProvider(cfg.supabaseUrl ?? "", cfg.supabaseServiceRoleKey ?? "", cfg.supabaseBucket)
      : new LocalStorageProvider(cfg.storageLocalDir, cfg.appUrl, deriveKey("file-urls"));
  return storageSingleton;
}

export function resetStorageSingleton(): void {
  storageSingleton = null;
}
