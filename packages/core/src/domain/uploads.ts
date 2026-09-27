import { createHash, randomUUID } from "node:crypto";
import { and, brandAssets, eq } from "@revenueos/database";
import { AppError, type AssetKind } from "@revenueos/shared";
import { db } from "../deps";
import { enqueueJob } from "../jobs/queue";
import { storage } from "../providers";
import { audit } from "../records";

export const UPLOAD_LIMITS = {
  image: 15 * 1024 * 1024,
  video: 300 * 1024 * 1024,
  audio: 30 * 1024 * 1024,
} as const;

const TYPES: { mime: string; ext: string[]; family: keyof typeof UPLOAD_LIMITS; sniff: (b: Buffer) => boolean }[] = [
  { mime: "image/png", ext: ["png"], family: "image", sniff: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: ["jpg", "jpeg"], family: "image", sniff: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: ["webp"], family: "image", sniff: (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
  { mime: "image/svg+xml", ext: ["svg"], family: "image", sniff: (b) => /<svg[\s>]/i.test(b.toString("utf8", 0, Math.min(b.length, 4096))) },
  { mime: "video/mp4", ext: ["mp4", "m4v"], family: "video", sniff: (b) => b.toString("ascii", 4, 8) === "ftyp" && !/^qt/.test(b.toString("ascii", 8, 10)) },
  { mime: "video/quicktime", ext: ["mov"], family: "video", sniff: (b) => b.toString("ascii", 4, 8) === "ftyp" || b.toString("ascii", 4, 8) === "moov" || b.toString("ascii", 4, 8) === "wide" },
  { mime: "audio/mpeg", ext: ["mp3"], family: "audio", sniff: (b) => b.toString("ascii", 0, 3) === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) },
  { mime: "audio/wav", ext: ["wav"], family: "audio", sniff: (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE" },
  { mime: "audio/mp4", ext: ["m4a"], family: "audio", sniff: (b) => b.toString("ascii", 4, 8) === "ftyp" },
];

/** Rejects SVGs that could execute code (scripts, event handlers, external refs, entities). */
export function assertSafeSvg(svg: string): void {
  const bad = [/<script/i, /\son[a-z]+\s*=/i, /javascript:/i, /<foreignObject/i, /<!ENTITY/i, /<iframe/i, /<embed/i, /<object/i, /(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|data:text)/i, /@import/i];
  for (const re of bad) {
    if (re.test(svg)) throw new AppError({ code: "UNSAFE_SVG", userMessage: "This SVG contains scripts or external references and was rejected for safety.", httpStatus: 400 });
  }
}

export interface ValidatedUpload {
  mime: string;
  ext: string;
  family: "image" | "video" | "audio";
  size: number;
  sha256: string;
}

/** Validates extension + declared MIME + magic bytes + size. Never trusts the client alone. */
export function validateUpload(filename: string, declaredMime: string, data: Buffer): ValidatedUpload {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const safeName = /^[\w .()-]{1,200}$/.test(filename.replace(/\.[^.]+$/, ""));
  if (!safeName) throw new AppError({ code: "BAD_FILENAME", userMessage: "Unsupported characters in the file name.", httpStatus: 400 });
  const t = TYPES.find((x) => x.ext.includes(ext));
  if (!t) throw new AppError({ code: "BAD_EXTENSION", userMessage: `.${ext} files are not supported. Use PNG, JPG, WEBP, SVG, MP4, MOV, MP3, WAV or M4A.`, httpStatus: 400 });
  if (declaredMime && declaredMime !== "application/octet-stream" && declaredMime !== t.mime && !(t.mime === "image/jpeg" && declaredMime === "image/jpg")) {
    throw new AppError({ code: "MIME_MISMATCH", userMessage: `The file type (${declaredMime}) does not match its extension (.${ext}).`, httpStatus: 400 });
  }
  if (!t.sniff(data)) throw new AppError({ code: "CONTENT_MISMATCH", userMessage: "The file content does not match its type. It may be corrupted or renamed.", httpStatus: 400 });
  if (data.length > UPLOAD_LIMITS[t.family]) {
    throw new AppError({ code: "TOO_LARGE", userMessage: `File too large (max ${UPLOAD_LIMITS[t.family] / 1024 / 1024} MB for ${t.family}).`, httpStatus: 413 });
  }
  if (t.mime === "image/svg+xml") assertSafeSvg(data.toString("utf8"));
  return { mime: t.mime, ext: t.ext[0]!, family: t.family, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}

function defaultKind(family: string, requested?: AssetKind | null): AssetKind {
  if (requested) return requested;
  return family === "video" ? "VIDEO" : family === "audio" ? "AUDIO" : "PHOTO";
}

/** Stores a brand asset (dedupes by content hash) and generates an image thumbnail when possible. */
export async function storeBrandAsset(opts: { workspaceId: string; userId: string; filename: string; mime: string; data: Buffer; kind?: AssetKind | null; description?: string }) {
  const v = validateUpload(opts.filename, opts.mime, opts.data);
  const existing = await db().select().from(brandAssets).where(and(eq(brandAssets.workspaceId, opts.workspaceId), eq(brandAssets.sha256, v.sha256))).limit(1);
  if (existing[0]) return existing[0];
  const id = randomUUID();
  const key = `workspaces/${opts.workspaceId}/assets/${id}.${v.ext}`;
  await storage().put(key, opts.data, v.mime);
  let thumbnailKey: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  if (v.family === "image" && v.mime !== "image/svg+xml") {
    try {
      const sharp = (await import("sharp")).default;
      const img = sharp(opts.data, { limitInputPixels: 80_000_000 });
      const meta = await img.metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      const thumb = await img.rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      thumbnailKey = `workspaces/${opts.workspaceId}/thumbs/${id}.webp`;
      await storage().put(thumbnailKey, thumb, "image/webp");
    } catch {
      /* sharp unavailable — the original is used as preview */
    }
  }
  const [row] = await db()
    .insert(brandAssets)
    .values({
      id,
      workspaceId: opts.workspaceId,
      kind: defaultKind(v.family, opts.kind),
      filename: opts.filename.slice(0, 200),
      mimeType: v.mime,
      sizeBytes: v.size,
      storageKey: key,
      thumbnailKey,
      width,
      height,
      sha256: v.sha256,
      description: opts.description ?? "",
      uploadedBy: opts.userId,
      status: v.family === "video" ? "PROCESSING" : "READY",
    })
    .returning();
  if (v.family === "video") {
    await enqueueJob({ type: "PROCESS_ASSET", workspaceId: opts.workspaceId, payload: { assetId: id }, origin: "HUMAN", idempotencyKey: `process_asset:${id}` });
  }
  await audit({ workspaceId: opts.workspaceId, actorType: "USER", actorId: opts.userId, action: "asset.upload", entityType: "brand_asset", entityId: id, details: { mime: v.mime, size: v.size } });
  return row!;
}
