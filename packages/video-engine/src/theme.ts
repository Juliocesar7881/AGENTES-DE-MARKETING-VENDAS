import type { FontFamily, TemplateId, TransitionKind, VideoSpec } from "@revenueos/shared/video-spec";
import { contrastRatio, isDark, luminance, mix, readableOn } from "./color";
import { fontStack, FONT_FILES } from "./font-meta";
import { computeLayout, type SafeLayout } from "./layout";
import type { MotionPreset } from "./utils";

export type Decor = "none" | "floating-cards" | "burst" | "grid" | "dots" | "orbs" | "quote" | "lines" | "stripes";
export type BackgroundStyle = "mesh" | "gradient" | "solid" | "spotlight" | "grid" | "noise" | "letterbox" | "split-tone" | "vibrant";

export interface TemplateStyle {
  id: TemplateId;
  background: BackgroundStyle;
  decor: Decor;
  surface: "glass" | "solid" | "outline";
  accent: "underline" | "highlight" | "pill" | "glow";
  headlineUpper: boolean;
  headlineWeight: number;
  headlineScale: number;
  letterSpacing: number;
  motion: MotionPreset;
  transition: TransitionKind;
  captionStyle: "pill" | "bar" | "plain";
  progressBar: boolean;
  grain: boolean;
  letterbox: boolean;
  /** Suggested display font used only when the brand kept the default font. */
  displayFont?: FontFamily;
  radius: number;
}

export const TEMPLATE_STYLES: Record<TemplateId, TemplateStyle> = {
  "saas-modern": { id: "saas-modern", background: "mesh", decor: "floating-cards", surface: "glass", accent: "glow", headlineUpper: false, headlineWeight: 800, headlineScale: 1, letterSpacing: -0.02, motion: "smooth", transition: "slide-up", captionStyle: "pill", progressBar: false, grain: false, letterbox: false, radius: 36 },
  "problem-solution": { id: "problem-solution", background: "split-tone", decor: "none", surface: "solid", accent: "highlight", headlineUpper: false, headlineWeight: 800, headlineScale: 1.05, letterSpacing: -0.02, motion: "smooth", transition: "wipe", captionStyle: "bar", progressBar: false, grain: true, letterbox: false, radius: 28 },
  "fast-hook": { id: "fast-hook", background: "gradient", decor: "burst", surface: "solid", accent: "highlight", headlineUpper: true, headlineWeight: 800, headlineScale: 1.15, letterSpacing: -0.01, motion: "snappy", transition: "zoom", captionStyle: "bar", progressBar: true, grain: false, letterbox: false, displayFont: "Montserrat", radius: 24 },
  "feature-showcase": { id: "feature-showcase", background: "spotlight", decor: "grid", surface: "glass", accent: "pill", headlineUpper: false, headlineWeight: 700, headlineScale: 1, letterSpacing: -0.02, motion: "smooth", transition: "slide-left", captionStyle: "pill", progressBar: false, grain: false, letterbox: false, radius: 32 },
  "product-demo": { id: "product-demo", background: "gradient", decor: "dots", surface: "solid", accent: "underline", headlineUpper: false, headlineWeight: 700, headlineScale: 0.95, letterSpacing: -0.02, motion: "smooth", transition: "fade", captionStyle: "pill", progressBar: false, grain: false, letterbox: false, radius: 28 },
  "app-showcase": { id: "app-showcase", background: "mesh", decor: "orbs", surface: "glass", accent: "glow", headlineUpper: false, headlineWeight: 800, headlineScale: 1, letterSpacing: -0.02, motion: "smooth", transition: "slide-up", captionStyle: "pill", progressBar: false, grain: false, letterbox: false, radius: 40 },
  "before-after": { id: "before-after", background: "solid", decor: "none", surface: "solid", accent: "pill", headlineUpper: false, headlineWeight: 800, headlineScale: 1, letterSpacing: -0.02, motion: "smooth", transition: "wipe", captionStyle: "bar", progressBar: false, grain: false, letterbox: false, radius: 28 },
  testimonial: { id: "testimonial", background: "gradient", decor: "quote", surface: "solid", accent: "underline", headlineUpper: false, headlineWeight: 700, headlineScale: 0.95, letterSpacing: -0.01, motion: "slow", transition: "fade", captionStyle: "plain", progressBar: false, grain: true, letterbox: false, radius: 36 },
  "social-proof": { id: "social-proof", background: "grid", decor: "grid", surface: "glass", accent: "pill", headlineUpper: false, headlineWeight: 800, headlineScale: 1, letterSpacing: -0.02, motion: "smooth", transition: "slide-up", captionStyle: "pill", progressBar: false, grain: false, letterbox: false, radius: 32 },
  storytelling: { id: "storytelling", background: "spotlight", decor: "none", surface: "outline", accent: "underline", headlineUpper: false, headlineWeight: 600, headlineScale: 0.95, letterSpacing: -0.01, motion: "slow", transition: "blur", captionStyle: "plain", progressBar: false, grain: true, letterbox: true, displayFont: "Playfair Display", radius: 20 },
  listicle: { id: "listicle", background: "gradient", decor: "lines", surface: "solid", accent: "pill", headlineUpper: false, headlineWeight: 800, headlineScale: 1, letterSpacing: -0.02, motion: "snappy", transition: "slide-left", captionStyle: "bar", progressBar: true, grain: false, letterbox: false, radius: 28 },
  "premium-minimal": { id: "premium-minimal", background: "solid", decor: "lines", surface: "outline", accent: "underline", headlineUpper: false, headlineWeight: 600, headlineScale: 0.92, letterSpacing: 0, motion: "slow", transition: "fade", captionStyle: "plain", progressBar: false, grain: true, letterbox: false, displayFont: "Playfair Display", radius: 8 },
  "bold-typography": { id: "bold-typography", background: "vibrant", decor: "stripes", surface: "solid", accent: "highlight", headlineUpper: true, headlineWeight: 800, headlineScale: 1.3, letterSpacing: -0.01, motion: "snappy", transition: "zoom", captionStyle: "bar", progressBar: false, grain: false, letterbox: false, displayFont: "Archivo Black", radius: 0 },
  "dashboard-showcase": { id: "dashboard-showcase", background: "grid", decor: "grid", surface: "glass", accent: "glow", headlineUpper: false, headlineWeight: 700, headlineScale: 0.95, letterSpacing: -0.02, motion: "smooth", transition: "slide-up", captionStyle: "pill", progressBar: false, grain: false, letterbox: false, radius: 24 },
  "promotional-offer": { id: "promotional-offer", background: "vibrant", decor: "burst", surface: "solid", accent: "pill", headlineUpper: true, headlineWeight: 800, headlineScale: 1.1, letterSpacing: -0.01, motion: "snappy", transition: "zoom", captionStyle: "bar", progressBar: false, grain: false, letterbox: false, displayFont: "Montserrat", radius: 32 },
};

