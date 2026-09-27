import { Easing, interpolate, spring } from "remotion";
import type { VideoFormat } from "@revenueos/shared/video-spec";

/* ------------------------------ color ------------------------------ */

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Returns `preferred` when readable on `bg`, otherwise white or near-black. */
export function readableOn(bg: string, preferred?: string, min = 4.5): string {
  if (preferred && contrastRatio(bg, preferred) >= min) return preferred;
  return contrastRatio(bg, "#FFFFFF") >= contrastRatio(bg, "#0B0F14") ? "#FFFFFF" : "#0B0F14";
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

export function isDark(hex: string): boolean {
  return luminance(hex) < 0.35;
}

/* ------------------------------ motion ------------------------------ */

export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

export type MotionPreset = "smooth" | "snappy" | "slow";

export const SPRINGS: Record<MotionPreset, { damping: number; mass: number; stiffness: number }> = {
  smooth: { damping: 200, mass: 1, stiffness: 100 },
  snappy: { damping: 14, mass: 0.6, stiffness: 180 },
  slow: { damping: 200, mass: 2.2, stiffness: 60 },
};

export function enter(frame: number, fps: number, delay = 0, preset: MotionPreset = "smooth", durationInFrames?: number): number {
  return spring({ frame: frame - delay, fps, config: SPRINGS[preset], durationInFrames });
}

export function fadeInOut(frame: number, total: number, inFrames = 8, outFrames = 8): number {
  return interpolate(frame, [0, inFrames, Math.max(inFrames + 1, total - outFrames), total], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function progress(frame: number, start: number, end: number, easing = EASE_OUT): number {
  return interpolate(frame, [start, end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
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
