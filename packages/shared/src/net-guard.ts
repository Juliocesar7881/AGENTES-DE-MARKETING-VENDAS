import { lookup as dnsLookup } from "node:dns";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { AppError } from "./errors";

/**
 * SSRF protection for every server-side fetch of a user-supplied URL
 * (website analyzer, asset import, screenshots). Rules:
 *  - only http/https, only ports 80/443, no credentials in the URL
 *  - hostnames resolving to private, loopback, link-local, multicast,
 *    reserved or metadata addresses are rejected
 *  - the check runs again at connect time (defeats DNS rebinding) and on
 *    every redirect hop
 */

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function expandV6(ip: string): number[] {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);
  // embedded IPv4 (e.g. ::ffff:1.2.3.4)
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]!);
    addr = addr.replace(v4[1]!, `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const [head, tail] = addr.split("::") as [string, string | undefined];
  const h = head ? head.split(":").filter(Boolean) : [];
  const t = tail !== undefined && tail ? tail.split(":").filter(Boolean) : [];
  const fill = addr.includes("::") ? new Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x, 16));
}

function isPrivateV6(ip: string): boolean {
  const g = expandV6(ip);
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return true;
  const allZeroPrefix = g.slice(0, 5).every((x) => x === 0);
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (allZeroPrefix && g[5] === 0xffff) {
    return isPrivateV4(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`); // IPv4-mapped
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    return isPrivateV4(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`); // NAT64
  }
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp"];

export class SsrfError extends AppError {
  constructor(reason: string) {
    super({
      code: "URL_NOT_ALLOWED",
      userMessage: `This URL cannot be analyzed: ${reason}. Only public websites (http/https) are allowed.`,
      httpStatus: 400,
    });
    this.name = "SsrfError";
  }
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfError("only http and https are supported");
  if (url.username || url.password) throw new SsrfError("credentials in URLs are not allowed");
  if (url.port && url.port !== "80" && url.port !== "443") throw new SsrfError("non-standard ports are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SsrfError("private hostnames are not allowed");
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new SsrfError("private network addresses are not allowed");
    return url;
  }
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfError("the domain could not be resolved");
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new SsrfError("the domain resolves to a private network address");
  }
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

function guardedLookup(hostname: string, options: { all?: boolean } & Record<string, unknown>, cb: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, "");
    const list = addresses as unknown as { address: string; family: number }[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) {
      const e = new Error(`Blocked connection to private address for ${hostname}`) as NodeJS.ErrnoException;
      e.code = "ESSRF";
      return cb(e, "");
    }
    if (options.all) return cb(null, list);
    const first = list[0]!;
    cb(null, first.address, first.family);
  });
}

let guardedAgent: Dispatcher | null = null;
export function ssrfSafeDispatcher(): Dispatcher {
  if (!guardedAgent) {
    guardedAgent = new Agent({
      connect: { lookup: guardedLookup as never, timeout: 8000 },
      headersTimeout: 10_000,
      bodyTimeout: 15_000,
    });
  }
  return guardedAgent;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  headers: { get(name: string): string | null };
  body: Buffer;
  truncated: boolean;
}

export async function safeFetch(
  rawUrl: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; accept?: string; userAgent?: string } = {},
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 4;
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current);
    const res = await undiciFetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: {
        accept: opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8",
        "user-agent": opts.userAgent ?? "RevenueOS-WebsiteAnalyzer/1.0 (+https://github.com/)",
      },
      dispatcher: ssrfSafeDispatcher(),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new SsrfError("redirect without location");
      current = new URL(loc, url).toString();
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    return {
      url: url.toString(),
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      headers: res.headers,
      body: Buffer.concat(chunks),
      truncated,
    };
  }
  throw new SsrfError("too many redirects");
}
