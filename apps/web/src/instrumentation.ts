/**
 * Server startup (self-hosted / local):
 *  - starts the built-in database when this installation uses it and no other
 *    RevenueOS process (the launcher) has started it yet;
 *  - prints the installer address and setup code while RevenueOS is not installed;
 *  - runs the scheduler and cloud jobs in-process (disable with EMBEDDED_RUNNER=false).
 * On Vercel the /api/cron/tick endpoint is used instead.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  await import("./server/env");
  if (!process.env.VERCEL) {
    try {
      const { ensureEmbeddedPostgres } = await import("@revenueos/database");
      const r = await ensureEmbeddedPostgres();
      if (r?.started) console.info(`[revenueos] built-in database started (${r.dataDir})`);
    } catch (e) {
      console.warn(`[revenueos] built-in database: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const { env } = await import("@revenueos/shared/server");
      const url = env("DATABASE_URL");
      if (url) {
        const { migrateIfBehind } = await import("@revenueos/database");
        const n = await migrateIfBehind(url);
        if (n > 0) console.info(`[revenueos] database updated (${n} new migration${n > 1 ? "s" : ""})`);
      }
    } catch (e) {
      console.warn(`[revenueos] database update skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
    const { announceSetup } = await import("./server/install");
    const { getConfig } = await import("@revenueos/core");
    void announceSetup(getConfig().appUrl).catch(() => undefined);
  }
  if (process.env.VERCEL || process.env.EMBEDDED_RUNNER === "false") return;
  const { startEmbeddedRunner } = await import("./server/embedded");
  startEmbeddedRunner();
}
