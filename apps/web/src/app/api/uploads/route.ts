import { NextResponse } from "next/server";
import { assertMember, rateLimit, storeBrandAsset, UPLOAD_LIMITS } from "@revenueos/core";
import { isUuid } from "@revenueos/database";
import { AppError, ASSET_KINDS, type AssetKind } from "@revenueos/shared";
import { getUser } from "@/server/session";

export const maxDuration = 120;

/**
 * Brand asset upload (multipart). Checks: session, workspace membership,
 * declared size, extension + MIME + magic bytes (in storeBrandAsset), SVG
 * script/external-ref rejection, per-user rate limit. Videos are processed by the worker.
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > UPLOAD_LIMITS.video + 1024 * 1024) return NextResponse.json({ error: "File too large (max 300 MB for videos, 15 MB for images)." }, { status: 413 });
  try {
    await rateLimit(`upload:${user.id}`, 60, 3600);
    const form = await req.formData();
    const workspaceId = String(form.get("workspaceId") ?? "");
    if (!isUuid(workspaceId)) return NextResponse.json({ error: "Missing business." }, { status: 400 });
    await assertMember(user.id, workspaceId);
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file received." }, { status: 400 });
    const kindRaw = String(form.get("kind") ?? "");
    const kind = (ASSET_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as AssetKind) : null;
    const data = Buffer.from(await file.arrayBuffer());
    const asset = await storeBrandAsset({ workspaceId, userId: user.id, filename: file.name, mime: file.type, data, kind, description: String(form.get("description") ?? "").slice(0, 300) });
    return NextResponse.json({ id: asset.id, status: asset.status, kind: asset.kind });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.userMessage }, { status: e.httpStatus ?? 400 });
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
