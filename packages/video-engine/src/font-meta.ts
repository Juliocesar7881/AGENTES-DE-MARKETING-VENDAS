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
