import { continueRender, delayRender } from "remotion";
import type { FontFamily } from "@revenueos/shared/video-spec";

/** Font files bundled from @fontsource (OFL). Weight lists must match scripts/copy-fonts.mjs. */
export const FONT_FILES: Record<FontFamily, { slug: string; weights: number[]; condensed?: boolean }> = {
  Inter: { slug: "inter", weights: [400, 600, 700, 800] },
  Montserrat: { slug: "montserrat", weights: [400, 600, 700, 800] },
  Poppins: { slug: "poppins", weights: [400, 600, 700, 800] },
  "Bebas Neue": { slug: "bebas-neue", weights: [400], condensed: true },
  "Playfair Display": { slug: "playfair-display", weights: [400, 600, 700] },
  "Space Grotesk": { slug: "space-grotesk", weights: [400, 600, 700] },
  "DM Sans": { slug: "dm-sans", weights: [400, 600, 700] },
  "Archivo Black": { slug: "archivo-black", weights: [400] },
  Sora: { slug: "sora", weights: [400, 600, 700, 800] },
  Manrope: { slug: "manrope", weights: [400, 600, 700, 800] },
};

export function fontStack(family: FontFamily): string {
  return `"${family}", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif`;
}

/** Nearest bundled weight for a requested weight. */
export function nearestWeight(family: FontFamily, weight: number): number {
  const ws = FONT_FILES[family].weights;
  return ws.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), ws[0]!);
}

const loaded = new Set<string>();

/**
 * Loads the fonts used by a video via the FontFace API. During renders the
 * frame is held (delayRender) until fonts are ready, so text never pops.
 */
export function ensureFonts(families: FontFamily[], baseUrl: string): void {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;
  const pending: Promise<unknown>[] = [];
  for (const family of new Set(families)) {
    const def = FONT_FILES[family];
    if (!def) continue;
    for (const w of def.weights) {
      const key = `${family}:${w}:${baseUrl}`;
      if (loaded.has(key)) continue;
      loaded.add(key);
      const face = new FontFace(family, `url(${baseUrl.replace(/\/$/, "")}/${def.slug}-latin-${w}-normal.woff2) format("woff2")`, {
        weight: String(w),
        style: "normal",
        display: "block",
      });
      pending.push(
        face
          .load()
          .then((f) => {
            document.fonts.add(f);
          })
          .catch(() => {
            /* missing font falls back to system stack — never blocks the render */
          }),
      );
    }
  }
  if (pending.length === 0) return;
  const handle = delayRender(`Loading fonts ${families.join(", ")}`, { timeoutInMilliseconds: 20_000 });
  void Promise.all(pending).then(() => continueRender(handle));
}
