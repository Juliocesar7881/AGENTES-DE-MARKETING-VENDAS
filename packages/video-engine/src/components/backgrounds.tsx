import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { BackgroundStyle, Decor } from "../theme";
import { mix, rgba } from "../utils";
import { useTheme } from "./context";

/** Slow-moving mesh/linear gradient base layer. */
export function GradientBackground({ variant, colors }: { variant?: BackgroundStyle; colors?: string[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const v = variant ?? t.style.background;
  const c1 = colors?.[0] ?? t.primary;
  const c2 = colors?.[1] ?? t.secondary;
  const time = frame / fps;
  const drift = (speed: number, amp: number, phase: number) => Math.sin(time * speed + phase) * amp;
  if (v === "solid") return <AbsoluteFill style={{ background: t.bg }} />;
  if (v === "vibrant") {
    return (
      <AbsoluteFill
        style={{
          background: `linear-gradient(${135 + drift(0.3, 12, 0)}deg, ${c1} 0%, ${mix(c1, c2, 0.5)} 55%, ${c2} 100%)`,
        }}
      />
    );
  }
  if (v === "gradient" || v === "split-tone") {
    return (
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 80% at ${50 + drift(0.25, 12, 1)}% ${10 + drift(0.2, 6, 0)}%, ${rgba(c1, 0.42)} 0%, transparent 60%), radial-gradient(100% 70% at ${30 + drift(0.2, 10, 2)}% 100%, ${rgba(c2, 0.35)} 0%, transparent 65%), ${t.bg}`,
        }}
      />
    );
  }
  if (v === "grid") {
    const size = 90 * t.layout.unit;
    return (
      <AbsoluteFill style={{ background: `radial-gradient(90% 60% at 50% 0%, ${rgba(c1, 0.3)}, transparent 70%), ${t.bg}` }}>
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${rgba(t.fg, 0.06)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(t.fg, 0.06)} 1px, transparent 1px)`,
            backgroundSize: `${size}px ${size}px`,
            backgroundPosition: `0 ${(frame * 0.6) % size}px`,
            maskImage: "radial-gradient(80% 70% at 50% 40%, black, transparent)",
          }}
        />
      </AbsoluteFill>
    );
  }
  // mesh (default), spotlight, noise, letterbox
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(60% 45% at ${25 + drift(0.35, 14, 0)}% ${20 + drift(0.3, 10, 1)}%, ${rgba(c1, 0.55)} 0%, transparent 70%)`,
          `radial-gradient(55% 40% at ${80 + drift(0.28, 12, 2)}% ${45 + drift(0.25, 14, 3)}%, ${rgba(c2, 0.45)} 0%, transparent 70%)`,
          `radial-gradient(70% 50% at ${40 + drift(0.22, 16, 4)}% ${95 + drift(0.3, 8, 5)}%, ${rgba(t.accent, 0.3)} 0%, transparent 70%)`,
          t.bg,
        ].join(", "),
      }}
    />
  );
}

/** Soft moving light source. */
export function Spotlight({ x = 50, y = 30, color, size = 70, intensity = 0.5 }: { x?: number; y?: number; color?: string; size?: number; intensity?: number }) {
  const frame = useCurrentFrame();
  const t = useTheme();
  const pulse = 1 + Math.sin(frame / 18) * 0.06;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(${size * pulse}% ${size * 0.7 * pulse}% at ${x + Math.sin(frame / 40) * 4}% ${y}%, ${rgba(color ?? t.primary, intensity)} 0%, transparent 70%)`,
        mixBlendMode: "screen",
        pointerEvents: "none",
      }}
    />
  );
}

