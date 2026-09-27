import { redactString } from "./redact";

/**
 * AppError carries a human-readable message (shown in the UI) separately from
 * technical details (shown under "View details"). Never show "Error 400" alone.
 */
export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;
  /** Seconds to wait before retrying (e.g. from a Retry-After header). */
  readonly retryAfterSec?: number;
  readonly httpStatus?: number;

  constructor(opts: {
    code: string;
    userMessage: string;
    message?: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
    retryAfterSec?: number;
    httpStatus?: number;
    cause?: unknown;
  }) {
    super(opts.message ?? opts.userMessage, { cause: opts.cause });
    this.name = "AppError";
    this.code = opts.code;
    this.userMessage = opts.userMessage;
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
    this.retryAfterSec = opts.retryAfterSec;
    this.httpStatus = opts.httpStatus;
  }
}

export class NotConfiguredError extends AppError {
  constructor(what: string, whereToFix: string) {
    super({
      code: "NOT_CONFIGURED",
      userMessage: `${what} is not connected yet. ${whereToFix}`,
      retryable: false,
    });
    this.name = "NotConfiguredError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "You do not have access to this workspace.") {
    super({ code: "FORBIDDEN", userMessage: message, httpStatus: 403 });
    this.name = "AuthorizationError";
  }
}

export class ValidationError extends AppError {
  constructor(userMessage: string, details?: Record<string, unknown>) {
    super({ code: "VALIDATION", userMessage, details, httpStatus: 400 });
    this.name = "ValidationError";
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export interface SerializedError {
  code: string;
  userMessage: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}

export function serializeError(e: unknown): SerializedError {
  if (e instanceof AppError) {
    return {
      code: e.code,
      userMessage: e.userMessage,
      message: redactString(e.message),
      details: e.details,
      retryable: e.retryable,
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  return {
    code: "UNEXPECTED",
    userMessage: "Something unexpected went wrong. Details are available below.",
    message: redactString(message),
    retryable: true,
  };
}

export function humanMessage(e: unknown): string {
  return e instanceof AppError ? e.userMessage : serializeError(e).userMessage;
}
