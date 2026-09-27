"use server";
import { revalidatePath } from "next/cache";
import {
  disconnectSocialAccount,
  removeGlobalIntegration,
  removeWorkspaceIntegration,
  saveAISettings,
  saveAnthropicKey,
  saveGlobalSettings,
  savePaymentProvider,
  savePlatformApp,
  saveWhatsApp,
  testAnthropic,
  testPaymentProvider,
  testSocialAccount,
  testWhatsApp,
} from "@revenueos/core";
import { AuthorizationError, type IntegrationKey, type Platform } from "@revenueos/shared";
import { run } from "../action";
import { clientIp, requireUser, setSessionCookie, userAgent } from "../session";

async function admin() {
  const user = await requireUser();
  if (!user.isAdmin) throw new AuthorizationError("Only the administrator can change global settings.");
  return user;
}

function refreshAll() {
  revalidatePath("/", "layout");
}

export async function testSocialAction(accountId: string) {
  return run(async () => {
    const user = await requireUser();
    const r = await testSocialAccount(accountId, user.id);
    refreshAll();
    return { status: r.status, error: r.error ?? null, reason: r.test?.actionRequired?.reason ?? null };
  });
}

export async function disconnectSocialAction(accountId: string) {
  return run(async () => {
    const user = await requireUser();
    await disconnectSocialAccount(accountId, user.id);
    refreshAll();
    return null;
  }, "Disconnected — tokens deleted");
}

export async function saveWhatsAppAction(workspaceId: string, input: unknown) {
  return run(async () => {
    const user = await requireUser();
    const r = await saveWhatsApp(workspaceId, input, user.id);
    refreshAll();
    return r;
  });
}

export async function testWhatsAppAction(workspaceId: string) {
  return run(async () => {
    const user = await requireUser();
    const r = await testWhatsApp(workspaceId, user.id);
    refreshAll();
    return r;
  });
}

export async function savePaymentAction(workspaceId: string, provider: "MERCADOPAGO" | "STRIPE", input: unknown) {
  return run(async () => {
    const user = await requireUser();
    const r = await savePaymentProvider(workspaceId, provider, input, user.id);
    refreshAll();
    return r;
  });
}

export async function testPaymentAction(workspaceId: string, provider: "MERCADOPAGO" | "STRIPE") {
  return run(async () => {
    const user = await requireUser();
    const r = await testPaymentProvider(workspaceId, provider, user.id);
    refreshAll();
    return r;
  });
}

export async function removeWorkspaceIntegrationAction(workspaceId: string, key: IntegrationKey) {
  return run(async () => {
    const user = await requireUser();
    await removeWorkspaceIntegration(workspaceId, key, user.id);
    refreshAll();
    return null;
  }, "Removed — credentials deleted");
}

/* ---------------- global (admin) ---------------- */

export async function savePlatformAppAction(platform: Platform, input: unknown) {
  return run(async () => {
    const user = await admin();
    await savePlatformApp(platform, input, user.id);
    refreshAll();
    return null;
  }, "Developer app saved");
}

export async function saveAnthropicKeyAction(apiKey: string) {
  return run(async () => {
    const user = await admin();
    const r = await saveAnthropicKey(apiKey, user.id);
    refreshAll();
    return r;
  });
}

export async function testAnthropicAction() {
  return run(async () => {
    const user = await admin();
    return testAnthropic(user.id);
  });
}

export async function removeGlobalIntegrationAction(key: IntegrationKey) {
  return run(async () => {
    const user = await admin();
    await removeGlobalIntegration(key, user.id);
    refreshAll();
    return null;
  }, "Removed");
}

export async function saveAISettingsAction(patch: unknown) {
  return run(async () => {
    const user = await admin();
    const s = await saveAISettings(patch as Parameters<typeof saveAISettings>[0], user.id);
    refreshAll();
    return s;
  }, "AI settings saved");
}

export async function saveGlobalSettingsAction(patch: unknown) {
  return run(async () => {
    const user = await admin();
    const s = await saveGlobalSettings(patch as Parameters<typeof saveGlobalSettings>[0], user.id);
    refreshAll();
    return s;
  }, "Saved");
}

export async function refreshModelsAction() {
  return run(async () => {
    const user = await admin();
    const { resolveAI } = await import("@revenueos/core");
    const ai = await resolveAI(null, "classification");
    const models = await ai.runtime.ai.listModels();
    await saveAISettings({ availableModels: models.map((m) => ({ id: m.id, displayName: m.displayName })), modelsRefreshedAt: new Date().toISOString() }, user.id);
    refreshAll();
    return { count: models.length };
  });
}

export async function changePasswordAction(current: string, next: string) {
  return run(async () => {
    const user = await requireUser();
    const { changePassword, createSession } = await import("@revenueos/core");
    await changePassword(user.id, current, next);
    // All sessions were revoked; keep this browser signed in with a fresh session.
    const s = await createSession(user.id, { ip: await clientIp(), userAgent: await userAgent() });
    await setSessionCookie(s.token, s.expiresAt);
    return null;
  }, "Password changed — other sessions were signed out");
}

export async function updateProfileAction(name: string) {
  return run(async () => {
    const user = await requireUser();
    const { profiles, eq, withUser } = await import("@revenueos/database");
    const n = name.trim().slice(0, 80);
    if (n.length < 2) throw new AuthorizationError("Enter your name.");
    await withUser(user.id, (tx) => tx.update(profiles).set({ name: n }).where(eq(profiles.id, user.id)));
    refreshAll();
    return null;
  }, "Profile updated");
}
