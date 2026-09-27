import { eq, systemSettings, type DbExecutor } from "@revenueos/database";
import {
  AISettingsSchema,
  DEFAULT_AI_SETTINGS,
  GlobalSettingsSchema,
  type AISettings,
  type GlobalSettings,
} from "@revenueos/shared";
import { db, now } from "./deps";

async function getRaw(key: string, exec: DbExecutor = db()): Promise<unknown> {
  const rows = await exec.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

async function setRaw(key: string, value: unknown, userId: string | null = null, exec: DbExecutor = db()): Promise<void> {
  await exec
    .insert(systemSettings)
    .values({ key, value, updatedBy: userId })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedBy: userId, updatedAt: now() } });
}

export async function getAISettings(exec?: DbExecutor): Promise<AISettings> {
  const raw = await getRaw("ai", exec);
  const parsed = AISettingsSchema.safeParse({ ...DEFAULT_AI_SETTINGS, ...(raw as object | null), models: { ...DEFAULT_AI_SETTINGS.models, ...((raw as { models?: object } | null)?.models ?? {}) } });
  if (!parsed.success) return DEFAULT_AI_SETTINGS;
  // Default provider follows the environment: without any Anthropic key a fresh install shows "not connected" (never silently mock).
  return parsed.data;
}

export async function saveAISettings(patch: Partial<AISettings>, userId: string | null): Promise<AISettings> {
  const current = await getAISettings();
  const next = AISettingsSchema.parse({ ...current, ...patch, models: { ...current.models, ...(patch.models ?? {}) } });
  await setRaw("ai", next, userId);
  return next;
}

export async function getGlobalSettings(exec?: DbExecutor): Promise<GlobalSettings> {
  const raw = await getRaw("global", exec);
  return GlobalSettingsSchema.parse(raw ?? {});
}

export async function saveGlobalSettings(patch: Partial<GlobalSettings>, userId: string | null): Promise<GlobalSettings> {
  const next = GlobalSettingsSchema.parse({ ...(await getGlobalSettings()), ...patch });
  await setRaw("global", next, userId);
  return next;
}

export async function isEmergencyStopped(exec?: DbExecutor): Promise<boolean> {
  return (await getGlobalSettings(exec)).emergencyStop;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const v = await getRaw(key);
  return (v ?? fallback) as T;
}

export async function setSetting(key: string, value: unknown, userId: string | null = null): Promise<void> {
  await setRaw(key, value, userId);
}
