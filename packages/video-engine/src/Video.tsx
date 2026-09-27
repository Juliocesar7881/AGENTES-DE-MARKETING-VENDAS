import { useMemo, type CSSProperties } from "react";
import { AbsoluteFill, Html5Audio, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene, TransitionKind, VideoSpec } from "@revenueos/shared/video-spec";
import { DecorLayer, GradientBackground, Grain } from "./components/backgrounds";
import { ProgressBar } from "./components/cards";
import { AssetsContext, ThemeContext, useAssetUrl, useTheme } from "./components/context";
import { AnimatedSubtitle } from "./components/text";
import { ensureFonts } from "./fonts";
import { SceneLayer } from "./scenes/SceneRenderer";
import { buildTheme } from "./theme";
import { EASE_IN_OUT } from "./utils";

export interface RevenueOSVideoProps {
  spec: VideoSpec;
  /** asset id → URL resolved for this render/preview (signed URL, local server, data URL). */
  assets?: Record<string, string>;
  /** Where the bundled .woff2 files are served from (Remotion: staticFile("fonts"), web: /video-fonts). */
  fontBaseUrl?: string;
  /** Hide the caption band (e.g. for thumbnails). */
  hideCaptions?: boolean;
  [key: string]: unknown;
}

interface Placement {
  scene: Scene;
  index: number;
  from: number;
  duration: number;
  inFrames: number;
  outFrames: number;
  inType: TransitionKind;
  outType: TransitionKind;
}

export function computePlacements(spec: VideoSpec, fps: number, totalFrames: number, defaultTransition: TransitionKind): Placement[] {
  const byAfter = new Map(spec.transitions.map((t) => [t.afterScene, t]));
  return spec.scenes.map((scene, i) => {
    const start = Math.round(scene.start * fps);
    const end = i === spec.scenes.length - 1 ? totalFrames : Math.round((scene.start + scene.duration) * fps);
    const tin = i > 0 ? (byAfter.get(i - 1) ?? { type: defaultTransition, durationSec: 0.35 }) : null;
    const tout = i < spec.scenes.length - 1 ? (byAfter.get(i) ?? { type: defaultTransition, durationSec: 0.35 }) : null;
    const half = (d: number) => Math.max(0, Math.round((d * fps) / 2));
    const inFrames = tin && tin.type !== "none" ? half(tin.durationSec) : 0;
    const outFrames = tout && tout.type !== "none" ? half(tout.durationSec) : 0;
    return {
      scene,
      index: i,
      from: Math.max(0, start - inFrames),
      duration: Math.max(1, end - start + inFrames + outFrames),
      inFrames,
      outFrames,
      inType: tin?.type ?? "none",
      outType: tout?.type ?? "none",
    };
  });
}

