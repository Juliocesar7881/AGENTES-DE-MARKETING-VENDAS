/**
 * Secret redaction used by the logger and by anything that persists error
 * details. Never log raw tokens, API keys, passwords or authorization headers.
 */
const SENSITIVE_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|signature|client[-_]?secret|access[-_]?key|private[-_]?key|refresh|code_verifier|x-hub-signature)/i;

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g, // Anthropic keys
  /sk_(live|test)_[A-Za-z0-9]{10,}/g, // Stripe secret keys
  /whsec_[A-Za-z0-9]{10,}/g, // Stripe webhook secrets
  /APP_USR-[A-Za-z0-9-]{10,}/g, // Mercado Pago access tokens
  /TEST-[0-9]{6,}-[A-Za-z0-9-]{10,}/g, // Mercado Pago test tokens
  /EAA[A-Za-z0-9]{20,}/g, // Meta access tokens
  /IG[A-Za-z0-9]{30,}/g, // Instagram tokens
  /ya29\.[A-Za-z0-9_-]{20,}/g, // Google access tokens
  /1\/\/[A-Za-z0-9_-]{20,}/g, // Google refresh tokens
  /act\.[A-Za-z0-9!*_.-]{20,}/g, // TikTok access tokens
  /rft\.[A-Za-z0-9!*_.-]{20,}/g, // TikTok refresh tokens
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /(access_token|client_secret|refresh_token|api_key|password)=([^&\s"']+)/gi,
  /postgres(ql)?:\/\/[^:\s]+:[^@\s]+@/gi,
];

export function redactString(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, p1: unknown) => {
      if (typeof p1 === "string" && /=/.test(match)) return `${p1}=[REDACTED]`;
      if (match.startsWith("postgres")) return match.replace(/:[^:@]+@/, ":[REDACTED]@");
      return "[REDACTED]";
    });
  }
  return out;
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return "[TRUNCATED]" as unknown as T;
  if (value == null) return value;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) } as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) && v != null && v !== "" ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out as T;
}
