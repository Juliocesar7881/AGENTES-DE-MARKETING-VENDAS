import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Isolated test database and folders. Never touches the development database. */
export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/revenueos_test";

export function applyTestEnv(): void {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  process.env.APP_URL = "http://localhost:3999";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3999";
  process.env.DEMO_MODE_ENABLED = "true";
  process.env.STORAGE_DRIVER = "local";
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
  process.env.CRON_SECRET = "test-cron-secret";
  if (!process.env.REVENUEOS_TEST_TMP) process.env.REVENUEOS_TEST_TMP = mkdtempSync(join(tmpdir(), "revenueos-test-"));
  process.env.STORAGE_LOCAL_DIR = join(process.env.REVENUEOS_TEST_TMP, "storage");
  process.env.REVENUEOS_WORKER_HOME = join(process.env.REVENUEOS_TEST_TMP, "worker");
  process.env.REVENUEOS_RENDER_DIR = join(process.env.REVENUEOS_TEST_TMP, "renders");
  // Never let tests pick up real platform/AI credentials from a developer .env.
  for (const k of ["ANTHROPIC_API_KEY", "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "META_APP_ID", "META_APP_SECRET", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]) process.env[k] = "";
}
