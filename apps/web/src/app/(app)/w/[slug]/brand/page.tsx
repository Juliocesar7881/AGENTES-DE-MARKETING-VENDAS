import { brandAssets, brandKits, desc, eq, withUser } from "@revenueos/database";
import { BrandStudio, type BrandKitData } from "@/components/brand/brand-studio";
import { signedUrls } from "@/server/files";
import { requireWorkspace } from "@/server/session";

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, ws } = await requireWorkspace(slug);
  const { kit, assets } = await withUser(user.id, async (tx) => ({
    kit: (await tx.select().from(brandKits).where(eq(brandKits.workspaceId, ws.id)).limit(1))[0]!,
    assets: await tx.select().from(brandAssets).where(eq(brandAssets.workspaceId, ws.id)).orderBy(desc(brandAssets.createdAt)).limit(200),
  }));
  const thumbs = await signedUrls(assets.map((a) => a.thumbnailKey));
  const urls = await signedUrls(assets.map((a) => (a.mimeType.startsWith("image/") ? a.storageKey : null)));
  const data: BrandKitData = {
    businessName: kit.businessName,
    primaryColor: kit.primaryColor,
    secondaryColor: kit.secondaryColor,
    accentColor: kit.accentColor,
    backgroundColor: kit.backgroundColor,
    textColor: kit.textColor,
    fontHeading: kit.fontHeading,
    fontBody: kit.fontBody,
    tone: kit.tone,
    style: kit.style,
    voice: kit.voice,
    handle: kit.handle,
    website: kit.website,
    description: kit.description,
    targetAudience: kit.targetAudience,
    keywords: kit.keywords,
    forbiddenWords: kit.forbiddenWords,
    ctaPreferences: kit.ctaPreferences,
    logoAssetId: kit.logoAssetId,
  };
  return (
    <BrandStudio
      workspaceId={ws.id}
      kit={data}
      website={ws.website}
      assets={assets.map((a, i) => ({ id: a.id, kind: a.kind, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes, status: a.status, thumb: thumbs[i] ?? null, url: urls[i] ?? null }))}
    />
  );
}
