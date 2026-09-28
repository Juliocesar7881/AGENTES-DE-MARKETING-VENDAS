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
import { placeScenes, placementVisual, planCaptions, type ScenePlacement } from "./transitions";

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

/** Scene placements with the transition choreography (see transitions.ts). */
export function computePlacements(spec: VideoSpec, fps: number, totalFrames: number, defaultTransition: TransitionKind): ScenePlacement<Scene>[] {
  return placeScenes(spec.scenes, spec.transitions, fps, totalFrames, defaultTransition);
}

function ScenePlacementLayer({ pl, spec }: { pl: ScenePlacement<Scene>; spec: VideoSpec }) {
  const frame = useCurrentFrame();
  const t = useTheme();
  const v = placementVisual(pl, frame, t.layout.unit);
  const style: CSSProperties = v ? { opacity: v.opacity, transform: v.transform, filter: v.filter, clipPath: v.clipPath } : {};
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
  // Subtitles never repeat the sentence already on screen and do not blink between phrases.
  const captions = useMemo(() => planCaptions(spec.captions, spec.scenes), [spec]);
  const showChip = spec.metadata.captionStyle !== "none";
  return (
    <ThemeContext.Provider value={theme}>
      <AssetsContext.Provider value={assets}>
        <AbsoluteFill style={{ background: theme.bg, overflow: "hidden" }}>
          <GradientBackground />
          <DecorLayer />
          {placements.map((pl) => (
            <Sequence key={pl.scene.id} from={pl.from} durationInFrames={pl.duration} layout="none" name={`${pl.index + 1}. ${pl.scene.type}`}>
              <ScenePlacementLayer pl={pl} spec={spec} />
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
