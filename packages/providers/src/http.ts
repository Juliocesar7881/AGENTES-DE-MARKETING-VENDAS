import { AppError, createLogger } from "@revenueos/shared";

const log = createLogger({ component: "http" });

export class ProviderHttpError extends AppError {
  readonly status: number;
  readonly body: unknown;
  readonly provider: string;
  constructor(opts: { provider: string; status: number; body: unknown; userMessage: string; retryAfterSec?: number; code?: string }) {
    super({
      code: opts.code ?? `${opts.provider.toUpperCase()}_HTTP_${opts.status}`,
      userMessage: opts.userMessage,
      message: `${opts.provider} responded ${opts.status}`,
      details: { status: opts.status, body: opts.body as Record<string, unknown> },
      retryable: opts.status === 429 || opts.status >= 500,
      retryAfterSec: opts.retryAfterSec,
      httpStatus: opts.status,
    });
    this.name = "ProviderHttpError";
    this.status = opts.status;
    this.body = opts.body;
    this.provider = opts.provider;
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.round((date - Date.now()) / 1000));
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simple per-key token bucket so every provider respects its own rate limits. */
class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number; blockedUntil: number }>();
  async take(key: string, perMinute: number): Promise<void> {
    for (;;) {
      const now = Date.now();
      const b = this.buckets.get(key) ?? { tokens: perMinute, updated: now, blockedUntil: 0 };
      if (b.blockedUntil > now) {
        await sleep(Math.min(b.blockedUntil - now, 60_000));
        continue;
      }
      const refill = ((now - b.updated) / 60_000) * perMinute;
      b.tokens = Math.min(perMinute, b.tokens + refill);
      b.updated = now;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        this.buckets.set(key, b);
        return;
      }
      this.buckets.set(key, b);
      await sleep(Math.ceil(((1 - b.tokens) / perMinute) * 60_000));
    }
  }
  block(key: string, seconds: number): void {
    const b = this.buckets.get(key) ?? { tokens: 0, updated: Date.now(), blockedUntil: 0 };
    b.blockedUntil = Math.max(b.blockedUntil, Date.now() + seconds * 1000);
    this.buckets.set(key, b);
  }
}

export const rateLimiter = new RateLimiter();

export interface RequestOptions {
  provider: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  json?: unknown;
  form?: Record<string, string>;
  timeoutMs?: number;
  /** Only idempotent requests are retried automatically. Publishing steps persist their own state. */
  idempotent?: boolean;
  retries?: number;
  rateLimitKey?: string;
  ratePerMinute?: number;
  /** Maps an error response to a human-readable message. */
  describeError?: (status: number, body: unknown) => { userMessage: string; code?: string } | undefined;
  fetchImpl?: typeof fetch;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function request<T = unknown>(url: string, opts: RequestOptions): Promise<HttpResponse<T>> {
  const method = opts.method ?? (opts.json !== undefined || opts.form ? "POST" : "GET");
  const idempotent = opts.idempotent ?? (method === "GET" || method === "HEAD" || method === "DELETE");
  const maxRetries = idempotent ? (opts.retries ?? 3) : 0;
  const headers: Record<string, string> = { accept: "application/json", ...(opts.headers ?? {}) };
  let body: BodyInit | null | undefined = opts.body;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  const doFetch = opts.fetchImpl ?? fetch;
  let attempt = 0;
  for (;;) {
    if (opts.rateLimitKey) await rateLimiter.take(opts.rateLimitKey, opts.ratePerMinute ?? 60);
    let res: Response;
    try {
      res = await doFetch(url, { method, headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
    } catch (e) {
      if (attempt < maxRetries) {
        attempt++;
        await sleep(backoff(attempt));
        continue;
      }
      throw new AppError({
        code: `${opts.provider.toUpperCase()}_NETWORK`,
        userMessage: `Could not reach ${opts.provider}. Check the internet connection and try again.`,
        message: e instanceof Error ? e.message : String(e),
        retryable: true,
        cause: e,
      });
    }
    if (res.ok) {
      return { status: res.status, data: (await readBody(res)) as T, headers: res.headers };
    }
    const errBody = await readBody(res);
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    if (res.status === 429 && opts.rateLimitKey) rateLimiter.block(opts.rateLimitKey, retryAfter ?? 60);
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < maxRetries) {
      attempt++;
      const wait = retryAfter != null ? Math.min(retryAfter * 1000, 120_000) : backoff(attempt);
      log.warn("provider request retrying", { provider: opts.provider, status: res.status, attempt, waitMs: wait });
      await sleep(wait);
      continue;
    }
    const described = opts.describeError?.(res.status, errBody);
    throw new ProviderHttpError({
      provider: opts.provider,
      status: res.status,
      body: errBody,
      retryAfterSec: retryAfter,
      code: described?.code,
      userMessage:
        described?.userMessage ??
        (res.status === 401
          ? `${opts.provider} rejected the credentials (401). Reconnect the account in Integrations.`
          : res.status === 403
            ? `${opts.provider} denied this action (403). The connected app or account is missing a permission.`
            : res.status === 429
              ? `${opts.provider} rate limit reached. RevenueOS will retry automatically later.`
              : `${opts.provider} returned an error (${res.status}). See details for the provider's message.`),
    });
  }
}

export function backoff(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}
