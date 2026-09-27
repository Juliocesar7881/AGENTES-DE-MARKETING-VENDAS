import { and, eq, integrationCredentialsMetadata, integrations, isNull, lt, messages, oauthStates, profiles, socialAccounts, sql, workspaces } from "@revenueos/database";
import { MercadoPagoProvider, StripeProvider } from "@revenueos/providers/payment";
import { parseInstagramWebhook, parseWhatsAppWebhook, verifyMetaSignature, type MessagingEvent } from "@revenueos/providers/messaging";
import type { ConnectionTestResult, SocialAccountInfo } from "@revenueos/providers/social";
import { AnthropicAPIProvider } from "@revenueos/providers/ai";
import { AppError, AuthorizationError, createLogger, PLATFORM_LABELS, ValidationError, type IntegrationKey, type Platform } from "@revenueos/shared";
import { decryptSecret, encryptSecret, pkcePair, randomToken, sha256Hex } from "@revenueos/shared/server";
import { z } from "zod";
import { deriveKey, getConfig } from "../config";
import { db, now } from "../deps";
import { accountInfo, freshCredentials, isPlatformAppConfigured, loadSocialCredentials, socialProviderFor, storeSocialCredentials } from "../providers";
import { audit, notify, recordActivity } from "../records";
import { deleteCredentials, getIntegration, saveCredential, upsertIntegration, type CredentialType } from "../secrets";
import { getAISettings } from "../settings";
import { processInboundMessage } from "./leads";
import { assertMember } from "./workspaces";

const log = createLogger({ component: "connections" });

async function assertAdmin(userId: string): Promise<void> {
  const [u] = await db().select({ isAdmin: profiles.isAdmin }).from(profiles).where(eq(profiles.id, userId)).limit(1);
  if (!u?.isAdmin) throw new AuthorizationError("Only the system administrator can change global integrations.");
}

async function liveWorkspace(workspaceId: string, userId: string) {
  await assertMember(userId, workspaceId);
  const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!ws) throw new AuthorizationError("Workspace not found.");
  return ws;
}

/* ─────────────────────────── Social OAuth ─────────────────────────── */

export const CONNECTABLE_PLATFORMS: Platform[] = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"];

/**
 * Step 1: official OAuth authorization URL. The state is random, stored only
 * as a hash, bound to the user + workspace + platform, expires in 10 minutes,
 * and the PKCE verifier is sealed (AES-GCM) in the row. We never ask for social passwords.
 */
export async function startSocialConnect(opts: { userId: string; workspaceId: string; platform: Platform }): Promise<string> {
  const ws = await liveWorkspace(opts.workspaceId, opts.userId);
  if (!CONNECTABLE_PLATFORMS.includes(opts.platform)) throw new ValidationError("Unsupported platform.");
  if (ws.environment === "DEMO") throw new ValidationError("DEMO workspaces use simulated accounts. Create a LIVE business to connect real social accounts.");
  const provider = await socialProviderFor(opts.platform, { workspaceId: ws.id, isDemo: false });
  const state = randomToken(24);
  const pkce = provider.usesPkce ? pkcePair() : null;
  await db().delete(oauthStates).where(lt(oauthStates.expiresAt, now()));
  await db()
    .insert(oauthStates)
    .values({
      stateHash: sha256Hex(state),
      workspaceId: ws.id,
      userId: opts.userId,
      provider: opts.platform,
      sealed: encryptSecret(JSON.stringify({ verifier: pkce?.verifier ?? null })),
      redirectTo: `/w/${ws.slug}/connections`,
      expiresAt: new Date(now().getTime() + 10 * 60 * 1000),
    });
  return provider.connect({ state, codeChallenge: pkce?.challenge });
}

function statusFromTest(t: ConnectionTestResult): "CONNECTED" | "NEEDS_ACTION" | "ERROR" {
  if (!t.authenticated) return "ERROR";
  if (!t.permissionsOk || !t.accountOk || !t.publishPermissionOk || t.actionRequired) return "NEEDS_ACTION";
  return "CONNECTED";
}

