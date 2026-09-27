import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { deriveKey, storage } from "@revenueos/core";
import { fileUrlSignature, LocalStorageProvider } from "@revenueos/providers/storage";
import { safeEqual } from "@revenueos/shared/server";
import "@/server/boot";

const TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", svg: "image/svg+xml", wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", json: "application/json" };

/**
 * Serves files from LOCAL storage through short-lived HMAC-signed URLs
 * (/api/files/<key>?exp=…&sig=…). No session is needed so social platforms
 * and the video player can fetch them, but every URL expires and is bound to one key.
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const st = storage();
  if (!(st instanceof LocalStorageProvider)) return new Response("Not found", { status: 404 });
  const key = (await ctx.params).key.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  if (!Number.isFinite(exp) || exp < Date.now() / 1000 || !safeEqual(sig, fileUrlSignature(key, exp, deriveKey("file-urls")))) {
    return new Response("Link expired or invalid", { status: 403 });
  }
  let path: string;
  try {
    path = st.resolvePath(key);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  let size: number;
  try {
    const s = await stat(path);
    if (!s.isFile()) return new Response("Not found", { status: 404 });
    size = s.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const headers: Record<string, string> = {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=300",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(body, { status: 200, headers: { ...headers, "content-length": String(size) } });
}
