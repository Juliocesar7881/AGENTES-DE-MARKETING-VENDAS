import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { setLogSink } from "@revenueos/shared";
import { configDir } from "./config";

const MAX_BYTES = 5 * 1024 * 1024;
export const LOG_FILE = join(configDir(), "logs", "worker.log");

/** Tees structured logs to stdout and a rotating file shown in the local panel (secrets are already redacted). */
export function installFileLogging(): void {
  mkdirSync(join(configDir(), "logs"), { recursive: true });
  setLogSink((line, level) => {
    (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
    try {
      if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_BYTES) {
        if (existsSync(`${LOG_FILE}.2`)) renameSync(`${LOG_FILE}.2`, `${LOG_FILE}.3`);
        if (existsSync(`${LOG_FILE}.1`)) renameSync(`${LOG_FILE}.1`, `${LOG_FILE}.2`);
        renameSync(LOG_FILE, `${LOG_FILE}.1`);
      }
      appendFileSync(LOG_FILE, line + "\n");
    } catch {
      /* logging must never crash the worker */
    }
  });
}

export function tailLogs(lines = 300): string[] {
  try {
    const content = readFileSync(LOG_FILE, "utf8");
    return content.trim().split("\n").slice(-lines);
  } catch {
    return [];
  }
}
