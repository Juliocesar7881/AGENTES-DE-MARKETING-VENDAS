import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import {
  ArrowRight,
  Baby,
  CalendarCheck,
  Car,
  CheckCircle2,
  Clock,
  GraduationCap,
  Heart,
  HeartPulse,
  MessageCircle,
  Rocket,
  ShieldCheck,
  Smile,
  Sparkles,
  Star,
  TrendingUp,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { deriveTheme } from "../theme";
import { contrastRatio, enter, fitFontSize, luminance, mix, progress, rgba } from "../utils";
import { ThemeContext, useTheme } from "./context";

const ICON_RULES: [RegExp, LucideIcon][] = [
  [/segur|proteg|garant|confi/i, ShieldCheck],
  [/rápid|rapid|agil|ágil|instant|tempo/i, Zap],
  [/hora|agenda|horári|prazo/i, Clock],
  [/preç|econom|parcel|pag|valor|dinheiro|financ/i, Wallet],
  [/dente|sorriso|odont|clarea/i, Smile],
  [/saúde|saude|cuidad|bem-estar/i, HeartPulse],
  [/carro|veícul|veicul|seminov|test.?drive|km/i, Car],
  [/criança|crianca|bebê|bebe|filho|infantil/i, Baby],
  [/escola|aprend|pedag|educa|aula|curso/i, GraduationCap],
  [/whats|mensag|convers|atendim/i, MessageCircle],
  [/agend|visita|consulta|reserv/i, CalendarCheck],
  [/cresc|result|venda|lucro|aument/i, TrendingUp],
  [/amor|carinh|afet|família|familia/i, Heart],
  [/lanç|lanc|novo|nova/i, Rocket],
];

export function pickIcon(text: string, index = 0): LucideIcon {
  for (const [re, icon] of ICON_RULES) if (re.test(text)) return icon;
  return [Sparkles, CheckCircle2, Star, Zap][index % 4]!;
}

export function FloatingCard({ children, delay = 0, style, float = true }: { children: ReactNode; delay?: number; style?: CSSProperties; float?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const p = enter(frame, fps, delay, t.style.motion);
  const glass = t.style.surface === "glass" && contrastRatio(t.canvas, t.fg) >= 4.5 && luminance(t.canvas) < 0.35;
  const outline = t.style.surface === "outline" && luminance(t.canvas) < 0.35;
  const surfaceColor = outline ? t.canvas : glass ? mix(t.canvas, t.fg, 0.07) : t.surface;
  const inner = deriveTheme(t, surfaceColor);
  return (
    <ThemeContext.Provider value={inner}>
    <div
      style={{
        borderRadius: t.style.radius * u,
        padding: 44 * u,
        background: outline ? "transparent" : glass ? rgba(t.fg, 0.07) : t.surface,
        border: `${outline ? 2 : 1}px solid ${rgba(t.fg, outline ? 0.35 : 0.12)}`,
        backdropFilter: glass ? "blur(20px)" : undefined,
        boxShadow: outline ? undefined : `0 ${30 * u}px ${80 * u}px ${rgba("#000", 0.35)}`,
        transform: `translateY(${(1 - p) * 90 * u + (float ? Math.sin((frame + delay) / 26) * 6 * u : 0)}px) scale(${0.94 + p * 0.06})`,
        opacity: p,
        ...style,
      }}
    >
      {children}
    </div>
    </ThemeContext.Provider>
  );
}

function FeatureCardBody({ title, body, delay, index, icon }: { title: string; body?: string; delay: number; index: number; icon?: LucideIcon }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const Icon = icon ?? pickIcon(`${title} ${body ?? ""}`, index);
  const iconP = enter(frame, fps, delay + 6, "snappy");
  const width = t.layout.safe.width;
  const titleFit = fitFontSize(title, width - 260 * u, 3, Math.round(72 * u), Math.round(38 * u));
  return (
    <div style={{ display: "flex", gap: 36 * u, alignItems: "flex-start" }}>
      <div
        style={{
          width: 128 * u,
          height: 128 * u,
          flexShrink: 0,
          borderRadius: 32 * u,
          background: `linear-gradient(135deg, ${t.primary}, ${t.secondary})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${iconP}) rotate(${(1 - iconP) * -30}deg)`,
          boxShadow: `0 ${16 * u}px ${40 * u}px ${rgba(t.primary, 0.45)}`,
        }}
      >
        <Icon size={64 * u} color={t.onPrimary} strokeWidth={2.2} />
      </div>
      <div style={{ flex: 1, fontFamily: t.body, color: t.fg }}>
        <div style={{ fontFamily: t.heading, fontWeight: 800, fontSize: titleFit.size, lineHeight: 1.1, letterSpacing: "-0.02em" }}>{title}</div>
        {body && <div style={{ marginTop: 14 * u, fontSize: 38 * u, lineHeight: 1.35, color: t.muted, opacity: progress(frame, delay + 10, delay + 26) }}>{body}</div>}
      </div>
    </div>
  );
}

export function FeatureCard({ title, body, delay = 0, index = 0, icon }: { title: string; body?: string; delay?: number; index?: number; icon?: LucideIcon }) {
  const t = useTheme();
  return (
    <FloatingCard delay={delay} style={{ width: t.layout.safe.width }}>
      <FeatureCardBody title={title} body={body} delay={delay} index={index} icon={icon} />
    </FloatingCard>
  );
}

function TestimonialBody({ quote, author, role, rating, delay }: { quote: string; author: string; role?: string; rating?: number; delay: number }) {
  const frame = useCurrentFrame();
  const t = useTheme();
  const u = t.layout.unit;
  const fit = fitFontSize(`“${quote}”`, t.layout.safe.width - 100 * u, 6, Math.round(58 * u), Math.round(34 * u));
  return (
    <>
      {rating != null && (
        <div style={{ display: "flex", gap: 8 * u, marginBottom: 26 * u }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} size={46 * u} color={t.emphasis} fill={i < Math.round(rating) ? t.emphasis : "transparent"} style={{ opacity: progress(frame, delay + 8 + i * 3, delay + 16 + i * 3), transform: `scale(${0.6 + 0.4 * progress(frame, delay + 8 + i * 3, delay + 16 + i * 3)})` }} />
          ))}
        </div>
      )}
      <div style={{ fontFamily: t.heading, fontSize: fit.size, lineHeight: 1.25, color: t.fg, fontWeight: 600 }}>“{quote}”</div>
      <div style={{ marginTop: 30 * u, display: "flex", alignItems: "center", gap: 18 * u, fontFamily: t.body }}>
        <div style={{ width: 70 * u, height: 70 * u, borderRadius: "50%", background: `linear-gradient(135deg, ${t.primary}, ${t.accent})`, display: "flex", alignItems: "center", justifyContent: "center", color: t.onPrimary, fontWeight: 800, fontSize: 30 * u }}>
          {author.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div style={{ color: t.fg, fontWeight: 700, fontSize: 32 * u }}>{author}</div>
          {role && <div style={{ color: t.muted, fontSize: 26 * u }}>{role}</div>}
        </div>
      </div>
    </>
  );
}

