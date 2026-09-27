import type { VideoFormat } from "@revenueos/shared/video-spec";

/* Pure layout / text-fitting helpers (no Remotion import — shared by templates and Content QA). */

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/* ------------------------------ layout ------------------------------ */

export interface SafeLayout {
  width: number;
  height: number;
  format: VideoFormat;
  /** Content box inside platform-safe zones. */
  safe: { top: number; bottom: number; left: number; right: number; width: number; height: number };
  /** Vertical position of the caption band's center. */
  captionY: number;
  /** Scale factor relative to a 1080px short side. */
  unit: number;
}

export function computeLayout(width: number, height: number): SafeLayout {
  const format: VideoFormat = Math.abs(width / height - 9 / 16) < 0.02 ? "9:16" : Math.abs(width / height - 1) < 0.02 ? "1:1" : "16:9";
  const unit = Math.min(width, height) / 1080;
  let top: number, bottom: number, side: number;
  if (format === "9:16") {
    // Keep clear of platform UI: top bar, bottom caption/UI area and right-side action rail.
    top = 250 * unit;
    bottom = 440 * unit;
    side = 84 * unit;
  } else if (format === "1:1") {
    top = 90 * unit;
    bottom = 150 * unit;
    side = 90 * unit;
  } else {
    top = 80 * unit;
    bottom = 150 * unit;
    side = 160 * unit;
  }
  const safe = { top, bottom: height - bottom, left: side, right: width - side * (format === "9:16" ? 1.25 : 1), width: 0, height: 0 };
  safe.width = safe.right - safe.left;
  safe.height = safe.bottom - safe.top;
  const captionY = format === "9:16" ? height - 520 * unit : height - 95 * unit;
  return { width, height, format, safe, captionY, unit };
}

/* ------------------------------ text fitting ------------------------------ */

/** Approximate average glyph width in em for a font weight/case. Shared with QA. */
export function glyphWidthEm(upper: boolean, condensed = false): number {
  if (condensed) return upper ? 0.46 : 0.42;
  return upper ? 0.66 : 0.56;
}

/**
 * Picks a font size so `text` fits in `maxWidth` x `maxLines`. Deterministic
 * and used both by templates (render) and by Content QA (overflow detection).
 */
export function fitFontSize(text: string, maxWidth: number, maxLines: number, maxSize: number, minSize: number, opts: { upper?: boolean; condensed?: boolean; lineHeight?: number } = {}): { size: number; lines: number; overflow: boolean } {
  const em = glyphWidthEm(Boolean(opts.upper), opts.condensed);
  const words = text.split(/\s+/).filter(Boolean);
  for (let size = maxSize; size >= minSize; size -= 2) {
    const maxChars = Math.max(1, Math.floor(maxWidth / (size * em)));
    let lines = 1;
    let current = 0;
    let fits = true;
    for (const w of words) {
      if (w.length > maxChars) {
        fits = false;
        break;
      }
      const add = current === 0 ? w.length : current + 1 + w.length;
      if (add > maxChars) {
        lines++;
        current = w.length;
      } else current = add;
    }
    if (fits && lines <= maxLines) return { size, lines, overflow: false };
  }
  const maxChars = Math.max(1, Math.floor(maxWidth / (minSize * em)));
  return { size: minSize, lines: Math.ceil(text.length / maxChars), overflow: true };
}

export function hashNum(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
