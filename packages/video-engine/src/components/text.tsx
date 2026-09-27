import type { CSSProperties, ReactNode } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { AnimationKind, Caption } from "@revenueos/shared/video-spec";
import { enter, fitFontSize, progress, rgba } from "../utils";
import { useTheme } from "./context";

export interface AnimatedHeadlineProps {
  text: string;
  animation?: AnimationKind;
  delay?: number;
  maxLines?: number;
  maxSize?: number;
  minSize?: number;
  width?: number;
  align?: "left" | "center" | "right";
  color?: string;
  emphasis?: string[];
  emphasisColor?: string;
  weight?: number;
  font?: "heading" | "body";
  upper?: boolean;
  style?: CSSProperties;
}

function norm(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Word-by-word headline animation with automatic font fitting (no overflow). */
export function AnimatedHeadline({
  text,
  animation = "fade-up",
  delay = 0,
  maxLines = 4,
  maxSize,
  minSize,
  width,
  align = "center",
  color,
  emphasis = [],
  emphasisColor,
  weight,
  font = "heading",
  upper,
  style,
}: AnimatedHeadlineProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const isUpper = upper ?? (font === "heading" && t.style.headlineUpper);
  const boxWidth = width ?? t.layout.safe.width;
  const fit = fitFontSize(text, boxWidth, maxLines, Math.round((maxSize ?? 118) * u * t.style.headlineScale), Math.round((minSize ?? 44) * u), {
    upper: isUpper,
    condensed: font === "heading" && t.condensedHeading,
  });
  const emphasisSet = new Set(emphasis.flatMap((e) => e.split(/\s+/)).map(norm).filter(Boolean));
  const words = text.split(/\s+/).filter(Boolean);
  const stagger = animation === "kinetic" || animation === "pop" ? 3 : 2;
  const chars = animation === "typewriter" ? Math.floor(interpolate(frame - delay, [0, Math.max(10, text.length * 1.2)], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) : text.length;
  let charCursor = 0;
  return (
    <div
      style={{
        width: boxWidth,
        fontFamily: font === "heading" ? t.heading : t.body,
        fontWeight: weight ?? (font === "heading" ? t.style.headlineWeight : 500),
        fontSize: fit.size,
        lineHeight: 1.08,
        letterSpacing: `${t.style.letterSpacing}em`,
        textTransform: isUpper ? "uppercase" : "none",
        color: color ?? t.fg,
        textAlign: align,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
        columnGap: fit.size * 0.26,
        rowGap: fit.size * 0.06,
        ...style,
      }}
    >
      {words.map((w, i) => {
        const p = animation === "none" ? 1 : enter(frame, fps, delay + i * stagger, t.style.motion === "slow" ? "slow" : animation === "pop" || animation === "kinetic" ? "snappy" : "smooth");
        const isEm = emphasisSet.has(norm(w));
        let transform = "none";
        let opacity = p;
        let filter = "none";
        let clipPath: string | undefined;
        switch (animation) {
          case "slide-left":
            transform = `translateX(${(1 - p) * 60 * u}px)`;
            break;
          case "slide-right":
            transform = `translateX(${(p - 1) * 60 * u}px)`;
            break;
          case "scale-in":
            transform = `scale(${0.6 + p * 0.4})`;
            break;
          case "pop":
          case "kinetic":
            transform = `scale(${0.3 + p * 0.7}) translateY(${(1 - p) * 30 * u}px)`;
            break;
          case "blur-in":
            filter = `blur(${(1 - p) * 18 * u}px)`;
            break;
          case "mask-reveal":
            clipPath = `inset(0 0 ${(1 - p) * 100}% 0)`;
            transform = `translateY(${(1 - p) * 40 * u}px)`;
            opacity = 1;
            break;
          case "typewriter": {
            const start = charCursor;
            charCursor += w.length + 1;
            const visible = Math.max(0, Math.min(w.length, chars - start));
            return (
              <span key={i} style={{ color: isEm ? (emphasisColor ?? t.emphasis) : undefined, whiteSpace: "pre" }}>
                {w.slice(0, visible)}
                <span style={{ opacity: 0 }}>{w.slice(visible)}</span>
              </span>
            );
          }
          case "none":
            break;
          default:
            transform = `translateY(${(1 - p) * 50 * u}px)`;
        }
        return (
          <span key={i} style={{ display: "inline-block", overflow: animation === "mask-reveal" ? "hidden" : undefined, paddingBottom: animation === "mask-reveal" ? fit.size * 0.08 : undefined }}>
            <span
              style={{
                display: "inline-block",
                transform,
                opacity,
                filter,
                clipPath,
                color: isEm ? (emphasisColor ?? t.emphasis) : undefined,
                textShadow: isEm && t.style.accent === "glow" ? `0 0 ${40 * u}px ${rgba(emphasisColor ?? t.emphasis, 0.6)}` : undefined,
              }}
            >
              {w}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Kinetic typography: words punch in one after another at large size,
 * the active word is highlighted, previous words settle into lines.
 */
export function KineticTypography({ text, delay = 0, highlight, maxLines = 5 }: { text: string; delay?: number; highlight?: string; maxLines?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const words = text.split(/\s+/).filter(Boolean);
  const perWord = Math.max(3, Math.min(7, Math.floor((fps * 1.1) / Math.max(1, words.length))));
  const fit = fitFontSize(text, t.layout.safe.width, maxLines, Math.round(150 * u * t.style.headlineScale), Math.round(56 * u), { upper: true, condensed: t.condensedHeading });
  const active = Math.min(words.length - 1, Math.floor((frame - delay) / perWord));
  return (
    <div
      style={{
        width: t.layout.safe.width,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: fit.size * 0.24,
        fontFamily: t.heading,
        fontWeight: 800,
        fontSize: fit.size,
        lineHeight: 1.02,
        textTransform: "uppercase",
        letterSpacing: "-0.02em",
        textAlign: "center",
      }}
    >
      {words.map((w, i) => {
        const p = enter(frame, fps, delay + i * perWord, "snappy");
        const isActive = i === active;
        const isHl = highlight ? norm(highlight).includes(norm(w)) && norm(w).length > 2 : false;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `scale(${interpolate(p, [0, 1], [1.8, 1])})`,
              opacity: interpolate(p, [0, 0.3, 1], [0, 1, 1]),
              color: isHl || isActive ? t.emphasis : t.fg,
              background: isHl ? rgba(t.emphasis, 0.14) : undefined,
              borderRadius: 12 * u,
              padding: isHl ? `0 ${10 * u}px` : undefined,
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
}

/** Animated marker highlight behind inline content. */
export function HighlightBox({ children, color, delay = 0, style }: { children: ReactNode; color?: string; delay?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const p = enter(frame, fps, delay, "smooth");
  return (
    <span style={{ position: "relative", display: "inline-block", padding: `0 ${12 * t.layout.unit}px`, ...style }}>
      <span
        style={{
          position: "absolute",
          inset: `8% -2%`,
          background: color ?? t.accent,
          borderRadius: 10 * t.layout.unit,
          transform: `scaleX(${p})`,
          transformOrigin: "left center",
          opacity: 0.9,
        }}
      />
      <span style={{ position: "relative", color: t.onAccent }}>{children}</span>
    </span>
  );
}

/**
 * On-screen subtitles in the platform-safe caption band. `frame` is the
 * absolute video frame. Styles: pill (rounded), bar (full-width band), plain.
 */
export function AnimatedSubtitle({ captions, variant }: { captions: Caption[]; variant?: "pill" | "bar" | "plain" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const time = frame / fps;
  const active = captions.find((c) => time >= c.start && time < c.end);
  if (!active) return null;
  const local = frame - Math.round(active.start * fps);
  const endLocal = Math.round((active.end - active.start) * fps);
  const p = progress(local, 0, 6);
  const out = progress(local, endLocal - 5, endLocal);
  const style = variant ?? t.style.captionStyle;
  const fit = fitFontSize(active.text, t.layout.safe.width * 0.92, 2, Math.round(54 * u), Math.round(34 * u));
  const words = active.text.split(/\s+/);
  const wordsShown = Math.ceil(interpolate(local, [0, Math.max(6, endLocal * 0.6)], [1, words.length], { extrapolateRight: "clamp", extrapolateLeft: "clamp" }));
  const bg = style === "plain" ? "transparent" : style === "bar" ? rgba("#000000", 0.62) : rgba("#0B0F14", 0.72);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: t.layout.captionY - fit.size, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div
        style={{
          maxWidth: t.layout.safe.width,
          padding: style === "plain" ? 0 : `${14 * u}px ${28 * u}px`,
          borderRadius: style === "pill" ? 999 : style === "bar" ? 14 * u : 0,
          background: bg,
          color: "#FFFFFF",
          fontFamily: t.body,
          fontWeight: 700,
          fontSize: fit.size,
          lineHeight: 1.2,
          textAlign: "center",
          opacity: p * (1 - out),
          transform: `translateY(${(1 - p) * 16 * u}px)`,
          textShadow: style === "plain" ? `0 ${3 * u}px ${18 * u}px rgba(0,0,0,0.85)` : undefined,
        }}
      >
        {words.map((w, i) => (
          <span key={i} style={{ opacity: i < wordsShown ? 1 : 0.35, color: i === wordsShown - 1 && style !== "plain" ? t.accent : undefined }}>
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