export function TestimonialCard({ quote, author, role, rating, delay = 0 }: { quote: string; author: string; role?: string; rating?: number; delay?: number }) {
  const t = useTheme();
  return (
    <FloatingCard delay={delay} style={{ width: t.layout.safe.width }}>
      <TestimonialBody quote={quote} author={author} role={role} rating={rating} delay={delay} />
    </FloatingCard>
  );
}

export function CTAButton({ label, sub, delay = 0, pulse = true }: { label: string; sub?: string; delay?: number; pulse?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const p = enter(frame, fps, delay, "snappy");
  const beat = pulse ? 1 + Math.max(0, Math.sin((frame - delay) / 7)) * 0.035 : 1;
  const fit = fitFontSize(label, t.layout.safe.width - 220 * u, 1, Math.round(56 * u), Math.round(32 * u));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 * u, transform: `scale(${(0.7 + p * 0.3) * beat})`, opacity: p }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20 * u,
          padding: `${34 * u}px ${56 * u}px`,
          borderRadius: 999,
          background: t.ctaBg,
          color: t.ctaFg,
          fontFamily: t.heading,
          fontWeight: 800,
          fontSize: fit.size,
          boxShadow: `0 0 0 ${10 * u * (beat - 1) * 20}px ${rgba(t.ctaBg, 0.18)}, 0 ${24 * u}px ${60 * u}px ${rgba(t.ctaBg, 0.45)}`,
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <ArrowRight size={fit.size * 1.05} strokeWidth={3} style={{ transform: `translateX(${Math.sin(frame / 6) * 6 * u}px)` }} />
      </div>
      {sub && <div style={{ fontFamily: t.body, color: t.fg, opacity: 0.85, fontSize: 36 * u, fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

export function LogoReveal({ src, name, delay = 0, size }: { src?: string | null; name: string; delay?: number; size?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const s = size ?? 260 * u;
  const p = enter(frame, fps, delay, "smooth");
  const ring = progress(frame, delay, delay + 30);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30 * u }}>
      <div style={{ position: "relative", width: s, height: s, transform: `scale(${0.6 + p * 0.4})`, opacity: p }}>
        <svg width={s} height={s} style={{ position: "absolute", inset: 0 }}>
          <circle cx={s / 2} cy={s / 2} r={s / 2 - 4 * u} fill="none" stroke={t.primary} strokeWidth={6 * u} strokeDasharray={Math.PI * (s - 8 * u)} strokeDashoffset={Math.PI * (s - 8 * u) * (1 - ring)} strokeLinecap="round" transform={`rotate(-90 ${s / 2} ${s / 2})`} />
        </svg>
        <div style={{ position: "absolute", inset: 20 * u, borderRadius: "50%", overflow: "hidden", background: t.surface, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {src ? (
            <Img src={src} style={{ width: "80%", height: "80%", objectFit: "contain" }} />
          ) : (
            <span style={{ fontFamily: t.heading, fontWeight: 800, fontSize: s * 0.36, color: t.primary }}>
              {name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase())
                .join("")}
            </span>
          )}
        </div>
      </div>
      <div style={{ fontFamily: t.heading, fontWeight: 800, fontSize: 64 * u, color: t.fg, letterSpacing: "-0.02em", opacity: progress(frame, delay + 12, delay + 28) }}>{name}</div>
    </div>
  );
}

export function StatCounter({ value, prefix = "", suffix = "", decimals = 0, label, delay = 0, size }: { value: number; prefix?: string; suffix?: string; decimals?: number; label?: string; delay?: number; size?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const p = progress(frame, delay, delay + Math.round(fps * 1.1));
  const shown = value * p;
  const formatted = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(shown);
  const text = `${prefix}${formatted}${suffix}`.replace(/ /g, "\u00A0");
  const fit = fitFontSize(`${prefix}${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)}${suffix}`, t.layout.safe.width, 1, size ?? Math.round(210 * u), Math.round(80 * u));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 * u }}>
      <div style={{ fontFamily: t.heading, fontWeight: 800, fontSize: fit.size, color: t.emphasis, whiteSpace: "nowrap", letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums", textShadow: t.style.accent === "glow" ? `0 0 ${60 * u}px ${rgba(t.emphasis, 0.55)}` : undefined }}>{text}</div>
      {label && <div style={{ fontFamily: t.body, fontSize: 40 * u, color: t.fg, fontWeight: 600, opacity: progress(frame, delay + 10, delay + 24), textAlign: "center" }}>{label}</div>}
    </div>
  );
}

export function AnimatedChart({ type, values, labels, delay = 0, height, width }: { type: "bar" | "line"; values: number[]; labels?: string[]; delay?: number; height?: number; width?: number }) {
  const frame = useCurrentFrame();
  const t = useTheme();
  const u = t.layout.unit;
  const w = width ?? t.layout.safe.width - 72 * u;
  const h = height ?? 420 * u;
  const max = Math.max(...values, 1);
  if (type === "line") {
    const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - (v / max) * (h - 30 * u)] as const);
    const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const len = pts.reduce((acc, [x, y], i) => (i === 0 ? 0 : acc + Math.hypot(x - pts[i - 1]![0], y - pts[i - 1]![1])), 0);
    const p = progress(frame, delay, delay + 40);
    return (
      <svg width={w} height={h}>
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.primary} stopOpacity={0.4} />
            <stop offset="100%" stopColor={t.primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={`${d} L${w},${h} L0,${h} Z`} fill="url(#area)" opacity={p} />
        <path d={d} fill="none" stroke={t.primary} strokeWidth={8 * u} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - p)} />
      </svg>
    );
  }
  const gap = 18 * u;
  const barW = (w - gap * (values.length - 1)) / values.length;
  return (
    <div style={{ width: w, height: h + (labels ? 44 * u : 0), display: "flex", alignItems: "flex-end", gap }}>
      {values.map((v, i) => {
        const p = progress(frame, delay + i * 4, delay + i * 4 + 22);
        return (
          <div key={i} style={{ width: barW, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 * u }}>
            <div style={{ width: "100%", height: (v / max) * h * p, borderRadius: `${14 * u}px ${14 * u}px ${6 * u}px ${6 * u}px`, background: i === values.length - 1 ? `linear-gradient(180deg, ${t.accent}, ${t.primary})` : rgba(t.primary, 0.55) }} />
            {labels?.[i] && <div style={{ fontFamily: t.body, fontSize: 22 * u, color: t.muted }}>{labels[i]}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function ProgressBar({ color }: { color?: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  return (
    <div style={{ position: "absolute", top: t.layout.format === "9:16" ? 200 * u : 30 * u, left: t.layout.safe.left, right: t.layout.width - t.layout.safe.right, height: 10 * u, borderRadius: 999, background: rgba(t.fg, 0.15), overflow: "hidden" }}>
      <div style={{ width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`, height: "100%", borderRadius: 999, background: color ?? t.primary }} />
    </div>
  );
}

export function IconBurst({ count = 14, delay = 0, color, radius }: { count?: number; delay?: number; color?: string; radius?: number }) {
  const frame = useCurrentFrame();
  const t = useTheme();
  const u = t.layout.unit;
  const p = progress(frame, delay, delay + 26);
  const r = (radius ?? 420) * u;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      {Array.from({ length: count }).map((_, i) => {
        const angle = (i / count) * Math.PI * 2 + random(`burst${i}`) * 0.4;
        const dist = r * (0.6 + random(`bd${i}`) * 0.4) * p;
        const size = (10 + random(`bs${i}`) * 18) * u;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: size,
              height: i % 3 === 0 ? size * 3 : size,
              borderRadius: i % 3 === 0 ? size : "50%",
              background: i % 2 === 0 ? (color ?? t.accent) : t.primary,
              transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) rotate(${(angle * 180) / Math.PI + 90}deg)`,
              opacity: 1 - p * 0.85,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

export function Confetti({ count = 60, delay = 0 }: { count?: number; delay?: number }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = useTheme();
  const colors = [t.primary, t.secondary, t.accent, "#FFFFFF"];
  const f = Math.max(0, frame - delay);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: count }).map((_, i) => {
        const x0 = random(`cx${i}`) * width;
        const vy = 6 + random(`cv${i}`) * 10;
        const y = -60 + f * vy * t.layout.unit;
        if (y > height) return null;
        const sway = Math.sin(f / 8 + i) * 30;
        const s = (12 + random(`cs${i}`) * 14) * t.layout.unit;
        return <div key={i} style={{ position: "absolute", left: x0 + sway, top: y, width: s, height: s * 0.5, background: colors[i % colors.length], transform: `rotate(${f * (4 + (i % 5))}deg)`, borderRadius: 2 }} />;
      })}
    </AbsoluteFill>
  );
}

export function ImageReveal({ src, delay = 0, mode = "wipe", style }: { src: string; delay?: number; mode?: "wipe" | "zoom"; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const t = useTheme();
  const p = progress(frame, delay, delay + 22);
  const kenBurns = 1.04 + (frame / 300) * 0.08;
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: t.style.radius * t.layout.unit, clipPath: mode === "wipe" ? `inset(0 ${(1 - p) * 100}% 0 0 round ${t.style.radius * t.layout.unit}px)` : undefined, opacity: mode === "zoom" ? p : 1, ...style }}>
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${mode === "zoom" ? 1.25 - p * 0.2 : kenBurns})` }} />
    </div>
  );
}

export function SplitScreen({ left, right, delay = 0 }: { left: ReactNode; right: ReactNode; delay?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const vertical = t.layout.format === "9:16";
  const p = enter(frame, fps, delay);
  return (
    <div style={{ width: t.layout.safe.width, height: vertical ? t.layout.safe.height * 0.8 : t.layout.safe.height * 0.8, display: "flex", flexDirection: vertical ? "column" : "row", gap: 24 * t.layout.unit }}>
      <div style={{ flex: 1, transform: vertical ? `translateY(${(1 - p) * -80}px)` : `translateX(${(1 - p) * -80}px)`, opacity: p, position: "relative" }}>{left}</div>
      <div style={{ flex: 1, transform: vertical ? `translateY(${(1 - p) * 80}px)` : `translateX(${(1 - p) * 80}px)`, opacity: p, position: "relative" }}>{right}</div>
    </div>
  );
}

function Panel({ label, text, src, tone }: { label: string; text: string; src?: string | null; tone: "before" | "after" }) {
  const t = useTheme();
  const u = t.layout.unit;
  const color = tone === "before" ? t.danger : t.success;
  return (
    <div style={{ position: "absolute", inset: 0, background: tone === "before" ? mix(t.bg, "#000000", 0.35) : mix(t.bg, t.primary, 0.25), display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 48 * u, overflow: "hidden" }}>
      {src && <Img src={src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: tone === "before" ? "grayscale(0.8) brightness(0.7)" : undefined }} />}
      <div style={{ position: "relative", alignSelf: "flex-start", padding: `${10 * u}px ${24 * u}px`, borderRadius: 999, background: color, color: "#0B0F14", fontFamily: t.body, fontWeight: 800, fontSize: 30 * u, textTransform: "uppercase" }}>{label}</div>
      <div style={{ position: "relative", marginTop: 20 * u, fontFamily: t.heading, fontWeight: 800, fontSize: 54 * u, lineHeight: 1.12, color: "#FFFFFF", textShadow: "0 4px 24px rgba(0,0,0,0.6)" }}>{text}</div>
    </div>
  );
}

/** Divider sweeps across revealing the "after" state. */
export function BeforeAfterSlider({ beforeLabel, afterLabel, beforeText, afterText, beforeSrc, afterSrc, delay = 0 }: { beforeLabel: string; afterLabel: string; beforeText: string; afterText: string; beforeSrc?: string | null; afterSrc?: string | null; delay?: number }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const sweep = interpolate(frame, [delay + 12, Math.max(delay + 24, Math.min(durationInFrames - 10, delay + 60))], [100, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const w = t.layout.safe.width;
  const h = t.layout.format === "9:16" ? t.layout.safe.height * 0.78 : t.layout.safe.height * 0.85;
  return (
    <div style={{ position: "relative", width: w, height: h, borderRadius: t.style.radius * u, overflow: "hidden", boxShadow: `0 ${30 * u}px ${80 * u}px rgba(0,0,0,0.45)` }}>
      <Panel label={afterLabel} text={afterText} src={afterSrc} tone="after" />
      <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${100 - sweep}% 0 0)` }}>
        <Panel label={beforeLabel} text={beforeText} src={beforeSrc} tone="before" />
      </div>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: `${sweep}%`, width: 6 * u, marginLeft: -3 * u, background: "#FFFFFF", boxShadow: "0 0 30px rgba(255,255,255,0.8)" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", width: 84 * u, height: 84 * u, marginLeft: -42 * u, marginTop: -42 * u, borderRadius: "50%", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", color: "#111", fontSize: 36 * u, fontWeight: 800 }}>⇆</div>
      </div>
    </div>
  );
}
