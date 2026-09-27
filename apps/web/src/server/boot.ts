import "server-only";
import "./env";
import { configureCore } from "@revenueos/core";

/**
 * One-time process configuration for the dashboard server. The dashboard is
 * the "cloud" runner: it never runs LOCAL jobs (renders) and never uses the
 * local Claude CLI provider.
 */
const g = globalThis as unknown as { __revenueosBooted?: boolean };
if (!g.__revenueosBooted) {
  g.__revenueosBooted = true;
  configureCore({ runnerId: `web-${process.pid}`, isLocalWorker: false });
}
