import { continueRender, delayRender } from "remotion";
import type { FontFamily } from "@revenueos/shared/video-spec";

export { FONT_FILES, fontStack, nearestWeight } from "./font-meta";
import { FONT_FILES } from "./font-meta";

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
