import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AppError, createLogger, serializeError } from "@revenueos/shared";
import { ZodError } from "zod";

export type ActionResult<T = null> = { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const log = createLogger({ component: "web-action" });

/**
 * Runs a server action body and converts failures into user-facing messages.
 * Internal errors are logged (redacted) and never leak stack traces to the browser.
 */
export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of e.issues) fieldErrors[issue.path.join(".") || "_"] ??= issue.message;
      return { ok: false, error: e.issues[0]?.message ?? "Invalid input.", fieldErrors };
    }
    if (e instanceof AppError) return { ok: false, error: e.userMessage };
    log.error("action failed", { error: serializeError(e).message });
    return { ok: false, error: "Something went wrong. The error was logged — try again." };
  }
}