/** Step 2: callback. Verifies state ownership, exchanges the code, stores tokens encrypted, tests the connection. */
export async function completeSocialConnect(opts: { platform: Platform; state: string; code: string; userId: string }): Promise<{ redirectTo: string; accountId: string; status: string }> {
  const [st] = await db().select().from(oauthStates).where(eq(oauthStates.stateHash, sha256Hex(opts.state))).limit(1);
  if (!st || st.expiresAt < now()) throw new AppError({ code: "OAUTH_STATE", userMessage: "This connection link expired. Start the connection again.", httpStatus: 400 });
  await db().delete(oauthStates).where(eq(oauthStates.id, st.id));
  if (st.userId !== opts.userId || st.provider !== opts.platform || !st.workspaceId) throw new AppError({ code: "OAUTH_STATE", userMessage: "Connection could not be verified. Start again from the same browser.", httpStatus: 400 });
  const ws = await liveWorkspace(st.workspaceId, opts.userId);
  const sealed = st.sealed ? (JSON.parse(decryptSecret(st.sealed)) as { verifier: string | null }) : { verifier: null };
  const provider = await socialProviderFor(opts.platform, { workspaceId: ws.id, isDemo: false });
  const result = await provider.completeConnect({ code: opts.code, codeVerifier: sealed.verifier ?? undefined });
  const acc = result.account;
  const [row] = await db()
    .insert(socialAccounts)
    .values({
      workspaceId: ws.id,
      platform: opts.platform,
      externalAccountId: acc.externalAccountId,
      username: acc.username,
      displayName: acc.displayName ?? null,
      avatarUrl: acc.avatarUrl ?? null,
      scopes: acc.scopes,
      metadata: acc.metadata ?? {},
      status: "CONNECTED",
      connectedBy: opts.userId,
      capabilities: provider.capabilities as unknown as Record<string, unknown>,
      enabled: true,
      isDemo: false,
    })
    .onConflictDoUpdate({
      target: [socialAccounts.workspaceId, socialAccounts.platform, socialAccounts.externalAccountId],
      set: { username: acc.username, displayName: acc.displayName ?? null, avatarUrl: acc.avatarUrl ?? null, scopes: acc.scopes, metadata: acc.metadata ?? {}, status: "CONNECTED", enabled: true, lastError: null, connectedBy: opts.userId },
    })
    .returning();
  await storeSocialCredentials(row!, result.credentials);
  const test = await testSocialAccount(row!.id, opts.userId).catch((e: unknown) => ({ status: "ERROR", error: e instanceof AppError ? e.userMessage : String(e) }));
  await audit({ workspaceId: ws.id, actorType: "USER", actorId: opts.userId, action: "social.connected", entityType: "social_account", entityId: row!.id, details: { platform: opts.platform, username: acc.username } });
  await recordActivity({ workspaceId: ws.id, type: "SOCIAL_CONNECTED", title: `${PLATFORM_LABELS[opts.platform]} connected: @${acc.username}`, actorType: "USER", actorId: opts.userId });
  return { redirectTo: st.redirectTo ?? `/w/${ws.slug}/connections`, accountId: row!.id, status: String((test as { status: string }).status) };
}

