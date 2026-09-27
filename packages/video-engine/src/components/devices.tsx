import type { CSSProperties, ReactNode } from "react";
import { Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { enter, mix, progress, rgba } from "../utils";
import { AnimatedChart } from "./cards";
import { useTheme } from "./context";

/** Synthetic app UI used when no screenshot is available (never shows fake data claims). */
export function SkeletonUI({ variant = "app" }: { variant?: "app" | "web" }) {
  const frame = useCurrentFrame();
  const t = useTheme();
  const u = t.layout.unit;
  const shimmer = (frame * 6) % 400;
  const block = (w: string, h: number, color = rgba(t.fg, 0.1), extra: CSSProperties = {}) => (
    <div style={{ width: w, height: h * u, borderRadius: 14 * u, background: color, ...extra }} />
  );
  return (
    <div style={{ position: "absolute", inset: 0, padding: 36 * u, display: "flex", flexDirection: "column", gap: 22 * u, background: mix(t.bg, "#FFFFFF", 0.04), overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 * u }}>
        <div style={{ width: 56 * u, height: 56 * u, borderRadius: "50%", background: t.primary }} />
        {block("45%", 22)}
      </div>
      <div style={{ height: (variant === "app" ? 220 : 160) * u, borderRadius: 24 * u, background: `linear-gradient(135deg, ${t.primary}, ${t.secondary})` }} />
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ display: "flex", gap: 16 * u, alignItems: "center", opacity: interpolate(frame, [i * 6, i * 6 + 12], [0, 1], { extrapolateRight: "clamp" }) }}>
          <div style={{ width: 70 * u, height: 70 * u, borderRadius: 18 * u, background: rgba(t.accent, 0.8) }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 * u }}>
            {block("80%", 18)}
            {block("55%", 14, rgba(t.fg, 0.07))}
          </div>
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(100deg, transparent ${shimmer - 120}px, ${rgba("#FFFFFF", 0.06)} ${shimmer}px, transparent ${shimmer + 120}px)`,
        }}
      />
    </div>
  );
}

export function DeviceFrame({ type, children, width, delay = 0, tilt = 0, float = true }: { type: "phone" | "browser"; children: ReactNode; width?: number; delay?: number; tilt?: number; float?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const p = enter(frame, fps, delay, "smooth");
  const w = width ?? (type === "phone" ? Math.min(560 * u, t.layout.safe.width * 0.62) : t.layout.safe.width);
  const h = type === "phone" ? w * 2.05 : w * 0.68;
  const bob = float ? Math.sin(frame / 24) * 8 * u : 0;
  return (
    <div
      style={{
        width: w,
        height: h,
        position: "relative",
        transform: `perspective(${2400 * u}px) rotateY(${tilt * (1 - p * 0.4)}deg) translateY(${(1 - p) * 180 * u + bob}px) scale(${0.85 + p * 0.15})`,
        opacity: p,
        borderRadius: type === "phone" ? 72 * u : 24 * u,
        background: "#0A0A0C",
        padding: type === "phone" ? 18 * u : 0,
        boxShadow: `0 ${50 * u}px ${120 * u}px ${rgba("#000000", 0.55)}, 0 0 0 ${2 * u}px ${rgba("#FFFFFF", 0.08)}`,
      }}
    >
      {type === "browser" && (
        <div style={{ height: 64 * u, display: "flex", alignItems: "center", gap: 12 * u, padding: `0 ${24 * u}px`, background: "#1B1D22", borderRadius: `${24 * u}px ${24 * u}px 0 0` }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
            <div key={c} style={{ width: 16 * u, height: 16 * u, borderRadius: "50%", background: c }} />
          ))}
          <div style={{ flex: 1, marginLeft: 20 * u, height: 32 * u, borderRadius: 10 * u, background: "#2A2D34", color: "#9CA3AF", fontSize: 18 * u, display: "flex", alignItems: "center", padding: `0 ${16 * u}px`, fontFamily: t.body }}>
            {t.style.id === "product-demo" ? "app" : "www"}
          </div>
        </div>
      )}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: type === "phone" ? "100%" : `calc(100% - ${64 * u}px)`,
          borderRadius: type === "phone" ? 56 * u : `0 0 ${24 * u}px ${24 * u}px`,
          overflow: "hidden",
          background: t.bg,
        }}
      >
        {children}
        {type === "phone" && (
          <div style={{ position: "absolute", top: 18 * u, left: "50%", width: 150 * u, height: 40 * u, marginLeft: -75 * u, borderRadius: 999, background: "#0A0A0C" }} />
        )}
      </div>
    </div>
  );
}

function Screen({ src, variant }: { src?: string | null; variant: "app" | "web" }) {
  const frame = useCurrentFrame();
  if (!src) return <SkeletonUI variant={variant} />;
  const scroll = interpolate(frame, [20, 120], [0, -8], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", transform: `translateY(${scroll}%) scale(1.02)` }} />;
}

export function PhoneMockup({ src, children, delay = 0, tilt = -12, width }: { src?: string | null; children?: ReactNode; delay?: number; tilt?: number; width?: number }) {
  return (
    <DeviceFrame type="phone" delay={delay} tilt={tilt} width={width}>
      {children ?? <Screen src={src} variant="app" />}
    </DeviceFrame>
  );
}

export function BrowserMockup({ src, children, delay = 0, width }: { src?: string | null; children?: ReactNode; delay?: number; width?: number }) {
  return (
    <DeviceFrame type="browser" delay={delay} tilt={0} width={width} float={false}>
      {children ?? <Screen src={src} variant="web" />}
    </DeviceFrame>
  );
}

/** Dashboard UI with KPI tiles and an animated chart. Values are decorative UI, not claims. */
export function DashboardMockup({ values, labels, title, delay = 0 }: { values: number[]; labels?: string[]; title?: string; delay?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const w = t.layout.safe.width;
  const p = enter(frame, fps, delay);
  return (
    <div
      style={{
        width: w,
        borderRadius: 32 * u,
        padding: 36 * u,
        background: rgba(mix(t.bg, "#FFFFFF", 0.06), 0.92),
        border: `1px solid ${rgba(t.fg, 0.1)}`,
        boxShadow: `0 ${40 * u}px ${100 * u}px ${rgba("#000", 0.45)}`,
        transform: `translateY(${(1 - p) * 120 * u}px)`,
        opacity: p,
        display: "flex",
        flexDirection: "column",
        gap: 28 * u,
        fontFamily: t.body,
        color: t.fg,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 34 * u, fontWeight: 700 }}>{title ?? "Dashboard"}</div>
        <div style={{ padding: `${8 * u}px ${18 * u}px`, borderRadius: 999, background: rgba(t.success, 0.16), color: t.success, fontSize: 22 * u, fontWeight: 700 }}>● live</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 * u }}>
        {[0, 1].map((i) => (
          <div key={i} style={{ padding: 24 * u, borderRadius: 22 * u, background: rgba(t.fg, 0.05) }}>
            <div style={{ height: 14 * u, width: "50%", borderRadius: 8 * u, background: rgba(t.fg, 0.14) }} />
            <div style={{ marginTop: 16 * u, height: 40 * u, width: `${40 + i * 20}%`, borderRadius: 10 * u, background: i === 0 ? t.primary : t.accent, transform: `scaleX(${progress(frame, delay + 10, delay + 40)})`, transformOrigin: "left" }} />
          </div>
        ))}
      </div>
      <AnimatedChart type="bar" values={values} labels={labels} delay={delay + 12} height={360 * u} />
    </div>
  );
}

/** Mouse cursor moving along waypoints with a click ripple. */
export function CursorAnimation({ points, clickAt }: { points: { x: number; y: number; at: number }[]; clickAt?: number }) {
  const frame = useCurrentFrame();
  const t = useTheme();
  const u = t.layout.unit;
  if (points.length === 0) return null;
  const frames = points.map((p) => p.at);
  const x = interpolate(frame, frames.length > 1 ? frames : [0, 1], points.length > 1 ? points.map((p) => p.x) : [points[0]!.x, points[0]!.x], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(frame, frames.length > 1 ? frames : [0, 1], points.length > 1 ? points.map((p) => p.y) : [points[0]!.y, points[0]!.y], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const click = clickAt != null ? progress(frame, clickAt, clickAt + 14) : 0;
  const pressed = clickAt != null && frame >= clickAt && frame < clickAt + 6;
  return (
    <div style={{ position: "absolute", left: x, top: y, pointerEvents: "none", zIndex: 20 }}>
      {clickAt != null && frame >= clickAt && (
        <div
          style={{
            position: "absolute",
            left: -40 * u * click,
            top: -40 * u * click,
            width: 80 * u * click,
            height: 80 * u * click,
            borderRadius: "50%",
            border: `${4 * u}px solid ${rgba(t.primary, 1 - click)}`,
          }}
        />
      )}
      <svg width={54 * u} height={54 * u} viewBox="0 0 24 24" style={{ transform: `scale(${pressed ? 0.85 : 1})`, filter: `drop-shadow(0 ${4 * u}px ${8 * u}px rgba(0,0,0,0.5))` }}>
        <path d="M4 2l16 9-7 2-3 7z" fill="#FFFFFF" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** iOS-style notification sliding in. */
export function NotificationPopup({ app, title, body, delay = 0, width }: { app: string; title: string; body: string; delay?: number; width?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const p = enter(frame, fps, delay, "snappy");
  return (
    <div
      style={{
        width: width ?? t.layout.safe.width * 0.9,
        padding: `${24 * u}px ${28 * u}px`,
        borderRadius: 34 * u,
        background: rgba("#F5F5F7", 0.92),
        color: "#111",
        display: "flex",
        gap: 20 * u,
        alignItems: "center",
        boxShadow: `0 ${24 * u}px ${60 * u}px rgba(0,0,0,0.35)`,
        transform: `translateY(${(1 - p) * -140 * u}px) scale(${0.9 + p * 0.1})`,
        opacity: p,
        fontFamily: t.body,
      }}
    >
      <div style={{ width: 72 * u, height: 72 * u, borderRadius: 18 * u, background: `linear-gradient(135deg, ${t.primary}, ${t.secondary})`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: t.onPrimary, fontWeight: 800, fontSize: 34 * u }}>
        {app.slice(0, 1).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22 * u, color: "#6B7280", fontWeight: 600 }}>
          <span>{app.toUpperCase()}</span>
          <span>agora</span>
        </div>
        <div style={{ fontSize: 30 * u, fontWeight: 700, marginTop: 4 * u }}>{title}</div>
        <div style={{ fontSize: 26 * u, color: "#374151", marginTop: 2 * u, lineHeight: 1.25 }}>{body}</div>
      </div>
    </div>
  );
}
