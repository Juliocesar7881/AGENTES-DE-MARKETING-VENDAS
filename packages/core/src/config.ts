import { createHmac } from "node:crypto";
import { join, resolve } from "node:path";
import { ensureRootEnv, findRepoRoot as findWorkspaceRoot, loadEncryptionKey } from "@revenueos/shared/server";

/** Central, validated view of environment configuration (server/worker only). */
export interface CoreConfig {
  appUrl: string;
  env: "development" | "production" | "test";
  demoEnabled: boolean;
  storageDriver: "local" | "supabase";
  storageLocalDir: string;
  supabaseUrl: string | null;
  supabaseServiceRoleKey: string | null;
  supabaseBucket: string;
  dataDir: string;
  metaGraphVersion: string;
  cronSecret: string | null;
}

let cached: CoreConfig | null = null;

export function getConfig(): CoreConfig {
  if (cached) return cached;
  ensureRootEnv();
  const env = (process.env.NODE_ENV === "production" ? "production" : process.env.NODE_ENV === "test" ? "test" : "development") as CoreConfig["env"];
  const dataDir = resolve(/*turbopackIgnore: true*/ process.env.REVENUEOS_DATA_DIR ?? join(findRepoRoot(), ".data"));
  cached = {
    appUrl: (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    env,
    demoEnabled: (process.env.DEMO_MODE_ENABLED ?? "true") !== "false",
    storageDriver: process.env.STORAGE_DRIVER === "supabase" ? "supabase" : "local",
    storageLocalDir: resolve(/*turbopackIgnore: true*/ process.env.STORAGE_LOCAL_DIR ?? join(dataDir, "storage")),
    supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    supabaseBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "revenueos",
    dataDir,
    metaGraphVersion: process.env.META_GRAPH_VERSION ?? "v23.0",
    cronSecret: process.env.CRON_SECRET ?? null,
  };
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}

function findRepoRoot(): string {
  // Bundlers (Next.js) relocate this file, so prefer walking up from the working directory.
  return findWorkspaceRoot() ?? resolve(new URL(".", import.meta.url).pathname, "..", "..", "..");
}

/** Derives a purpose-specific signing key from APP_ENCRYPTION_KEY (no extra env var needed). */
export function deriveKey(purpose: string): string {
  return createHmac("sha256", loadEncryptionKey()).update(`revenueos:${purpose}`).digest("base64url");
}