export interface Theme {
  style: TemplateStyle;
  layout: SafeLayout;
  bg: string;
  bg2: string;
  /** Color actually behind the text in the current context (frame, scene background or card). */
  canvas: string;
  /** Card/panel color that reads well on the canvas. */
  surface: string;
  fg: string;
  muted: string;
  brandText: string;
  primary: string;
  secondary: string;
  accent: string;
  danger: string;
  success: string;
  onPrimary: string;
  onAccent: string;
  /** Readable highlight color for emphasized words, big numbers and icons. */
  emphasis: string;
  ctaBg: string;
  ctaFg: string;
  headingFont: FontFamily;
  bodyFont: FontFamily;
  heading: string;
  body: string;
  condensedHeading: boolean;
}

/**
 * Re-derives every text-related color for a given background color. Used for
 * the whole frame, for scenes with their own background and inside cards, so
 * text is always legible regardless of brand colors.
 */
export function deriveTheme(base: Theme, canvas: string): Theme {
  const fg = readableOn(canvas, base.brandText, 4.5);
  const lum = luminance(canvas);
  const surface = lum < 0.2 ? mix(canvas, "#FFFFFF", 0.08) : lum > 0.6 ? mix(canvas, "#000000", 0.06) : mix(canvas, "#0B0F14", 0.78);
  const emphasis = [base.primary, base.accent, base.secondary].find((c) => contrastRatio(canvas, c) >= 3) ?? fg;
  const ctaBg = contrastRatio(canvas, base.primary) >= 1.8 ? base.primary : contrastRatio(canvas, base.accent) >= 1.8 ? base.accent : contrastRatio(canvas, "#0B0F14") > contrastRatio(canvas, "#FFFFFF") ? "#0B0F14" : "#FFFFFF";
  return {
    ...base,
    canvas,
    surface,
    fg,
    muted: mix(fg, canvas, 0.32),
    emphasis,
    ctaBg,
    ctaFg: readableOn(ctaBg, ctaBg === "#0B0F14" || ctaBg === "#FFFFFF" ? base.primary : undefined, 3),
  };
}

export function buildTheme(spec: Pick<VideoSpec, "brand" | "templateId">, width: number, height: number): Theme {
  const style = TEMPLATE_STYLES[spec.templateId] ?? TEMPLATE_STYLES["saas-modern"];
  const b = spec.brand;
  const bg = b.backgroundColor;
  const dark = isDark(bg);
  const vibrant = style.background === "vibrant";
  const canvas = vibrant ? mix(b.primaryColor, b.secondaryColor, 0.5) : bg;
  const headingFont: FontFamily = b.fontHeading === "Inter" && style.displayFont ? style.displayFont : b.fontHeading;
  const base: Theme = {
    style,
    layout: computeLayout(width, height),
    bg,
    bg2: mix(bg, b.primaryColor, dark ? 0.18 : 0.08),
    canvas,
    surface: bg,
    fg: b.textColor,
    muted: b.textColor,
    brandText: b.textColor,
    primary: b.primaryColor,
    secondary: b.secondaryColor,
    accent: b.accentColor,
    danger: "#FF4D5E",
    success: "#2EE6A6",
    onPrimary: readableOn(b.primaryColor),
    onAccent: readableOn(b.accentColor),
    emphasis: b.primaryColor,
    ctaBg: b.primaryColor,
    ctaFg: readableOn(b.primaryColor),
    headingFont,
    bodyFont: b.fontBody,
    heading: fontStack(headingFont),
    body: fontStack(b.fontBody),
    condensedHeading: Boolean(FONT_FILES[headingFont]?.condensed),
  };
  return deriveTheme(base, canvas);
}