/** Film grain via SVG turbulence (cheap, deterministic). */
export function Grain({ opacity = 0.08 }: { opacity?: number }) {
  const frame = useCurrentFrame();
  const seed = frame % 6;
  return (
    <AbsoluteFill style={{ opacity, mixBlendMode: "overlay", pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id={`grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
      </svg>
    </AbsoluteFill>
  );
}

/** Deterministic floating particles. */
export function Particles({ count = 24, color, seed = "p" }: { count?: number; color?: string; seed?: string }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = useTheme();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: count }).map((_, i) => {
        const x = random(`${seed}x${i}`) * width;
        const baseY = random(`${seed}y${i}`) * height;
        const speed = 0.3 + random(`${seed}s${i}`) * 1.2;
        const size = (4 + random(`${seed}r${i}`) * 10) * t.layout.unit;
        const y = (baseY - frame * speed * 2 + height) % height;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: "50%",
              background: color ?? t.accent,
              opacity: 0.15 + random(`${seed}o${i}`) * 0.35,
              filter: `blur(${random(`${seed}b${i}`) * 3}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

/** Template-specific decorative layer (kept subtle to avoid visual noise). */
export function DecorLayer({ decor }: { decor?: Decor }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const d = decor ?? t.style.decor;
  switch (d) {
    case "floating-cards":
      return (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: [0.06, 0.62, 0.12][i]! * width,
                top: [0.1, 0.18, 0.72][i]! * height + Math.sin(frame / 30 + i) * 14 * u,
                width: [260, 220, 300][i]! * u,
                height: [150, 120, 90][i]! * u,
                borderRadius: 28 * u,
                background: rgba(t.fg, 0.05),
                border: `1px solid ${rgba(t.fg, 0.1)}`,
                transform: `rotate(${[-8, 6, -4][i]}deg)`,
                backdropFilter: "blur(6px)",
              }}
            />
          ))}
        </AbsoluteFill>
      );
    case "orbs":
      return (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          {[0, 1].map((i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                width: 520 * u,
                height: 520 * u,
                borderRadius: "50%",
                left: (i === 0 ? -0.15 : 0.55) * width + Math.sin(frame / 50 + i) * 30 * u,
                top: (i === 0 ? 0.05 : 0.6) * height + Math.cos(frame / 45 + i) * 30 * u,
                background: `radial-gradient(circle, ${rgba(i === 0 ? t.primary : t.secondary, 0.45)}, transparent 70%)`,
                filter: `blur(${30 * u}px)`,
              }}
            />
          ))}
        </AbsoluteFill>
      );
    case "dots": {
      const size = 44 * u;
      return (
        <AbsoluteFill
          style={{
            backgroundImage: `radial-gradient(${rgba(t.fg, 0.12)} ${2 * u}px, transparent ${2.5 * u}px)`,
            backgroundSize: `${size}px ${size}px`,
            maskImage: "linear-gradient(180deg, transparent, black 30%, black 70%, transparent)",
            pointerEvents: "none",
          }}
        />
      );
    }
    case "lines":
      return (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          {[0.18, 0.82].map((y, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: t.layout.safe.left,
                right: width - t.layout.safe.right,
                top: y * height,
                height: 2 * u,
                background: rgba(t.fg, 0.18),
                transform: `scaleX(${interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" })})`,
                transformOrigin: i === 0 ? "left" : "right",
              }}
            />
          ))}
        </AbsoluteFill>
      );
    case "stripes":
      return (
        <AbsoluteFill
          style={{
            backgroundImage: `repeating-linear-gradient(-45deg, ${rgba("#000000", 0.07)} 0 ${24 * u}px, transparent ${24 * u}px ${48 * u}px)`,
            backgroundPosition: `${frame * 2}px 0`,
            pointerEvents: "none",
          }}
        />
      );
    case "quote":
      return (
        <div
          style={{
            position: "absolute",
            top: t.layout.safe.top - 60 * u,
            left: t.layout.safe.left - 10 * u,
            fontSize: 420 * u,
            lineHeight: 1,
            fontFamily: "Georgia, serif",
            color: rgba(t.primary, 0.12),
            pointerEvents: "none",
          }}
        >
          “
        </div>
      );
    case "grid":
    case "burst":
    case "none":
    default:
      return null;
  }
}

export function Letterbox({ amount = 1 }: { amount?: number }) {
  const t = useTheme();
  const bar = (t.layout.format === "9:16" ? 170 : 90) * t.layout.unit * amount;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: bar, background: "#000" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: bar, background: "#000" }} />
    </AbsoluteFill>
  );
}
