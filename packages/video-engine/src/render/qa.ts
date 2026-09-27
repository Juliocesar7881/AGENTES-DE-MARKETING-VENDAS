import { PLATFORM_CAPABILITIES, type Platform, type PlatformCopy, type VideoSpec } from "@revenueos/shared";
import { buildTheme } from "../theme";
import { fitFontSize } from "../layout";
import type { FrameStats } from "./frames";
import type { ValidationCheck } from "./probe";

export interface QaCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface QaInput {
  spec: VideoSpec;
  platforms: Platform[];
  copy: PlatformCopy | null;
  validation: ValidationCheck[] | null;
  frames: FrameStats[] | null;
  similarity: { score: number; threshold: number; similarToTitle?: string | null } | null;
  missingAssets: string[];
}

export interface QaResult {
  status: "PASSED" | "WARNINGS" | "FAILED";
  checks: QaCheck[];
}

/**
 * Content QA before (auto)publishing: duration, text overflow, safe zones,
 * missing assets, blank scenes, CTA, captions per platform, duplicates and
 * render integrity. Deterministic and explainable.
 */
export function runContentQA(input: QaInput): QaResult {
  const { spec } = input;
  const checks: QaCheck[] = [];
  const add = (id: string, status: QaCheck["status"], message: string) => checks.push({ id, status, message });

  // Duration vs every target platform
  for (const p of input.platforms) {
    const caps = PLATFORM_CAPABILITIES[p];
    if (spec.duration > caps.maxDurationSec) add(`duration_${p}`, "fail", `${spec.duration}s exceeds ${caps.displayName} maximum of ${caps.maxDurationSec}s`);
    else if (spec.duration < caps.minDurationSec) add(`duration_${p}`, "fail", `${spec.duration}s is below ${caps.displayName} minimum of ${caps.minDurationSec}s`);
  }
  if (!checks.some((c) => c.id.startsWith("duration_"))) add("duration", "pass", `Duration ${spec.duration}s fits all target platforms`);

  // Text overflow (same fitting algorithm the templates use)
  const theme = buildTheme(spec, spec.width, spec.height);
  const u = theme.layout.unit;
  const overflow: string[] = [];
  for (const s of spec.scenes) {
    if (s.headline) {
      const fit = fitFontSize(s.headline, theme.layout.safe.width, 5, Math.round(128 * u * theme.style.headlineScale), Math.round(44 * u), { upper: theme.style.headlineUpper, condensed: theme.condensedHeading });
      if (fit.overflow) overflow.push(`${s.id} headline`);
    }
    if (s.body && s.body.length > 200) overflow.push(`${s.id} body is long (${s.body.length} chars)`);
  }
  add("text_overflow", overflow.length ? "fail" : "pass", overflow.length ? `Text may overflow: ${overflow.join("; ")}` : "All headlines fit inside the safe area");

  // Safe zones: captions must fit in 2 lines of the caption band
  const longCaptions = spec.captions.filter((c) => fitFontSize(c.text, theme.layout.safe.width * 0.92, 2, Math.round(54 * u), Math.round(34 * u)).overflow);
  add("safe_zones", longCaptions.length ? "warn" : "pass", longCaptions.length ? `${longCaptions.length} caption line(s) too long for the safe caption band` : "Captions and content stay inside platform safe zones");

  // Assets
  add("missing_assets", input.missingAssets.length ? "fail" : "pass", input.missingAssets.length ? `Missing assets: ${input.missingAssets.join(", ")}` : "All referenced assets are available");

  // Blank scenes (visual QA on extracted frames)
  if (input.frames) {
    const blanks = input.frames.filter((f) => f.blank);
    add("blank_frames", blanks.length > 1 ? "fail" : blanks.length === 1 ? "warn" : "pass", blanks.length ? `Flat/blank frame at ${blanks.map((b) => b.label).join(", ")}` : "No blank frames at start/25/50/75/end");
  } else {
    add("blank_frames", "warn", "Frames not analyzed (video not rendered on this machine)");
  }

  // CTA
  const last = spec.scenes[spec.scenes.length - 1];
  const hasCta = Boolean(spec.cta.text) && (last?.type === "CTA" || last?.type === "OFFER");
  add("cta", hasCta ? "pass" : "fail", hasCta ? `CTA: "${spec.cta.text}"` : "The video does not end with a CTA scene");

  // Captions / copy per platform
  if (!input.copy) add("captions", "fail", "No platform captions were generated");
  else {
    const missing: string[] = [];
    for (const p of input.platforms) {
      const caps = PLATFORM_CAPABILITIES[p];
      const text =
        p === "INSTAGRAM" ? input.copy.instagram.caption : p === "TIKTOK" ? input.copy.tiktok.caption : p === "YOUTUBE" ? input.copy.youtube.title : p === "FACEBOOK" ? input.copy.facebook.caption : input.copy.instagram.caption;
      if (!text?.trim()) missing.push(`${caps.displayName}: empty`);
      else if (text.length > caps.captionMaxLength) missing.push(`${caps.displayName}: too long`);
    }
    add("captions", missing.length ? "fail" : "pass", missing.length ? missing.join("; ") : "Captions ready for every target platform");
  }

  // Duplicate / fatigue
  if (input.similarity) {
    const { score, threshold } = input.similarity;
    add("duplicate", score > threshold ? "fail" : score > threshold * 0.85 ? "warn" : "pass", score > threshold ? `Too similar (${Math.round(score * 100)}%) to "${input.similarity.similarToTitle ?? "a recent content"}"` : `Similarity to recent content ${Math.round(score * 100)}%`);
  }

  // Technical integrity from ffprobe validation
  if (input.validation) {
    const failed = input.validation.filter((v) => v.status === "fail");
    add("render_integrity", failed.length ? "fail" : "pass", failed.length ? failed.map((f) => f.message).join("; ") : "Codec, resolution, duration and audio validated");
  }

  const status = checks.some((c) => c.status === "fail") ? "FAILED" : checks.some((c) => c.status === "warn") ? "WARNINGS" : "PASSED";
  return { status, checks };
}
