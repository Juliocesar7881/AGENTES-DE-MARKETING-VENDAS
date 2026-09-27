import { z } from "zod";
import { LEAD_STAGES, MEMORY_CATEGORIES, REAL_PLATFORMS } from "../enums";
import {
  CAPTION_STYLES,
  CaptionSchema,
  CtaSchema,
  CTA_TYPES,
  HOOK_TYPES,
  OBJECTIVES,
  SceneSchema,
  SOUNDTRACK_MOODS,
  TEMPLATE_IDS,
  TransitionSchema,
  VIDEO_FORMATS,
} from "./video-spec";

/* ------------------------------------------------------------------ */
/* Strategist                                                          */
/* ------------------------------------------------------------------ */

export const EXPERIMENT_VARIABLES = ["HOOK", "ANGLE", "CTA", "TEMPLATE", "LAYOUT", "STRUCTURE"] as const;

export const ContentBriefSchema = z.object({
  title: z.string().min(3).max(120),
  objective: z.enum(OBJECTIVES),
  angle: z.string().min(3).max(160),
  hook: z.string().min(3).max(110),
  hookType: z.enum(HOOK_TYPES),
  templateId: z.enum(TEMPLATE_IDS),
  format: z.enum(VIDEO_FORMATS).default("9:16"),
  targetPlatforms: z.array(z.enum([...REAL_PLATFORMS, "MOCK"])).min(1).max(4),
  productId: z.string().nullable(),
  cta: z.string().min(2).max(60),
  ctaType: z.enum(CTA_TYPES),
  keyMessage: z.string().min(3).max(300),
  rationale: z.string().min(3).max(500),
  durationSec: z.number().min(6).max(60),
  experiment: z
    .object({
      variable: z.enum(EXPERIMENT_VARIABLES),
      variantLabel: z.string().max(4),
      hypothesis: z.string().max(300),
    })
    .nullable()
    .optional(),
});
export type ContentBrief = z.infer<typeof ContentBriefSchema>;

export const StrategyPlanOutputSchema = z.object({
  summary: z.string().min(10).max(1500),
  campaign: z.object({
    action: z.enum(["CONTINUE", "CREATE"]),
    campaignId: z.string().nullable().optional(),
    name: z.string().min(2).max(100),
    objective: z.enum(OBJECTIVES),
    angle: z.string().max(200),
    offer: z.string().max(300),
    cta: z.string().max(100),
  }),
  briefs: z.array(ContentBriefSchema).min(1).max(8),
  dataCaveats: z.array(z.string().max(300)).max(5).default([]),
});
export type StrategyPlanOutput = z.infer<typeof StrategyPlanOutputSchema>;

/* ------------------------------------------------------------------ */
/* Creative                                                            */
/* ------------------------------------------------------------------ */

/** The part of the VideoSpec the Creative Agent decides. Ids, brand and dimensions are filled by code. */
export const CreativeVideoDraftSchema = z.object({
  title: z.string().min(1).max(120),
  objective: z.enum(OBJECTIVES),
  targetAudience: z.string().max(300),
  templateId: z.enum(TEMPLATE_IDS),
  format: z.enum(VIDEO_FORMATS),
  duration: z.number().min(5).max(90),
  hook: z.object({ text: z.string().min(1).max(110), type: z.enum(HOOK_TYPES) }),
  scenes: z.array(SceneSchema).min(2).max(12),
  captions: z.array(CaptionSchema).max(60).default([]),
  transitions: z.array(TransitionSchema).max(12).default([]),
  soundtrackMood: z.enum(SOUNDTRACK_MOODS).default("none"),
  usedAssetIds: z.array(z.string()).max(20).default([]),
  cta: CtaSchema,
  angle: z.string().max(120),
  captionStyle: z.enum(CAPTION_STYLES).default("block"),
});
export type CreativeVideoDraft = z.infer<typeof CreativeVideoDraftSchema>;

export const PlatformCopySchema = z.object({
  instagram: z.object({ caption: z.string().max(2000), hashtags: z.array(z.string().max(40)).max(15) }),
  tiktok: z.object({ caption: z.string().max(2000), hashtags: z.array(z.string().max(40)).max(10) }),
  youtube: z.object({ title: z.string().max(100), description: z.string().max(4500), tags: z.array(z.string().max(40)).max(15) }),
  facebook: z.object({ caption: z.string().max(2000) }),
});
export type PlatformCopy = z.infer<typeof PlatformCopySchema>;

export const CreativeOutputSchema = z.object({
  video: CreativeVideoDraftSchema,
  script: z.string().min(10).max(4000),
  copy: PlatformCopySchema,
  selfCheck: z.object({
    hookUnder2s: z.boolean(),
    brandRespected: z.boolean(),
    forbiddenWordsAvoided: z.boolean(),
    notes: z.string().max(500).default(""),
  }),
});
export type CreativeOutput = z.infer<typeof CreativeOutputSchema>;