/** Connection test: authentication, permissions, account type, publish permission. Updates ACTION REQUIRED. */
export async function testSocialAccount(accountId: string, userId: string): Promise<{ status: string; test: ConnectionTestResult | null; error?: string }> {
  const [acc] = await db().select().from(socialAccounts).where(eq(socialAccounts.id, accountId)).limit(1);
  if (!acc) throw new AuthorizationError("Account not found.");
  await assertMember(userId, acc.workspaceId);
  const provider = await socialProviderFor(acc.platform, { workspaceId: acc.workspaceId, isDemo: acc.isDemo, accountIsDemo: acc.isDemo });
  try {
    const creds = await freshCredentials(provider, acc);
    const test = await provider.validateConnection(creds, accountInfo(acc));
    const status = statusFromTest(test);
    await db()
      .update(socialAccounts)
      .set({ status, lastValidatedAt: now(), lastError: status === "CONNECTED" ? null : (test.actionRequired?.reason ?? "Some permissions are missing."), actionRequired: test.actionRequired ?? null, scopes: test.account?.scopes ?? acc.scopes })
      .where(eq(socialAccounts.id, acc.id));
    if (status !== "CONNECTED") {
      await notify({ workspaceId: acc.workspaceId, type: "ACTION_REQUIRED", severity: "WARNING", title: `${PLATFORM_LABELS[acc.platform]} needs attention`, body: test.actionRequired?.reason ?? "Some permissions are missing.", link: null, dedupeKey: `social_action:${acc.id}:${now().toISOString().slice(0, 10)}` });
    }
    return { status, test };
  } catch (e) {
    const msg = e instanceof AppError ? e.userMessage : e instanceof Error ? e.message : String(e);
    await db().update(socialAccounts).set({ status: "ERROR", lastValidatedAt: now(), lastError: msg }).where(eq(socialAccounts.id, acc.id));
    return { status: "ERROR", test: null, error: msg };
  }
}

