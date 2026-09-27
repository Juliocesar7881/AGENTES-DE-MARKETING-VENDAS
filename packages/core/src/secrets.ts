import { and, eq, integrationCredentialsMetadata, integrations, isNull, secrets, type DbExecutor } from "@revenueos/database";
import type { IntegrationKey, IntegrationStatus } from "@revenueos/shared";
import { decryptSecret, encryptSecret, env } from "@revenueos/shared/server";
import { db } from "./deps";

/**
 * Secret storage: values are AES-256-GCM encrypted at rest in `secrets`, and
 * only metadata (type, last4, expiry) is ever exposed to users. The app role
 * has no access to the `secrets` table (enforced by RLS/grants).
 */

export type CredentialType =
  | "API_KEY"
  | "ACCESS_TOKEN"
  | "REFRESH_TOKEN"
  | "CLIENT_SECRET"
  | "APP_SECRET"
  | "WEBHOOK_SECRET"
  | "VERIFY_TOKEN"
  | "SECRET_KEY"
  | "EXTRA_JSON";

function last4(value: string): string | null {
  return value.length >= 8 ? value.slice(-4) : null;
}

interface Owner {
  workspaceId: string | null;
  integrationId?: string | null;
  socialAccountId?: string | null;
}

export async function saveCredential(owner: Owner, type: CredentialType, value: string, expiresAt: Date | null = null, exec: DbExecutor = db()): Promise<void> {
  const enc = encryptSecret(value);
  const [secret] = await exec.insert(secrets).values({ ciphertext: enc.ciphertext, iv: enc.iv, tag: enc.tag, keyVersion: enc.keyVersion }).returning({ id: secrets.id });
  const where = owner.socialAccountId
    ? and(eq(integrationCredentialsMetadata.socialAccountId, owner.socialAccountId), eq(integrationCredentialsMetadata.credentialType, type))
    : and(eq(integrationCredentialsMetadata.integrationId, owner.integrationId!), eq(integrationCredentialsMetadata.credentialType, type));
  const existing = await exec.select().from(integrationCredentialsMetadata).where(where).limit(1);
  if (existing[0]) {
    await exec
      .update(integrationCredentialsMetadata)
      .set({ secretId: secret!.id, last4: last4(value), expiresAt })
      .where(eq(integrationCredentialsMetadata.id, existing[0].id));
    await exec.delete(secrets).where(eq(secrets.id, existing[0].secretId));
  } else {
    await exec.insert(integrationCredentialsMetadata).values({
      workspaceId: owner.workspaceId,
      integrationId: owner.integrationId ?? null,
      socialAccountId: owner.socialAccountId ?? null,
      credentialType: type,
      secretId: secret!.id,
      last4: last4(value),
      expiresAt,
    });
  }
}

export async function readCredential(owner: Omit<Owner, "workspaceId">, type: CredentialType, exec: DbExecutor = db()): Promise<string | null> {
  const where = owner.socialAccountId
    ? and(eq(integrationCredentialsMetadata.socialAccountId, owner.socialAccountId), eq(integrationCredentialsMetadata.credentialType, type))
    : and(eq(integrationCredentialsMetadata.integrationId, owner.integrationId!), eq(integrationCredentialsMetadata.credentialType, type));
  const rows = await exec
    .select({ ciphertext: secrets.ciphertext, iv: secrets.iv, tag: secrets.tag })
    .from(integrationCredentialsMetadata)
    .innerJoin(secrets, eq(secrets.id, integrationCredentialsMetadata.secretId))
    .where(where)
    .limit(1);
  const row = rows[0];
  return row ? decryptSecret(row) : null;
}

export async function deleteCredentials(owner: Omit<Owner, "workspaceId">, exec: DbExecutor = db()): Promise<void> {
  const where = owner.socialAccountId ? eq(integrationCredentialsMetadata.socialAccountId, owner.socialAccountId) : eq(integrationCredentialsMetadata.integrationId, owner.integrationId!);
  const rows = await exec.select({ secretId: integrationCredentialsMetadata.secretId }).from(integrationCredentialsMetadata).where(where);
  await exec.delete(integrationCredentialsMetadata).where(where);
  for (const r of rows) await exec.delete(secrets).where(eq(secrets.id, r.secretId));
}

/* ---------------- integrations (global when workspaceId = null) ---------------- */

export async function getIntegration(key: IntegrationKey, workspaceId: string | null, exec: DbExecutor = db()) {
  const rows = await exec
    .select()
    .from(integrations)
    .where(and(eq(integrations.key, key), workspaceId ? eq(integrations.workspaceId, workspaceId) : isNull(integrations.workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertIntegration(
  key: IntegrationKey,
  workspaceId: string | null,
  patch: { status?: IntegrationStatus; config?: Record<string, unknown>; mode?: "LIVE" | "DEMO"; testResult?: Record<string, unknown> | null; actionRequired?: Record<string, unknown> | null; lastTestedAt?: Date | null },
  exec: DbExecutor = db(),
) {
  const existing = await getIntegration(key, workspaceId, exec);
  if (existing) {
    const [row] = await exec
      .update(integrations)
      .set({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.config ? { config: { ...existing.config, ...patch.config } } : {}),
        ...(patch.mode ? { mode: patch.mode } : {}),
        ...(patch.testResult !== undefined ? { testResult: patch.testResult } : {}),
        ...(patch.actionRequired !== undefined ? { actionRequired: patch.actionRequired } : {}),
        ...(patch.lastTestedAt !== undefined ? { lastTestedAt: patch.lastTestedAt } : {}),
      })
      .where(eq(integrations.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await exec
    .insert(integrations)
    .values({ key, workspaceId, status: patch.status ?? "NOT_CONFIGURED", config: patch.config ?? {}, mode: patch.mode ?? "LIVE", testResult: patch.testResult ?? null, actionRequired: patch.actionRequired ?? null, lastTestedAt: patch.lastTestedAt ?? null })
    .returning();
  return row!;
}

/** Reads an integration secret, falling back to an explicitly configured environment variable. */
export async function integrationSecret(key: IntegrationKey, workspaceId: string | null, type: CredentialType, envVar?: string): Promise<string | null> {
  const integ = await getIntegration(key, workspaceId);
  if (integ) {
    const v = await readCredential({ integrationId: integ.id }, type);
    if (v) return v;
  }
  return envVar ? (env(envVar) ?? null) : null;
}