/* ------------------------------------------------------------------ */
/* Sales                                                               */
/* ------------------------------------------------------------------ */

export const SALES_INTENTS = [
  "BROWSING",
  "INTERESTED",
  "READY_TO_BUY",
  "OBJECTION",
  "SUPPORT",
  "OPT_OUT",
  "OTHER",
] as const;
export type SalesIntent = (typeof SALES_INTENTS)[number];

/** Signals the Sales Agent can report. Scoring weights are configurable per workspace. */
export const LEAD_SIGNALS = [
  "ASKED_PRICE",
  "ASKED_HOW_TO_BUY",
  "MENTIONED_BUDGET",
  "HAS_URGENCY",
  "DECISION_MAKER",
  "POSITIVE_SENTIMENT",
  "NEGATIVE_SENTIMENT",
  "PRICE_OBJECTION",
  "TRUST_OBJECTION",
  "TIMING_OBJECTION",
  "COMPETITOR_MENTION",
  "REQUESTED_HUMAN",
  "SHARED_CONTACT_INFO",
  "NOT_A_FIT",
] as const;
export type LeadSignal = (typeof LEAD_SIGNALS)[number];

export const ConversationMemorySchema = z.object({
  summary: z.string().max(1500),
  facts: z.array(z.string().max(200)).max(15),
  needs: z.array(z.string().max(200)).max(10),
  objections: z.array(z.string().max(200)).max(10),
  budget: z.string().max(100).nullable(),
  intent: z.enum(SALES_INTENTS),
  lastState: z.string().max(300),
});
export type ConversationMemory = z.infer<typeof ConversationMemorySchema>;

export const SalesReplyOutputSchema = z.object({
  reply: z.string().max(1200),
  intent: z.enum(SALES_INTENTS),
  signals: z.array(z.enum(LEAD_SIGNALS)).max(10),
  qualified: z.boolean(),
  suggestedStage: z.enum(LEAD_STAGES),
  requestCheckout: z
    .object({ productId: z.string(), discountPct: z.number().min(0).max(90) })
    .nullable(),
  handoffToHuman: z.boolean(),
  handoffReason: z.string().max(300).nullable(),
  sensitive: z.boolean(),
  followUpInHours: z.number().min(1).max(24 * 14).nullable(),
  memory: ConversationMemorySchema,
});
export type SalesReplyOutput = z.infer<typeof SalesReplyOutputSchema>;

/* ------------------------------------------------------------------ */
/* Performance review / weekly strategy                                */
/* ------------------------------------------------------------------ */

export const PerformanceReviewOutputSchema = z.object({
  headline: z.string().max(300),
  insights: z
    .array(
      z.object({
        title: z.string().max(140),
        finding: z.string().max(600),
        evidence: z.string().max(600),
        recommendation: z.string().max(400),
      }),
    )
    .max(8),
  memories: z
    .array(z.object({ category: z.enum(MEMORY_CATEGORIES), content: z.string().max(500) }))
    .max(10),
  nextFocus: z.array(z.string().max(200)).max(5),
});
export type PerformanceReviewOutput = z.infer<typeof PerformanceReviewOutputSchema>;

export const WeeklyStrategyOutputSchema = z.object({
  summary: z.string().max(1500),
  priorities: z.array(z.string().max(300)).max(6),
  contentThemes: z.array(z.string().max(200)).max(8),
  experiments: z.array(z.object({ variable: z.enum(EXPERIMENT_VARIABLES), hypothesis: z.string().max(300) })).max(4),
  risks: z.array(z.string().max(300)).max(5),
});
export type WeeklyStrategyOutput = z.infer<typeof WeeklyStrategyOutputSchema>;

/* ------------------------------------------------------------------ */
/* Website analyzer (classification model)                             */
/* ------------------------------------------------------------------ */

export const WebsiteInsightsOutputSchema = z.object({
  businessName: z.string().max(100),
  industry: z.string().max(100),
  description: z.string().max(800),
  targetAudience: z.string().max(400),
  problems: z.array(z.string().max(200)).max(6),
  goals: z.array(z.string().max(200)).max(6),
  products: z.array(z.object({ name: z.string().max(100), description: z.string().max(400), priceText: z.string().max(40).nullable() })).max(8),
  tone: z.string().max(100),
  keywords: z.array(z.string().max(40)).max(12),
});
export type WebsiteInsightsOutput = z.infer<typeof WebsiteInsightsOutputSchema>;

/* ------------------------------------------------------------------ */
/* Advanced creative (custom Remotion composition proposal)            */
/* ------------------------------------------------------------------ */

export const CompositionProposalSchema = z.object({
  name: z.string().min(3).max(60),
  description: z.string().max(400),
  /** A single TSX module exporting `default function Composition(props)`. */
  code: z.string().min(50).max(30000),
});
export type CompositionProposal = z.infer<typeof CompositionProposalSchema>;