export async function disconnectSocialAccount(accountId: string, userId: string): Promise<void> {
  const [acc] = await db().select().from(socialAccounts).where(eq(socialAccounts.id, accountId)).limit(1);
  if (!acc) return;
  await assertMember(userId, acc.workspaceId);
  if (!acc.isDemo) {
    try {
      const provider = await socialProviderFor(acc.platform, { workspaceId: acc.workspaceId, isDemo: false });
      await provider.disconnect(await loadSocialCredentials(acc.id));
    } catch (e) {
      log.warn("remote revoke failed (tokens deleted locally anyway)", { platform: acc.platform, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await deleteCredentials({ socialAccountId: acc.id });
  await db().update(socialAccounts).set({ status: "REVOKED", enabled: false, actionRequired: null }).where(eq(socialAccounts.id, acc.id));
  await audit({ workspaceId: acc.workspaceId, actorType: "USER", actorId: userId, action: "social.disconnected", entityType: "social_account", entityId: acc.id, details: { platform: acc.platform } });
}

export async function socialAccountSummary(workspaceId: string) {
  const rows = await db().select().from(socialAccounts).where(eq(socialAccounts.workspaceId, workspaceId));
  const appConfigured: Record<string, boolean> = {};
  for (const p of CONNECTABLE_PLATFORMS) appConfigured[p] = await isPlatformAppConfigured(p);
  return { accounts: rows.map((r) => ({ ...r, info: accountInfo(r) as SocialAccountInfo })), appConfigured };
}

/* ─────────────────────────── Global integrations (admin) ─────────────────────────── */

export const PlatformAppSchema = z.object({
  clientId: z.string().trim().min(3).max(200),
  clientSecret: z.string().trim().min(8).max(500).optional(),
  audited: z.boolean().optional(),
});

const APP_KEYS: Record<string, { key: IntegrationKey; idField: string; secretType: CredentialType }> = {
  INSTAGRAM: { key: "instagram", idField: "appId", secretType: "APP_SECRET" },
  FACEBOOK: { key: "meta", idField: "appId", secretType: "APP_SECRET" },
  TIKTOK: { key: "tiktok", idField: "clientKey", secretType: "CLIENT_SECRET" },
  YOUTUBE: { key: "google", idField: "clientId", secretType: "CLIENT_SECRET" },
};

/** Saves a developer app (client id + secret). The secret is encrypted and never returned to the browser. */
export async function savePlatformApp(platform: Platform, input: unknown, userId: string): Promise<void> {
  await assertAdmin(userId);
  const m = APP_KEYS[platform];
  if (!m) throw new ValidationError("Unsupported platform.");
  const data = PlatformAppSchema.parse(input);
  const integ = await upsertIntegration(m.key, null, { config: { [m.idField]: data.clientId, ...(platform === "TIKTOK" && data.audited !== undefined ? { audited: data.audited } : {}) } });
  if (data.clientSecret) await saveCredential({ workspaceId: null, integrationId: integ.id }, m.secretType, data.clientSecret);
  const hasSecret = Boolean(data.clientSecret) || (await db().select({ id: integrationCredentialsMetadata.id }).from(integrationCredentialsMetadata).where(eq(integrationCredentialsMetadata.integrationId, integ.id)).limit(1)).length > 0;
  await upsertIntegration(m.key, null, { status: hasSecret ? "READY" : "NEEDS_ACTION" });
  await audit({ workspaceId: null, actorType: "USER", actorId: userId, action: "integration.app_saved", details: { platform } });
}

export async function saveAnthropicKey(apiKey: string, userId: string): Promise<{ ok: boolean; message: string }> {
  await assertAdmin(userId);
  const key = apiKey.trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) throw new ValidationError("This does not look like an Anthropic API key (it starts with sk-ant-).");
  const settings = await getAISettings();
  const provider = new AnthropicAPIProvider(key, { prices: settings.prices, timeoutMs: 30_000, promptCaching: false });
  const health = await provider.healthCheck(settings.models.classification.model);
  const integ = await upsertIntegration("anthropic", null, { status: health.ok ? "CONNECTED" : "ERROR", lastTestedAt: now(), testResult: { ok: health.ok, message: health.message } });
  if (health.ok) await saveCredential({ workspaceId: null, integrationId: integ.id }, "API_KEY", key);
  await audit({ workspaceId: null, actorType: "USER", actorId: userId, action: "integration.anthropic_saved", details: { ok: health.ok } });
  return { ok: health.ok, message: health.ok ? "Claude is connected." : `Key not saved: ${health.message}` };
}

export async function testAnthropic(userId: string): Promise<{ ok: boolean; message: string }> {
  await assertAdmin(userId);
  const { resolveAI } = await import("../providers");
  try {
    const ai = await resolveAI(null, "classification");
    const h = await ai.runtime.ai.healthCheck(ai.runtime.model.model);
    await upsertIntegration(ai.providerId === "claude-code-cli" ? "claude_code_cli" : "anthropic", null, { status: h.ok ? "CONNECTED" : "ERROR", lastTestedAt: now(), testResult: { ok: h.ok, message: h.message } });
    return { ok: h.ok, message: h.message };
  } catch (e) {
    return { ok: false, message: e instanceof AppError ? e.userMessage : String(e) };
  }
}

export async function removeGlobalIntegration(key: IntegrationKey, userId: string): Promise<void> {
  await assertAdmin(userId);
  const integ = await getIntegration(key, null);
  if (!integ) return;
  await deleteCredentials({ integrationId: integ.id });
  await db().delete(integrations).where(eq(integrations.id, integ.id));
  await audit({ workspaceId: null, actorType: "USER", actorId: userId, action: "integration.removed", details: { key } });
}

/* ─────────────────────────── WhatsApp (per workspace) ─────────────────────────── */

/** Verify token for the Meta webhook subscription (derived, not a credential for anything else). */
export function whatsappVerifyToken(): string {
  return deriveKey("whatsapp-webhook-verify").slice(0, 32);
}

export function webhookUrls(workspaceId: string) {
  const base = getConfig().appUrl;
  return {
    whatsapp: `${base}/api/webhooks/whatsapp`,
    instagram: `${base}/api/webhooks/instagram`,
    mercadopago: `${base}/api/webhooks/payments/mercadopago/${workspaceId}`,
    stripe: `${base}/api/webhooks/payments/stripe/${workspaceId}`,
  };
}

export const WhatsAppSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "Phone number ID is numeric (WhatsApp Manager → API Setup)"),
  businessAccountId: z.string().trim().regex(/^\d{5,30}$/).optional().or(z.literal("")),
  displayPhone: z.string().trim().max(30).optional().or(z.literal("")),
  accessToken: z.string().trim().min(20).max(1000).optional(),
  appSecret: z.string().trim().min(16).max(200).optional(),
});

