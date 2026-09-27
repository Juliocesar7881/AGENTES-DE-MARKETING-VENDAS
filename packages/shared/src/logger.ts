import { redact } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Structured context fields. Every log line carries these when known. */
export interface LogContext {
  workspace?: string | null;
  job?: string | null;
  agent?: string | null;
  worker?: string | null;
  request?: string | null;
  event?: string | null;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  child(ctx: LogContext): Logger;
}

type Sink = (line: string, level: LogLevel) => void;

let globalSink: Sink = (line, level) => {
  const hasStreams = typeof process !== "undefined" && typeof process.stdout?.write === "function";
  if (!hasStreams) {
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
    return;
  }
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
};

/** Allows the worker to tee logs into a rotating file for the local "Logs" panel. */
export function setLogSink(sink: Sink): void {
  globalSink = sink;
}

function envLevel(): LogLevel {
  const raw = (typeof process !== "undefined" ? process.env.LOG_LEVEL : undefined) ?? "info";
  return (["debug", "info", "warn", "error"].includes(raw) ? raw : "info") as LogLevel;
}

export function createLogger(base: LogContext = {}): Logger {
  const min = LEVEL_ORDER[envLevel()];
  const write = (level: LogLevel, msg: string, ctx?: LogContext) => {
    if (LEVEL_ORDER[level] < min) return;
    const entry = redact({
      timestamp: new Date().toISOString(),
      level,
      msg,
      ...base,
      ...(ctx ?? {}),
    });
    let line: string;
    try {
      line = JSON.stringify(entry, (_k, v: unknown) => (v instanceof Error ? { name: v.name, message: v.message } : v));
    } catch {
      line = JSON.stringify({ timestamp: new Date().toISOString(), level, msg });
    }
    globalSink(line, level);
  };
  return {
    debug: (m, c) => write("debug", m, c),
    info: (m, c) => write("info", m, c),
    warn: (m, c) => write("warn", m, c),
    error: (m, c) => write("error", m, c),
    child: (c) => createLogger({ ...base, ...c }),
  };
}

export const logger = createLogger();
