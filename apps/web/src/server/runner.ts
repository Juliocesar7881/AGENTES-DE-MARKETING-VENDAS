import "server-only";
import { after } from "next/server";
import { JobRunner, registerCoreHandlers, runSchedulerTick } from "@revenueos/core";
import { createLogger, serializeError } from "@revenueos/shared";
import "./boot";

const log = createLogger({ component: "web-runner" });

let runner: JobRunner | null = null;

/** Cloud-side runner: executes ANY jobs (sales replies, publishing, attribution…). Never renders. */
export function cloudRunner(): JobRunner {
  registerCoreHandlers();
  runner ??= new JobRunner({ runnerId: `web-${process.pid}`, runners: ["ANY"], concurrency: { ai: 3, io: 6, render: 0 } });
  return runner;
}

/** Drains due ANY jobs right after the response is sent (webhooks, human actions). */
export function kick(workspaceIds?: string[], opts: { maxJobs?: number; timeoutMs?: number } = {}): void {
  after(async () => {
    try {
      await cloudRunner().drain({ workspaceIds, maxJobs: opts.maxJobs ?? 20, timeoutMs: opts.timeoutMs ?? 25_000 });
    } catch (e) {
      log.warn("background drain failed", { error: serializeError(e).message });
    }
  });
}

export async function cronTick(): Promise<Record<string, unknown>> {
  const tick = await runSchedulerTick({ holder: "cloud-cron" });
  const jobs = await cloudRunner().drain({ maxJobs: 60, timeoutMs: 45_000 });
  return { ...tick, jobsRun: jobs };
}