export async function saveWhatsApp(workspaceId: string, input: unknown, userId: string): Promise<{ ok: boolean; message: string }> {
  const ws = await liveWorkspace(workspaceId, userId);
  if (ws.environment === "DEMO") throw new ValidationError("DEMO workspaces use simulated WhatsApp.");
  const data = WhatsAppSchema.parse(input);
  const clash = await db()
    .select({ ws: integrations.workspaceId })
    .from(integrations)
    .where(and(eq(integrations.key, "whatsapp"), sql`${integrations.config}->>'phoneNumberId' = ${data.phoneNumberId}`))
    .limit(1);
  if (clash[0] && clash[0].ws !== ws.id) throw new ValidationError("This WhatsApp number is already connected to another business.");
  const integ = await upsertIntegration("whatsapp", ws.id, { config: { phoneNumberId: data.phoneNumberId, businessAccountId: data.businessAccountId || null, displayPhone: data.displayPhone || null } });
  if (data.accessToken) await saveCredential({ workspaceId: ws.id, integrationId: integ.id }, "ACCESS_TOKEN", data.accessToken);
  if (data.appSecret) await saveCredential({ workspaceId: ws.id, integrationId: integ.id }, "APP_SECRET", data.appSecret);
  if (data.displayPhone) await db().update(workspaces).set({ whatsappNumber: data.displayPhone.replace(/\D/g, "") }).where(eq(workspaces.id, ws.id));
  await audit({ workspaceId: ws.id, actorType: "USER", actorId: userId, action: "integration.whatsapp_saved", details: { phoneNumberId: data.phoneNumberId } });
  return testWhatsApp(ws.id, userId);
}

export async function testWhatsApp(workspaceId: string, userId: string): Promise<{ ok: boolean; message: string }> {
  const ws = await liveWorkspace(workspaceId, userId);
  const { messagingProviderFor } = await import("../providers");
  try {
    const p = await messagingProviderFor(ws, "WHATSAPP");
    const r = await p.testConnection();
    await upsertIntegration("whatsapp", ws.id, { status: r.ok ? "CONNECTED" : "ERROR", lastTestedAt: now(), testResult: { ok: r.ok, message: r.message } });
    return r;
  } catch (e) {
    const message = e instanceof AppError ? e.userMessage : String(e);
    await upsertIntegration("whatsapp", ws.id, { status: "NEEDS_ACTION", lastTestedAt: now(), testResult: { ok: false, message } });
    return { ok: false, message };
  }
}

/* ─────────────────────────── Payments (per workspace) ─────────────────────────── */

export const MercadoPagoSchema = z.object({
  accessToken: z.string().trim().regex(/^(APP_USR|TEST)-[\w-]{20,}$/, "Mercado Pago access tokens start with APP_USR- (production) or TEST-").optional(),
  webhookSecret: z.string().trim().min(16).max(200).optional(),
});
export const StripeSchema = z.object({
  secretKey: z.string().trim().regex(/^(sk|rk)_(live|test)_[\w]{16,}$/, "Stripe secret keys start with sk_live_ / sk_test_ (or restricted rk_)").optional(),
  webhookSecret: z.string().trim().regex(/^whsec_[\w]{16,}$/, "Stripe webhook secrets start with whsec_").optional(),
});

