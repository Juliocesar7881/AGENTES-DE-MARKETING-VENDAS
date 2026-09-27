import type { ReactNode } from "react";
import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene, VideoSpec } from "@revenueos/shared/video-spec";
import { GradientBackground, Grain, Letterbox, Particles, Spotlight } from "../components/backgrounds";
import {
  BeforeAfterSlider,
  Confetti,
  CTAButton,
  FeatureCard,
  FloatingCard,
  IconBurst,
  ImageReveal,
  LogoReveal,
  pickIcon,
  StatCounter,
  TestimonialCard,
} from "../components/cards";
import { ThemeContext, useAssetUrl, useTheme } from "../components/context";
import { deriveTheme, type Theme } from "../theme";
import { BrowserMockup, CursorAnimation, DashboardMockup, NotificationPopup, PhoneMockup } from "../components/devices";
import { AnimatedHeadline, KineticTypography } from "../components/text";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { enter, progress, rgba } from "../utils";

function Stack({ children, gap = 48, justify = "center" }: { children: ReactNode; gap?: number; justify?: "center" | "flex-start" | "flex-end" }) {
  const t = useTheme();
  const { safe } = t.layout;
  return (
    <div
      style={{
        position: "absolute",
        left: safe.left,
        top: safe.top,
        width: safe.width,
        height: safe.height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: justify,
        gap: gap * t.layout.unit,
      }}
    >
      {children}
    </div>
  );
}

function Body({ text, delay = 12, align = "center" }: { text?: string; delay?: number; align?: "center" | "left" }) {
  const frame = useCurrentFrame();
  const t = useTheme();
  if (!text) return null;
  const p = progress(frame, delay, delay + 16);
  return (
    <div style={{ fontFamily: t.body, fontSize: 42 * t.layout.unit, lineHeight: 1.35, color: t.muted, textAlign: align, maxWidth: t.layout.safe.width, opacity: p, transform: `translateY(${(1 - p) * 24 * t.layout.unit}px)` }}>
      {text}
    </div>
  );
}