function transitionStyle(kind: TransitionKind, p: number, dir: "in" | "out", unit: number): CSSProperties {
  // p: 0 → start of transition window, 1 → end
  const k = dir === "in" ? p : 1 - p; // visibility 0..1
  switch (kind) {
    case "fade":
      return { opacity: k };
    case "slide-up":
      return { transform: `translateY(${(dir === "in" ? 1 - p : -p) * 18}%)`, opacity: Math.min(1, k * 1.4) };
    case "slide-left":
      return { transform: `translateX(${(dir === "in" ? 1 - p : -p) * 22}%)`, opacity: Math.min(1, k * 1.4) };
    case "wipe":
      return dir === "in" ? { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` } : {};
    case "zoom":
      return { transform: `scale(${dir === "in" ? 0.85 + 0.15 * p : 1 + 0.25 * p})`, opacity: k };
    case "blur":
      return { filter: `blur(${(1 - k) * 24 * unit}px)`, opacity: k };
    case "none":
    default:
      return {};
  }
}

function ScenePlacement({ pl, spec }: { pl: Placement; spec: VideoSpec }) {
  const frame = useCurrentFrame();
  const t = useTheme();
  const inWindow = pl.inFrames * 2;
  const outWindow = pl.outFrames * 2;
  let style: CSSProperties = {};
  if (inWindow > 0 && frame < inWindow) {
    const p = interpolate(frame, [0, inWindow], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
    style = transitionStyle(pl.inType, p, "in", t.layout.unit);
  } else if (outWindow > 0 && frame > pl.duration - outWindow) {
    const p = interpolate(frame, [pl.duration - outWindow, pl.duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IN_OUT });
    style = transitionStyle(pl.outType, p, "out", t.layout.unit);
  }
  return (
    <AbsoluteFill style={style}>
      <SceneLayer scene={pl.scene} spec={spec} index={pl.index} />
    </AbsoluteFill>
  );
}

function BrandChip({ spec }: { spec: VideoSpec }) {
  const frame = useCurrentFrame();
  const t = useTheme();
  const u = t.layout.unit;
  const logo = useAssetUrl(spec.brand.logoAssetId);
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top: t.layout.format === "9:16" ? 120 * u : 36 * u, left: t.layout.safe.left, display: "flex", alignItems: "center", gap: 14 * u, opacity, padding: `${8 * u}px ${20 * u}px ${8 * u}px ${10 * u}px`, borderRadius: 999, background: "rgba(8, 10, 14, 0.38)", backdropFilter: "blur(8px)" }}>
      {logo ? (
        <img src={logo} alt="" style={{ height: 56 * u, width: 56 * u, objectFit: "contain", borderRadius: 14 * u }} />
      ) : (
        <div style={{ width: 16 * u, height: 16 * u, borderRadius: "50%", background: t.primary }} />
      )}
      <span style={{ fontFamily: t.body, fontWeight: 700, fontSize: 30 * u, color: "rgba(255,255,255,0.92)" }}>{spec.brand.handle ? `@${spec.brand.handle.replace(/^@/, "")}` : spec.brand.name}</span>
    </div>
  );
}

function Soundtrack({ spec, assets }: { spec: VideoSpec; assets: Record<string, string> }) {
  const src = spec.soundtrack?.assetId ? assets[spec.soundtrack.assetId] : spec.soundtrack?.generated ? assets.__soundtrack : undefined;
  const { durationInFrames } = useVideoConfig();
  if (!src || !spec.soundtrack) return null;
  const volume = spec.soundtrack.volume;
  return (
    <Html5Audio
      src={src}
      volume={(f) => interpolate(f, [0, 15, durationInFrames - 20, durationInFrames], [0, volume, volume, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
    />
  );
}

/** The single Remotion composition that renders every template from a VideoSpec. */
export function RevenueOSVideo(props: RevenueOSVideoProps) {
  const { spec, assets = {}, fontBaseUrl = "/video-fonts", hideCaptions = false } = props;
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const theme = useMemo(() => buildTheme(spec, width, height), [spec, width, height]);
  ensureFonts([theme.headingFont, theme.bodyFont, "Inter"], fontBaseUrl);
  const placements = useMemo(() => computePlacements(spec, fps, durationInFrames, theme.style.transition), [spec, fps, durationInFrames, theme.style.transition]);
  const captions = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return spec.captions.filter((c) => {
      const scene = spec.scenes.find((s) => c.start >= s.start - 0.05 && c.start < s.start + s.duration);
      return !scene?.headline || norm(scene.headline) !== norm(c.text);
    });
  }, [spec]);
  const showChip = spec.metadata.captionStyle !== "none";
  return (
    <ThemeContext.Provider value={theme}>
      <AssetsContext.Provider value={assets}>
        <AbsoluteFill style={{ background: theme.bg, overflow: "hidden" }}>
          <GradientBackground />
          <DecorLayer />
          {placements.map((pl) => (
            <Sequence key={pl.scene.id} from={pl.from} durationInFrames={pl.duration} layout="none" name={`${pl.index + 1}. ${pl.scene.type}`}>
              <ScenePlacement pl={pl} spec={spec} />
            </Sequence>
          ))}
          {theme.style.grain && <Grain opacity={0.06} />}
          {theme.style.progressBar && <ProgressBar />}
          {showChip && <BrandChip spec={spec} />}
          {!hideCaptions && spec.metadata.captionStyle !== "none" && captions.length > 0 && <AnimatedSubtitle captions={captions} />}
          <Soundtrack spec={spec} assets={assets} />
        </AbsoluteFill>
      </AssetsContext.Provider>
    </ThemeContext.Provider>
  );
}