export async function savePaymentProvider(workspaceId: string, provider: "MERCADOPAGO" | "STRIPE", input: unknown, userId: string): Promise<{ ok: boolean; message: string }> {
  const ws = await liveWorkspace(workspaceId, userId);
  if (ws.environment === "DEMO") throw new ValidationError("DEMO workspaces use simulated payments.");
  const key: IntegrationKey = provider === "MERCADOPAGO" ? "mercadopago" : "stripe";
  const integ = await upsertIntegration(key, ws.id, {});
  if (provider === "MERCADOPAGO") {
    const d = MercadoPagoSchema.parse(input);
    if (d.accessToken) await saveCredential({ workspaceId: ws.id, integrationId: integ.id }, "ACCESS_TOKEN", d.accessToken);
    if (d.webhookSecret) await saveCredential({ workspaceId: ws.id, integrationId: integ.id }, "WEBHOOK_SECRET", d.webhookSecret);
  } else {
    const d = StripeSchema.parse(input);
    if (d.secretKey) await saveCredential({ workspaceId: ws.id, integrationId: integ.id }, "SECRET_KEY", d.secretKey);
    if (d.webhookSecret) await saveCredential({ workspaceId: ws.id, integrationId: integ.id }, "WEBHOOK_SECRET", d.webhookSecret);
  }
  await audit({ workspaceId: ws.id, actorType: "USER", actorId: userId, action: "integration.payment_saved", details: { provider } });
  return testPaymentProvider(ws.id, provider, userId);
}

export async function testPaymentProvider(workspaceId: string, provider: "MERCADOPAGO" | "STRIPE", userId: string): Promise<{ ok: boolean; message: string }> {
  const ws = await liveWorkspace(workspaceId, userId);
  const { integrationSecret } = await import("../secrets");
  const key: IntegrationKey = provider === "MERCADOPAGO" ? "mercadopago" : "stripe";
  try {
    const p =
      provider === "MERCADOPAGO"
        ? new MercadoPagoProvider({ accessToken: (await integrationSecret("mercadopago", ws.id, "ACCESS_TOKEN")) ?? "", webhookSecret: (await integrationSecret("mercadopago", ws.id, "WEBHOOK_SECRET")) ?? "" })
        : new StripeProvider({ secretKey: (await integrationSecret("stripe", ws.id, "SECRET_KEY")) ?? "", webhookSecret: (await integrationSecret("stripe", ws.id, "WEBHOOK_SECRET")) ?? "" });
    const r = await p.testConnection();
    const webhookSecret = await integrationSecret(key, ws.id, "WEBHOOK_SECRET");
    const status = !r.ok ? "ERROR" : webhookSecret ? "CONNECTED" : "NEEDS_ACTION";
    const message = r.ok && !webhookSecret ? `${r.message} Add the webhook secret so payments are confirmed automatically.` : r.message;
    await upsertIntegration(key, ws.id, { status, lastTestedAt: now(), testResult: { ok: r.ok, message } });
    return { ok: r.ok, message };
  } catch (e) {
    const message = e instanceof AppError ? e.userMessage : String(e);
    await upsertIntegration(key, ws.id, { status: "ERROR", lastTestedAt: now(), testResult: { ok: false, message } });
    return { ok: false, message };
  }
}

export async function removeWorkspaceIntegration(workspaceId: string, key: IntegrationKey, userId: string): Promise<void> {
  await liveWorkspace(workspaceId, userId);
  const integ = await getIntegration(key, workspaceId);
  if (!integ) return;
  await deleteCredentials({ integrationId: integ.id });
  await db().delete(integrations).where(eq(integrations.id, integ.id));
  await audit({ workspaceId, actorType: "USER", actorId: userId, action: "integration.removed", details: { key } });
}

/** Integration status for the UI: config (non-secret), which secrets exist (type + last 4), test results. Never secret values. */
export async function integrationOverview(workspaceId: string | null) {
  const rows = await db()
    .select()
    .from(integrations)
    .where(workspaceId ? eq(integrations.workspaceId, workspaceId) : isNull(integrations.workspaceId));
  const out = [];
  for (const r of rows) {
    const creds = await db()
      .select({ type: integrationCredentialsMetadata.credentialType, last4: integrationCredentialsMetadata.last4, updatedAt: integrationCredentialsMetadata.updatedAt, expiresAt: integrationCredentialsMetadata.expiresAt })
      .from(integrationCredentialsMetadata)
      .where(eq(integrationCredentialsMetadata.integrationId, r.id));
    out.push({ key: r.key as IntegrationKey, status: r.status, config: r.config, mode: r.mode, lastTestedAt: r.lastTestedAt, testResult: r.testResult, actionRequired: r.actionRequired, credentials: creds });
  }
  return out;
}

