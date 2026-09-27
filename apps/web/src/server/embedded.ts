import { runSchedulerTick } from "@revenueos/core";
import { createLogger, serializeError } from "@revenueos/shared";
import "./boot";
import { cloudRunner } from "./runner";

const log = createLogger({ component: "embedded-runner" });
const g = globalThis as unknown as { __revenueosEmbedded?: boolean };

export function startEmbeddedRunner(): void {
  if (g.__revenueosEmbedded) return;
  g.__revenueosEmbedded = true;
  let busy = false;
  let failures = 0;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try {
      await cloudRunner().drain({ maxJobs: 30, timeoutMs: 15_000 });
      failures = 0;
    } catch (e) {
      failures++;
      if (failures === 1 || failures % 30 === 0) log.warn("embedded runner cannot reach the queue", { error: serializeError(e).message });
    } finally {
      busy = false;
    }
  };
  setInterval(() => void loop(), 10_000).unref();
  setInterval(() => {
    runSchedulerTick({ holder: "web-embedded" }).catch((e) => log.warn("scheduler tick failed", { error: serializeError(e).message }));
  }, 60_000).unref();
  setTimeout(() => void loop(), 5_000).unref();
  log.info("embedded runner started (scheduler + cloud jobs)");
}