function Badge({ kind }: { kind: "problem" | "warning" | "solution" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const p = enter(frame, fps, 0, "snappy");
  const color = kind === "solution" ? t.success : kind === "warning" ? "#FFB547" : t.danger;
  const Icon = kind === "solution" ? CheckCircle2 : kind === "warning" ? AlertTriangle : XCircle;
  return (
    <div style={{ width: 132 * u, height: 132 * u, borderRadius: "50%", background: rgba(color, 0.16), border: `${3 * u}px solid ${rgba(color, 0.5)}`, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${p}) rotate(${(1 - p) * -40}deg)`, boxShadow: `0 0 ${50 * u}px ${rgba(color, 0.35)}` }}>
      <Icon size={72 * u} color={color} strokeWidth={2.4} />
    </div>
  );
}

/** Per-scene background from the VideoSpec (on top of the template's global background). */
function SceneBackground({ scene }: { scene: Scene }) {
  const t = useTheme();
  const url = useAssetUrl(scene.background.assetId);
  const colors = scene.background.colors;
  switch (scene.background.type) {
    case "solid":
      return <AbsoluteFill style={{ background: colors?.[0] ?? t.bg }} />;
    case "image":
      return url ? (
        <AbsoluteFill>
          <Img src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <AbsoluteFill style={{ background: `linear-gradient(180deg, ${rgba(t.bg, 0.35)}, ${rgba(t.bg, 0.85)})` }} />
        </AbsoluteFill>
      ) : null;
    case "video":
      return url ? (
        <AbsoluteFill>
          <OffthreadVideo src={url} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <AbsoluteFill style={{ background: rgba(t.bg, 0.55) }} />
        </AbsoluteFill>
      ) : null;
    case "spotlight":
      return <Spotlight color={colors?.[0]} />;
    case "grid":
      return <GradientBackground variant="grid" colors={colors} />;
    case "noise":
      return (
        <>
          <AbsoluteFill style={{ background: colors?.[0] ?? t.bg }} />
          <Grain opacity={0.12} />
        </>
      );
    case "mesh":
      return <GradientBackground variant="mesh" colors={colors} />;
    case "gradient":
    default:
      return null; // template's global background already covers gradients
  }
}

function Effects({ scene }: { scene: Scene }) {
  const effects = scene.effects ?? [];
  return (
    <>
      {effects.includes("spotlight") && <Spotlight y={35} intensity={0.35} />}
      {effects.includes("particles") && <Particles seed={scene.id} count={18} />}
      {effects.includes("grain") && <Grain />}
      {effects.includes("confetti") && <Confetti delay={6} />}
    </>
  );
}

function HookScene({ scene, spec }: { scene: Scene; spec: VideoSpec }) {
  const t = useTheme();
  const text = scene.headline ?? spec.hook.text;
  const kinetic = scene.animation === "kinetic" || t.style.id === "fast-hook" || t.style.id === "bold-typography";
  return (
    <>
      {(t.style.decor === "burst" || scene.effects?.includes("highlight")) && <IconBurst delay={4} />}
      <Stack>
        {kinetic ? (
          <KineticTypography text={text} highlight={scene.emphasis?.[0]} />
        ) : (
          <AnimatedHeadline text={text} animation={scene.animation} emphasis={scene.emphasis} maxSize={128} maxLines={5} />
        )}
        <Body text={scene.body} delay={16} />
      </Stack>
    </>
  );
}

function ProblemScene({ scene }: { scene: Scene }) {
  const t = useTheme();
  return (
    <Stack>
      <Badge kind={scene.type === "AGITATION" ? "warning" : "problem"} />
      <AnimatedHeadline text={scene.headline ?? ""} animation={scene.animation} emphasis={scene.emphasis} emphasisColor={t.danger} />
      <Body text={scene.body} />
    </Stack>
  );
}

function SolutionScene({ scene }: { scene: Scene }) {
  const t = useTheme();
  const asset = useAssetUrl(scene.assets?.[0]);
  if (scene.layout === "phone" || scene.layout === "browser") {
    return (
      <Stack gap={40}>
        <AnimatedHeadline text={scene.headline ?? ""} animation={scene.animation} maxSize={96} maxLines={2} emphasis={scene.emphasis} />
        {scene.layout === "phone" ? <PhoneMockup src={asset} delay={8} width={t.layout.safe.width * 0.5} /> : <BrowserMockup src={asset} delay={8} />}
      </Stack>
    );
  }
  if (scene.layout === "split" && asset) {
    return (
      <Stack gap={40}>
        <ImageReveal src={asset} delay={4} style={{ width: t.layout.safe.width, height: t.layout.safe.height * 0.45 }} />
        <AnimatedHeadline text={scene.headline ?? ""} animation={scene.animation} maxSize={96} maxLines={3} emphasis={scene.emphasis} />
        <Body text={scene.body} />
      </Stack>
    );
  }
  return (
    <Stack>
      <Badge kind="solution" />
      <FloatingCard style={{ width: t.layout.safe.width }}>
        <AnimatedHeadline text={scene.headline ?? ""} animation={scene.animation} emphasis={scene.emphasis} width={t.layout.safe.width - 88 * t.layout.unit} />
        <div style={{ height: 24 * t.layout.unit }} />
        <Body text={scene.body} />
      </FloatingCard>
    </Stack>
  );
}

function FeatureScene({ scene, index }: { scene: Scene; index: number }) {
  const t = useTheme();
  if (scene.bullets?.length) {
    return (
      <Stack gap={28}>
        <AnimatedHeadline text={scene.headline ?? ""} animation={scene.animation} maxSize={92} maxLines={2} />
        {scene.bullets.map((b, i) => (
          <FeatureCard key={i} title={b} delay={8 + i * 8} index={i} />
        ))}
      </Stack>
    );
  }
  return (
    <Stack>
      <FeatureCard title={scene.headline ?? ""} body={scene.body} index={index} icon={pickIcon(`${scene.headline} ${scene.body ?? ""}`, index)} />
      {t.style.decor === "grid" && <div style={{ height: 1 }} />}
    </Stack>
  );
}

function DemoScene({ scene }: { scene: Scene }) {
  const t = useTheme();
  const { width, height } = useVideoConfig();
  const asset = useAssetUrl(scene.assets?.[0]);
  const phone = scene.layout === "phone";
  return (
    <>
      <Stack gap={36}>
        <AnimatedHeadline text={scene.headline ?? ""} animation={scene.animation} maxSize={88} maxLines={2} />
        {phone ? <PhoneMockup src={asset} delay={6} tilt={-8} width={t.layout.safe.width * 0.5} /> : <BrowserMockup src={asset} delay={6} />}
        <Body text={scene.body} delay={20} />
      </Stack>
      <CursorAnimation
        points={[
          { x: width * 0.8, y: height * 0.75, at: 10 },
          { x: width * 0.55, y: height * 0.52, at: 34 },
          { x: width * 0.42, y: height * 0.58, at: 56 },
        ]}
        clickAt={36}
      />
    </>
  );
}

function StatScene({ scene }: { scene: Scene }) {
  return (
    <Stack>
      {scene.stat ? <StatCounter value={scene.stat.value} prefix={scene.stat.prefix} suffix={scene.stat.suffix} decimals={scene.stat.decimals} label={scene.stat.label} /> : null}
      <AnimatedHeadline text={scene.headline ?? ""} animation={scene.animation} maxSize={80} maxLines={3} font="body" weight={700} />
      <Body text={scene.body} />
    </Stack>
  );
}

function TestimonialScene({ scene }: { scene: Scene }) {
  if (!scene.testimonial) return <QuoteScene scene={scene} />;
  return (
    <Stack>
      <TestimonialCard quote={scene.testimonial.quote} author={scene.testimonial.author} role={scene.testimonial.role} rating={scene.testimonial.rating} />
    </Stack>
  );
}

function QuoteScene({ scene }: { scene: Scene }) {
  const frame = useCurrentFrame();
  const t = useTheme();
  const u = t.layout.unit;
  return (
    <Stack>
      <div style={{ width: 120 * u, height: 4 * u, background: t.primary, transform: `scaleX(${progress(frame, 0, 20)})` }} />
      <AnimatedHeadline text={scene.headline ?? ""} animation={scene.animation === "none" ? "fade-up" : scene.animation} maxSize={92} maxLines={4} weight={600} />
      <Body text={scene.body} delay={14} />
    </Stack>
  );
}

function ListItemScene({ scene, spec, index }: { scene: Scene; spec: VideoSpec; index: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = useTheme();
  const u = t.layout.unit;
  const listScenes = spec.scenes.filter((s) => s.type === "LIST_ITEM");
  const pos = listScenes.findIndex((s) => s.id === scene.id);
  const num = pos >= 0 ? pos + 1 : index;
  const match = scene.headline?.match(/^(\d+)[.)]\s*(.*)$/);
  const title = match ? match[2]! : (scene.headline ?? "");
  const p = enter(frame, fps, 0, "snappy");
  return (
    <Stack gap={36}>
      <div style={{ fontFamily: t.heading, fontWeight: 800, fontSize: 260 * u, lineHeight: 0.9, color: t.emphasis, transform: `scale(${0.4 + p * 0.6}) rotate(${(1 - p) * -12}deg)`, opacity: p }}>{num}</div>
      <AnimatedHeadline text={title} animation={scene.animation} maxSize={96} maxLines={3} />
      <Body text={scene.body} />
      <div style={{ display: "flex", gap: 14 * u }}>
        {listScenes.map((s, i) => (
          <div key={s.id} style={{ width: (i === pos ? 64 : 22) * u, height: 22 * u, borderRadius: 999, background: i <= pos ? t.primary : rgba(t.fg, 0.2) }} />
        ))}
      </div>
    </Stack>
  );
}

function BeforeAfterScene({ scene }: { scene: Scene }) {
  const before = useAssetUrl(scene.beforeAfter?.beforeAssetId);
  const after = useAssetUrl(scene.beforeAfter?.afterAssetId);
  const ba = scene.beforeAfter;
  return (
    <Stack gap={36}>
      {scene.headline && <AnimatedHeadline text={scene.headline} animation="fade-up" maxSize={84} maxLines={2} />}
      <BeforeAfterSlider
        beforeLabel={ba?.beforeLabel ?? "Antes"}
        afterLabel={ba?.afterLabel ?? "Depois"}
        beforeText={ba?.beforeText ?? scene.body ?? ""}
        afterText={ba?.afterText ?? ""}
        beforeSrc={before}
        afterSrc={after}
        delay={6}
      />
    </Stack>
  );
}

function StoryScene({ scene }: { scene: Scene }) {
  const t = useTheme();
  return (
    <>
      <Stack justify="center">
        <AnimatedHeadline text={scene.headline ?? ""} animation={scene.animation === "fade-up" ? "blur-in" : scene.animation} maxSize={96} maxLines={4} weight={600} />
        <Body text={scene.body} delay={20} />
      </Stack>
      {t.style.letterbox && <Letterbox />}
    </>
  );
}

function OfferScene({ scene }: { scene: Scene }) {
  const t = useTheme();
  const frame = useCurrentFrame();
  const u = t.layout.unit;
  const badge = progress(frame, 18, 30);
  return (
    <>
      <IconBurst delay={10} count={18} />
      <Stack gap={36}>
        <AnimatedHeadline text={scene.headline ?? ""} animation={scene.animation} maxSize={100} maxLines={3} />
        {scene.stat && <StatCounter value={scene.stat.value} prefix={scene.stat.prefix} suffix={scene.stat.suffix} decimals={scene.stat.decimals} label={scene.stat.label} delay={6} />}
        {scene.body && (
          <div style={{ padding: `${16 * u}px ${34 * u}px`, borderRadius: 999, background: t.accent, color: t.onAccent, fontFamily: t.body, fontWeight: 800, fontSize: 38 * u, transform: `scale(${badge}) rotate(-3deg)` }}>{scene.body}</div>
        )}
      </Stack>
    </>
  );
}

function CTAScene({ scene, spec }: { scene: Scene; spec: VideoSpec }) {
  const t = useTheme();
  const logo = useAssetUrl(spec.brand.logoAssetId);
  return (
    <Stack gap={56}>
      {logo ? <LogoReveal src={logo} name="" size={180 * t.layout.unit} /> : null}
      <AnimatedHeadline text={scene.headline ?? spec.cta.text} animation={scene.animation} maxSize={104} maxLines={3} emphasis={scene.emphasis} />
      <CTAButton label={spec.cta.buttonLabel} sub={scene.body ?? spec.cta.subtext} delay={10} />
    </Stack>
  );
}

function LogoScene({ scene, spec }: { scene: Scene; spec: VideoSpec }) {
  const logo = useAssetUrl(scene.assets?.[0] ?? spec.brand.logoAssetId);
  return (
    <Stack>
      <LogoReveal src={logo} name={scene.headline ?? spec.brand.name} />
      <Body text={scene.body} delay={24} />
    </Stack>
  );
}

function DashboardScene({ scene }: { scene: Scene }) {
  return (
    <Stack gap={40}>
      <AnimatedHeadline text={scene.headline ?? ""} animation={scene.animation} maxSize={88} maxLines={3} />
      <DashboardMockup values={scene.chart?.values ?? [3, 4, 6, 5, 8, 9]} labels={scene.chart?.labels} title={scene.body} delay={8} />
    </Stack>
  );
}

function NotificationScene({ scene }: { scene: Scene; spec: VideoSpec }) {
  const t = useTheme();
  const n = scene.notification;
  return (
    <Stack gap={40}>
      <AnimatedHeadline text={scene.headline ?? ""} animation={scene.animation} maxSize={88} maxLines={2} />
      <div style={{ position: "relative" }}>
        <PhoneMockup delay={4} tilt={0} width={t.layout.safe.width * 0.55} />
        {n && (
          <div style={{ position: "absolute", top: 120 * t.layout.unit, left: "50%", transform: "translateX(-50%)" }}>
            <NotificationPopup app={n.app} title={n.title} body={n.body} delay={16} width={t.layout.safe.width * 0.8} />
          </div>
        )}
      </div>
    </Stack>
  );
}

export function SceneContent({ scene, spec, index }: { scene: Scene; spec: VideoSpec; index: number }) {
  switch (scene.type) {
    case "HOOK":
      return <HookScene scene={scene} spec={spec} />;
    case "PROBLEM":
    case "AGITATION":
      return <ProblemScene scene={scene} />;
    case "SOLUTION":
      return <SolutionScene scene={scene} />;
    case "FEATURE":
      return <FeatureScene scene={scene} index={index} />;
    case "DEMO":
      return <DemoScene scene={scene} />;
    case "STAT":
    case "SOCIAL_PROOF":
      return <StatScene scene={scene} />;
    case "TESTIMONIAL":
      return <TestimonialScene scene={scene} />;
    case "QUOTE":
      return <QuoteScene scene={scene} />;
    case "LIST_ITEM":
      return <ListItemScene scene={scene} spec={spec} index={index} />;
    case "BEFORE_AFTER":
      return <BeforeAfterScene scene={scene} />;
    case "STORY":
      return <StoryScene scene={scene} />;
    case "OFFER":
      return <OfferScene scene={scene} />;
    case "CTA":
      return <CTAScene scene={scene} spec={spec} />;
    case "LOGO":
      return <LogoScene scene={scene} spec={spec} />;
    case "DASHBOARD":
      return <DashboardScene scene={scene} />;
    case "NOTIFICATION":
      return <NotificationScene scene={scene} spec={spec} />;
    default:
      return <QuoteScene scene={scene} />;
  }
}

function sceneCanvas(scene: Scene, t: Theme): string {
  switch (scene.background.type) {
    case "solid":
    case "noise":
      return scene.background.colors?.[0] ?? t.bg;
    case "image":
    case "video":
      return t.bg;
    default:
      return t.canvas;
  }
}

export function SceneLayer({ scene, spec, index }: { scene: Scene; spec: VideoSpec; index: number }) {
  const t = useTheme();
  const canvas = sceneCanvas(scene, t);
  const theme = canvas.toLowerCase() === t.canvas.toLowerCase() ? t : deriveTheme(t, canvas);
  return (
    <ThemeContext.Provider value={theme}>
      <AbsoluteFill>
        <SceneBackground scene={scene} />
        <Effects scene={scene} />
        <SceneContent scene={scene} spec={spec} index={index} />
      </AbsoluteFill>
    </ThemeContext.Provider>
  );
}
