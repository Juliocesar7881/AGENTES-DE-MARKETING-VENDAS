import { z } from "zod";

/**
 * VideoSpec — the contract between the Creative Agent (Claude) and the
 * Remotion engine. Claude never produces MP4 files; it produces a VideoSpec,
 * which is validated here and then rendered deterministically by Remotion.
 *
 * Bump VIDEO_SPEC_VERSION whenever the shape changes in a non-additive way.
 */
export const VIDEO_SPEC_VERSION = "1.0" as const;

export const TEMPLATE_IDS = [
  "saas-modern",
  "problem-solution",
  "fast-hook",
  "feature-showcase",
  "product-demo",
  "app-showcase",
  "before-after",
  "testimonial",
  "social-proof",
  "storytelling",
  "listicle",
  "premium-minimal",
  "bold-typography",
  "dashboard-showcase",
  "promotional-offer",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const VIDEO_FORMATS = ["9:16", "1:1", "16:9"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const FORMAT_DIMENSIONS: Record<VideoFormat, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export const SCENE_TYPES = [
  "HOOK",
  "PROBLEM",
  "AGITATION",
  "SOLUTION",
  "FEATURE",
  "DEMO",
  "STAT",
  "TESTIMONIAL",
  "SOCIAL_PROOF",
  "LIST_ITEM",
  "BEFORE_AFTER",
  "STORY",
  "OFFER",
  "CTA",
  "LOGO",
  "DASHBOARD",
  "NOTIFICATION",
  "QUOTE",
] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export const ANIMATIONS = [
  "fade-up",
  "slide-left",
  "slide-right",
  "scale-in",
  "kinetic",
  "typewriter",
  "mask-reveal",
  "pop",
  "blur-in",
  "none",
] as const;
export type AnimationKind = (typeof ANIMATIONS)[number];

export const LAYOUTS = [
  "center",
  "split",
  "top",
  "bottom",
  "phone",
  "browser",
  "dashboard",
  "card-stack",
  "fullbleed",
  "grid",
] as const;
export type LayoutKind = (typeof LAYOUTS)[number];

export const BACKGROUND_TYPES = ["solid", "gradient", "mesh", "image", "video", "spotlight", "grid", "noise"] as const;
export type BackgroundType = (typeof BACKGROUND_TYPES)[number];

export const EFFECTS = [
  "spotlight",
  "particles",
  "glow",
  "grain",
  "zoom",
  "shake",
  "highlight",
  "confetti",
  "scanline",
] as const;
export type EffectKind = (typeof EFFECTS)[number];

export const TRANSITIONS = ["fade", "slide-up", "slide-left", "wipe", "zoom", "blur", "none"] as const;
export type TransitionKind = (typeof TRANSITIONS)[number];

export const HOOK_TYPES = [
  "QUESTION",
  "STAT",
  "PAIN",
  "BOLD_CLAIM",
  "STORY",
  "CURIOSITY",
  "CONTRARIAN",
  "DEMO",
  "OFFER",
  "SOCIAL_PROOF",
] as const;
export type HookType = (typeof HOOK_TYPES)[number];

export const CTA_TYPES = [
  "DM",
  "WHATSAPP",
  "LINK_IN_BIO",
  "COMMENT",
  "SHOP_NOW",
  "BOOK",
  "FREE_TRIAL",
  "LEARN_MORE",
  "FOLLOW",
] as const;
export type CtaType = (typeof CTA_TYPES)[number];

export const OBJECTIVES = ["SALES", "LEADS", "TRAFFIC", "ENGAGEMENT", "AWARENESS"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const SOUNDTRACK_MOODS = ["none", "upbeat", "calm", "epic", "corporate", "playful"] as const;
export type SoundtrackMood = (typeof SOUNDTRACK_MOODS)[number];

export const CAPTION_STYLES = ["karaoke", "block", "none"] as const;

/** Fonts bundled locally (OFL licensed, via @fontsource). No network needed at render time. */
export const AVAILABLE_FONTS = [
  "Inter",
  "Montserrat",
  "Poppins",
  "Bebas Neue",
  "Playfair Display",
  "Space Grotesk",
  "DM Sans",
  "Archivo Black",
  "Sora",
  "Manrope",
] as const;
export type FontFamily = (typeof AVAILABLE_FONTS)[number];

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a hex color like #1A2B3C");

export const LIMITS = {
  headline: 90,
  body: 220,
  bullet: 70,
  bullets: 6,
  hook: 110,
  captionLine: 90,
  ctaText: 60,
  scenes: 12,
  minSceneSec: 0.8,
  minDurationSec: 5,
  maxDurationSec: 90,
} as const;

export const AssetRefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["LOGO", "ICON", "SCREENSHOT", "PHOTO", "VIDEO", "PRODUCT_SHOT", "MOCKUP", "AUDIO"]),
  /** Resolved at render/preview time. Never persisted as a signed URL. */
  url: z.string().nullable().optional(),
  alt: z.string().max(200).default(""),
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

export const BackgroundSchema = z.object({
  type: z.enum(BACKGROUND_TYPES),
  colors: z.array(hexColor).max(4).optional(),
  assetId: z.string().nullable().optional(),
});

export const SceneSchema = z.object({
  id: z.string().min(1),
  start: z.number().min(0),
  duration: z.number().min(LIMITS.minSceneSec).max(30),
  type: z.enum(SCENE_TYPES),
  headline: z.string().max(LIMITS.headline).optional(),
  body: z.string().max(LIMITS.body).optional(),
  bullets: z.array(z.string().max(LIMITS.bullet)).max(LIMITS.bullets).optional(),
  emphasis: z.array(z.string().max(40)).max(4).optional(),
  stat: z
    .object({
      value: z.number(),
      prefix: z.string().max(6).optional(),
      suffix: z.string().max(10).optional(),
      label: z.string().max(60),
      decimals: z.number().int().min(0).max(2).optional(),
    })
    .optional(),
  testimonial: z
    .object({
      quote: z.string().max(200),
      author: z.string().max(60),
      role: z.string().max(60).optional(),
      rating: z.number().min(1).max(5).optional(),
    })
    .optional(),
  beforeAfter: z
    .object({
      beforeLabel: z.string().max(30),
      afterLabel: z.string().max(30),
      beforeText: z.string().max(120),
      afterText: z.string().max(120),
      beforeAssetId: z.string().nullable().optional(),
      afterAssetId: z.string().nullable().optional(),
    })
    .optional(),
  chart: z
    .object({
      type: z.enum(["bar", "line"]),
      values: z.array(z.number()).min(2).max(12),
      labels: z.array(z.string().max(12)).max(12).optional(),
    })
    .optional(),
  notification: z
    .object({
      app: z.string().max(30),
      title: z.string().max(60),
      body: z.string().max(120),
    })
    .optional(),
  assets: z.array(z.string()).max(4).optional(),
  animation: z.enum(ANIMATIONS).default("fade-up"),
  layout: z.enum(LAYOUTS).default("center"),
  background: BackgroundSchema.default({ type: "gradient" }),
  effects: z.array(z.enum(EFFECTS)).max(3).optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const CaptionSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().min(1).max(LIMITS.captionLine),
});
export type Caption = z.infer<typeof CaptionSchema>;

export const TransitionSchema = z.object({
  afterScene: z.number().int().min(0),
  type: z.enum(TRANSITIONS),
  durationSec: z.number().min(0).max(1.5).default(0.4),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const BrandSnapshotSchema = z.object({
  name: z.string().min(1).max(80),
  logoAssetId: z.string().nullable().optional(),
  primaryColor: hexColor,
  secondaryColor: hexColor,
  accentColor: hexColor,
  backgroundColor: hexColor,
  textColor: hexColor,
  fontHeading: z.enum(AVAILABLE_FONTS).default("Inter"),
  fontBody: z.enum(AVAILABLE_FONTS).default("Inter"),
  handle: z.string().max(60).optional(),
  website: z.string().max(200).optional(),
});
export type BrandSnapshot = z.infer<typeof BrandSnapshotSchema>;

export const CtaSchema = z.object({
  text: z.string().min(1).max(LIMITS.ctaText),
  subtext: z.string().max(100).optional(),
  buttonLabel: z.string().min(1).max(30),
  type: z.enum(CTA_TYPES),
  url: z.string().max(300).optional(),
});
export type Cta = z.infer<typeof CtaSchema>;

export const SoundtrackSchema = z.object({
  assetId: z.string().nullable().optional(),
  mood: z.enum(SOUNDTRACK_MOODS).default("none"),
  volume: z.number().min(0).max(1).default(0.35),
  /** When true and no assetId is given, the engine synthesizes an original royalty-free pad. */
  generated: z.boolean().default(false),
});

export const VideoSpecMetadataSchema = z.object({
  generator: z.enum(["agent", "human", "mock"]),
  promptVersion: z.string().optional(),
  model: z.string().optional(),
  createdAt: z.string(),
  angle: z.string().max(120).optional(),
  hookType: z.enum(HOOK_TYPES),
  ctaType: z.enum(CTA_TYPES),
  language: z.string().default("pt-BR"),
  captionStyle: z.enum(CAPTION_STYLES).default("block"),
  experiment: z
    .object({
      id: z.string().optional(),
      variable: z.enum(["HOOK", "ANGLE", "CTA", "TEMPLATE", "LAYOUT", "STRUCTURE"]).optional(),
      variantLabel: z.string().max(4).optional(),
    })
    .optional(),
});

export const VideoSpecBaseSchema = z.object({
  schemaVersion: z.literal(VIDEO_SPEC_VERSION).default(VIDEO_SPEC_VERSION),
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  contentId: z.string().min(1),
  campaignId: z.string().nullable().optional(),
  title: z.string().min(1).max(120),
  objective: z.enum(OBJECTIVES),
  targetAudience: z.string().max(300),
  templateId: z.enum(TEMPLATE_IDS),
  format: z.enum(VIDEO_FORMATS),
  width: z.number().int(),
  height: z.number().int(),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).default(30),
  duration: z.number().min(LIMITS.minDurationSec).max(LIMITS.maxDurationSec),
  hook: z.object({
    text: z.string().min(1).max(LIMITS.hook),
    type: z.enum(HOOK_TYPES),
  }),
  scenes: z.array(SceneSchema).min(1).max(LIMITS.scenes),
  captions: z.array(CaptionSchema).max(60).default([]),
  transitions: z.array(TransitionSchema).max(12).default([]),
  soundtrack: SoundtrackSchema.nullable().default(null),
  assets: z.array(AssetRefSchema).max(20).default([]),
  brand: BrandSnapshotSchema,
  cta: CtaSchema,
  metadata: VideoSpecMetadataSchema,
});

const TIMING_TOLERANCE = 0.12;

export const VideoSpecSchema = VideoSpecBaseSchema.superRefine((spec, ctx) => {
  const dims = FORMAT_DIMENSIONS[spec.format];
  if (spec.width !== dims.width || spec.height !== dims.height) {
    ctx.addIssue({
      code: "custom",
      path: ["width"],
      message: `Format ${spec.format} requires ${dims.width}x${dims.height}, got ${spec.width}x${spec.height}`,
    });
  }
  let cursor = 0;
  spec.scenes.forEach((scene, i) => {
    if (Math.abs(scene.start - cursor) > TIMING_TOLERANCE) {
      ctx.addIssue({
        code: "custom",
        path: ["scenes", i, "start"],
        message: `Scene ${i} starts at ${scene.start}s but previous scene ends at ${cursor.toFixed(2)}s`,
      });
    }
    cursor = scene.start + scene.duration;
  });
  if (Math.abs(cursor - spec.duration) > TIMING_TOLERANCE * 2) {
    ctx.addIssue({
      code: "custom",
      path: ["duration"],
      message: `Scenes total ${cursor.toFixed(2)}s but duration is ${spec.duration}s`,
    });
  }
  const sceneIds = new Set<string>();
  spec.scenes.forEach((scene, i) => {
    if (sceneIds.has(scene.id)) {
      ctx.addIssue({ code: "custom", path: ["scenes", i, "id"], message: `Duplicate scene id ${scene.id}` });
    }
    sceneIds.add(scene.id);
  });
  spec.captions.forEach((c, i) => {
    if (c.end <= c.start || c.end > spec.duration + TIMING_TOLERANCE) {
      ctx.addIssue({ code: "custom", path: ["captions", i], message: "Caption timing out of range" });
    }
  });
  spec.transitions.forEach((t, i) => {
    if (t.afterScene >= spec.scenes.length - 1) {
      ctx.addIssue({ code: "custom", path: ["transitions", i], message: "Transition must be between two scenes" });
    }
  });
  const assetIds = new Set(spec.assets.map((a) => a.id));
  spec.scenes.forEach((scene, i) => {
    for (const ref of [...(scene.assets ?? []), scene.background.assetId, scene.beforeAfter?.beforeAssetId, scene.beforeAfter?.afterAssetId]) {
      if (ref && !assetIds.has(ref)) {
        ctx.addIssue({ code: "custom", path: ["scenes", i, "assets"], message: `Unknown asset ${ref}` });
      }
    }
  });
  if (spec.soundtrack?.assetId && !assetIds.has(spec.soundtrack.assetId)) {
    ctx.addIssue({ code: "custom", path: ["soundtrack", "assetId"], message: "Soundtrack asset not declared in assets[]" });
  }
});

export type VideoSpec = z.infer<typeof VideoSpecSchema>;
export type VideoSpecInput = z.input<typeof VideoSpecSchema>;

/**
 * Deterministic repair of common, harmless timing drift produced by LLMs:
 * recomputes scene starts from durations and rescales to the declared duration,
 * clamps captions and drops dangling transitions. Content is never invented.
 */
export function normalizeVideoSpecTiming<T extends { duration: number; scenes: { start: number; duration: number }[]; captions?: { start: number; end: number }[]; transitions?: { afterScene: number }[] }>(spec: T): T {
  const total = spec.scenes.reduce((s, sc) => s + Math.max(sc.duration, LIMITS.minSceneSec), 0);
  const factor = total > 0 ? spec.duration / total : 1;
  let cursor = 0;
  const scenes = spec.scenes.map((sc) => {
    const duration = Math.max(LIMITS.minSceneSec, round2(Math.max(sc.duration, LIMITS.minSceneSec) * factor));
    const out = { ...sc, start: round2(cursor), duration };
    cursor += duration;
    return out;
  });
  const drift = round2(spec.duration - cursor);
  if (scenes.length > 0 && Math.abs(drift) > 0) {
    const last = scenes[scenes.length - 1]!;
    last.duration = round2(Math.max(LIMITS.minSceneSec, last.duration + drift));
  }
  const captions = (spec.captions ?? [])
    .map((c) => ({ ...c, start: Math.max(0, Math.min(c.start, spec.duration)), end: Math.min(c.end, spec.duration) }))
    .filter((c) => c.end > c.start);
  const transitions = (spec.transitions ?? []).filter((t) => t.afterScene < scenes.length - 1);
  return { ...spec, scenes, captions, transitions };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatForDimensions(width: number, height: number): VideoFormat {
  const r = width / height;
  if (Math.abs(r - 9 / 16) < 0.01) return "9:16";
  if (Math.abs(r - 1) < 0.01) return "1:1";
  return "16:9";
}

export function totalFrames(spec: Pick<VideoSpec, "duration" | "fps">): number {
  return Math.round(spec.duration * spec.fps);
}

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  description: string;
  bestFor: string;
  defaultSceneTypes: SceneType[];
}

/** Human + LLM readable catalog. The Creative Agent receives this list. */
export const TEMPLATE_CATALOG: TemplateInfo[] = [
  { id: "saas-modern", name: "SaaS Modern", description: "Clean gradient mesh, floating UI cards, crisp sans typography.", bestFor: "software, apps, digital services", defaultSceneTypes: ["HOOK", "PROBLEM", "SOLUTION", "FEATURE", "CTA"] },
  { id: "problem-solution", name: "Problem → Solution", description: "Dark tense opening, red problem highlights, bright solution reveal.", bestFor: "any product that removes a clear pain", defaultSceneTypes: ["HOOK", "PROBLEM", "AGITATION", "SOLUTION", "CTA"] },
  { id: "fast-hook", name: "Fast Hook", description: "High-energy kinetic cuts, 0.8–1.5s scenes, bold captions.", bestFor: "scroll-stopping short-form, broad reach", defaultSceneTypes: ["HOOK", "STAT", "SOLUTION", "CTA"] },
  { id: "feature-showcase", name: "Feature Showcase", description: "Feature cards with icons popping in sequence over a spotlight.", bestFor: "products with 3–5 key benefits", defaultSceneTypes: ["HOOK", "FEATURE", "FEATURE", "FEATURE", "CTA"] },
  { id: "product-demo", name: "Product Demo", description: "Browser/device frame with cursor walkthrough and callouts.", bestFor: "showing how something works", defaultSceneTypes: ["HOOK", "DEMO", "DEMO", "SOLUTION", "CTA"] },
  { id: "app-showcase", name: "App Showcase", description: "3D-tilted phone mockup, notifications popping, app screenshots.", bestFor: "mobile apps, booking, delivery", defaultSceneTypes: ["HOOK", "NOTIFICATION", "DEMO", "FEATURE", "CTA"] },
  { id: "before-after", name: "Before / After", description: "Split-screen wipe slider contrasting old vs new state.", bestFor: "transformations: clinics, services, results", defaultSceneTypes: ["HOOK", "BEFORE_AFTER", "SOLUTION", "CTA"] },
  { id: "testimonial", name: "Testimonial", description: "Quote cards with rating stars and avatar, warm tones.", bestFor: "trust-driven sales, local businesses", defaultSceneTypes: ["HOOK", "TESTIMONIAL", "TESTIMONIAL", "CTA"] },
  { id: "social-proof", name: "Social Proof", description: "Animated counters, logos wall and review stars.", bestFor: "established businesses with numbers", defaultSceneTypes: ["HOOK", "STAT", "SOCIAL_PROOF", "CTA"] },
  { id: "storytelling", name: "Storytelling", description: "Cinematic letterbox, slow reveals, narrative captions.", bestFor: "emotional products, education, family", defaultSceneTypes: ["HOOK", "STORY", "STORY", "SOLUTION", "CTA"] },
  { id: "listicle", name: "Listicle", description: "Numbered list items sliding in with progress indicator.", bestFor: "tips, mistakes, reasons-why content", defaultSceneTypes: ["HOOK", "LIST_ITEM", "LIST_ITEM", "LIST_ITEM", "CTA"] },
  { id: "premium-minimal", name: "Premium Minimal", description: "Lots of negative space, serif display type, slow elegant motion.", bestFor: "premium, luxury, high-ticket offers", defaultSceneTypes: ["HOOK", "QUOTE", "SOLUTION", "CTA"] },
  { id: "bold-typography", name: "Bold Typography", description: "Giant kinetic type filling the frame, brutalist colors.", bestFor: "strong claims, contrarian takes", defaultSceneTypes: ["HOOK", "PROBLEM", "SOLUTION", "CTA"] },
  { id: "dashboard-showcase", name: "Dashboard Showcase", description: "Animated charts, KPI counters and dashboard mockup.", bestFor: "results, analytics, B2B", defaultSceneTypes: ["HOOK", "DASHBOARD", "STAT", "CTA"] },
  { id: "promotional-offer", name: "Promotional Offer", description: "Price reveal, countdown feel, burst effects and big CTA.", bestFor: "limited offers, launches, discounts", defaultSceneTypes: ["HOOK", "OFFER", "FEATURE", "CTA"] },
];
