import { createHmac } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { AppError } from "@revenueos/shared";
import { request } from "../http";

export interface StorageProvider {
  readonly id: "local" | "supabase";
  /** True when objects live outside this machine (so remote platforms/other devices can fetch them). */
  readonly remote: boolean;
  put(key: string, data: Buffer, contentType: string): Promise<{ key: string; size: number }>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, ttlSec: number): Promise<string>;
  createSignedUploadUrl?(key: string): Promise<{ url: string; token: string }>;
}

const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,400}$/;

/** Rejects path traversal and odd characters in storage keys. */
export function assertSafeKey(key: string): string {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) {
    throw new AppError({ code: "STORAGE_BAD_KEY", userMessage: "Invalid file path.", httpStatus: 400 });
  }
  return key;
}

export function fileUrlSignature(key: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${key}:${exp}`).digest("base64url");
}

/**
 * Local filesystem storage. Used in development/self-hosting and by the worker
 * for anything that never needs to leave the machine. Signed URLs point at the
 * web app's /api/files route, which verifies the HMAC and expiry.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly id = "local" as const;
  readonly remote = false;
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly publicBaseUrl: string,
    private readonly signingSecret: string,
  ) {
    this.root = resolve(rootDir);
  }

  resolvePath(key: string): string {
    const p = resolve(this.root, assertSafeKey(key));
    if (!p.startsWith(this.root + sep)) throw new AppError({ code: "STORAGE_BAD_KEY", userMessage: "Invalid file path.", httpStatus: 400 });
    return p;
  }

  async put(key: string, data: Buffer): Promise<{ key: string; size: number }> {
    const p = this.resolvePath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
    return { key, size: data.length };
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.resolvePath(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }

  async getSignedUrl(key: string, ttlSec: number): Promise<string> {
    assertSafeKey(key);
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const sig = fileUrlSignature(key, exp, this.signingSecret);
    return `${this.publicBaseUrl.replace(/\/$/, "")}/api/files/${key}?exp=${exp}&sig=${sig}`;
  }
}

/** Supabase Storage via its REST API with the service role key (server/worker only). */
export class SupabaseStorageProvider implements StorageProvider {
  readonly id = "supabase" as const;
  readonly remote = true;
  private bucketReady = false;

  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
    private readonly bucket: string = "revenueos",
  ) {
    if (!url || !serviceRoleKey) {
      throw new AppError({ code: "STORAGE_NOT_CONFIGURED", userMessage: "Supabase Storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." });
    }
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.serviceRoleKey}`, apikey: this.serviceRoleKey, ...extra };
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    try {
      await request(`${this.url}/storage/v1/bucket`, {
        provider: "Supabase Storage",
        method: "POST",
        headers: this.headers(),
        json: { id: this.bucket, name: this.bucket, public: false },
      });
    } catch (e) {
      if (!(e instanceof AppError) || (e.httpStatus !== 400 && e.httpStatus !== 409)) throw e;
    }
    this.bucketReady = true;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<{ key: string; size: number }> {
    await this.ensureBucket();
    await request(`${this.url}/storage/v1/object/${this.bucket}/${assertSafeKey(key)}`, {
      provider: "Supabase Storage",
      method: "POST",
      headers: this.headers({ "content-type": contentType, "x-upsert": "true" }),
      body: new Uint8Array(data),
      timeoutMs: 300_000,
      idempotent: true,
    });
    return { key, size: data.length };
  }

  async get(key: string): Promise<Buffer> {
    const res = await fetch(`${this.url}/storage/v1/object/${this.bucket}/${assertSafeKey(key)}`, { headers: this.headers() });
    if (!res.ok) throw new AppError({ code: "STORAGE_GET", userMessage: `Could not download ${key} from storage (${res.status}).` });
    return Buffer.from(await res.arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    const res = await fetch(`${this.url}/storage/v1/object/info/${this.bucket}/${assertSafeKey(key)}`, { headers: this.headers() });
    return res.ok;
  }

  async delete(key: string): Promise<void> {
    await request(`${this.url}/storage/v1/object/${this.bucket}`, {
      provider: "Supabase Storage",
      method: "DELETE",
      headers: this.headers(),
      json: { prefixes: [assertSafeKey(key)] },
    });
  }

  async getSignedUrl(key: string, ttlSec: number): Promise<string> {
    const res = await request<{ signedURL: string }>(`${this.url}/storage/v1/object/sign/${this.bucket}/${assertSafeKey(key)}`, {
      provider: "Supabase Storage",
      method: "POST",
      headers: this.headers(),
      json: { expiresIn: ttlSec },
      idempotent: true,
    });
    return `${this.url}/storage/v1${res.data.signedURL}`;
  }

  async createSignedUploadUrl(key: string): Promise<{ url: string; token: string }> {
    await this.ensureBucket();
    const res = await request<{ url: string; token?: string }>(`${this.url}/storage/v1/object/upload/sign/${this.bucket}/${assertSafeKey(key)}`, {
      provider: "Supabase Storage",
      method: "POST",
      headers: this.headers(),
      json: {},
    });
    const u = new URL(`${this.url}/storage/v1${res.data.url}`);
    return { url: u.toString(), token: res.data.token ?? u.searchParams.get("token") ?? "" };
  }
}
