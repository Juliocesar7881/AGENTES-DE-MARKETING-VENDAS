import { runContentQA, type QaResult } from "@revenueos/video-engine/qa";
import { SIMILARITY_THRESHOLD, type Platform, type PlatformCopy, type VideoSpec } from "@revenueos/shared";

/** Spec-level Content QA (before rendering). Frame/codec checks run on the worker after the render. */
export function runContentQaOnSpec(spec: VideoSpec, platforms: Platform[], copy: PlatformCopy | null, similarity: number, similarToTitle: string | null): QaResult {
  return runContentQA({
    spec,
    platforms,
    copy,
    validation: null,
    frames: null,
    similarity: { score: similarity, threshold: SIMILARITY_THRESHOLD, similarToTitle },
    missingAssets: spec.assets.filter((a) => !a.id).map((a) => a.id),
  });
}