/* ─────────────────────────── Messaging webhooks ─────────────────────────── */

export interface MessagingWebhookResult {
  processed: number;
  statuses: number;
  ignored: number;
  rejected: number;
}

/**
 * WhatsApp / Instagram webhook: the payload identifies the business account
 * (phone_number_id / IG account id) → workspace; the signature is then
 * verified with that workspace's (or the global) app secret before anything
 * is stored. Unknown accounts are ignored. Duplicate deliveries are idempotent.
 */
export async function handleMessagingWebhook(channel: "WHATSAPP" | "INSTAGRAM", rawBody: string, signature: string | undefined): Promise<MessagingWebhookResult> {
  const res: MessagingWebhookResult = { processed: 0, statuses: 0, ignored: 0, rejected: 0 };
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    res.rejected++;
    return res;
  }
  const events: MessagingEvent[] = channel === "WHATSAPP" ? parseWhatsAppWebhook(payload) : parseInstagramWebhook(payload);
  const { integrationSecret } = await import("../secrets");
  const verified = new Map<string, string | null>();
  for (const ev of events) {
    let workspaceId: string | null = null;
    if (!verified.has(ev.accountId)) {
      let secret: string | null = null;
      if (channel === "WHATSAPP") {
        const [integ] = await db()
          .select()
          .from(integrations)
          .where(and(eq(integrations.key, "whatsapp"), sql`${integrations.config}->>'phoneNumberId' = ${ev.accountId}`))
          .limit(1);
        workspaceId = integ?.workspaceId ?? null;
        if (workspaceId) secret = (await integrationSecret("whatsapp", workspaceId, "APP_SECRET")) ?? (await integrationSecret("meta", null, "APP_SECRET", "META_APP_SECRET"));
      } else {
        const [acc] = await db()
          .select()
          .from(socialAccounts)
          .where(and(eq(socialAccounts.platform, "INSTAGRAM"), eq(socialAccounts.externalAccountId, ev.accountId), eq(socialAccounts.enabled, true)))
          .limit(1);
        workspaceId = acc?.workspaceId ?? null;
        if (workspaceId) secret = await integrationSecret("instagram", null, "APP_SECRET", "INSTAGRAM_APP_SECRET");
      }
      const ok = Boolean(workspaceId && secret && verifyMetaSignature(rawBody, signature, secret));
      if (workspaceId && !ok) {
        log.warn("messaging webhook signature rejected", { channel, workspace: workspaceId });
        await audit({ workspaceId, actorType: "WEBHOOK", action: "messaging.webhook_invalid_signature", details: { channel } });
      }
      verified.set(ev.accountId, ok ? workspaceId : null);
    }
    workspaceId = verified.get(ev.accountId) ?? null;
    if (!workspaceId) {
      res.ignored++;
      continue;
    }
    if (ev.kind === "status") {
      await db()
        .update(messages)
        .set({ deliveryStatus: ev.status, error: ev.error ?? null })
        .where(and(eq(messages.workspaceId, workspaceId), eq(messages.externalMessageId, ev.externalMessageId)));
      res.statuses++;
      continue;
    }
    await processInboundMessage({ workspaceId, channel, from: ev.from, fromName: ev.fromName ?? null, text: ev.text, externalMessageId: ev.externalMessageId, timestamp: ev.timestamp, referral: ev.referral ?? null, phone: channel === "WHATSAPP" ? ev.from : null, origin: "WEBHOOK" });
    res.processed++;
  }
  return res;
}

