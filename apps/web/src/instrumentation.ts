/**
 * Self-hosted / local dashboard: runs the scheduler and cloud jobs in-process
 * (disable with EMBEDDED_RUNNER=false). On Vercel the /api/cron/tick endpoint
 * is used instead.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL || process.env.EMBEDDED_RUNNER === "false" || process.env.NEXT_PHASE === "phase-production-build") return;
  await import("./server/env");
  const { startEmbeddedRunner } = await import("./server/embedded");
  startEmbeddedRunner();
}
