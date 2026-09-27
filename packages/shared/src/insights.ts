import type { ConfidenceLevel } from "./enums";

/**
 * Transparent confidence rules for creative insights. We never output fake
 * statistics: the category is derived from sample sizes and a standard
 * two-proportion z-test, and the rule that fired is stored as evidence.
 */

export function twoProportionZ(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!Number.isFinite(se) || se === 0) return null;
  return (p1 - p2) / se;
}

export interface ConfidenceInput {
  /** Number of distinct contents in the group. */
  contents: number;
  /** Exposures behind the rate (views for lead-rate, leads for sale-rate…). */
  exposures: number;
  /** Conversion events in the group (leads, sales…). */
  events: number;
  /** Relative lift vs the workspace baseline (0.25 = +25%). */
  lift: number | null;
  /** z-score when the metric is a proportion; null for non-proportion metrics. */
  z: number | null;
}

export interface ConfidenceResult {
  level: ConfidenceLevel;
  rule: string;
}

export const CONFIDENCE_RULES = {
  LOW_DATA: "Fewer than 3 contents, fewer than 500 exposures or fewer than 3 conversion events.",
  PROMISING: "At least 3 contents and a lift of 15%+ vs baseline, but not yet statistically consistent.",
  CONSISTENT: "At least 5 contents, 10+ events and |z| ≥ 1.96 (≈95% two-sided) — or 5+ contents with 20%+ lift for non-proportion metrics.",
  STRONG_EVIDENCE: "At least 10 contents, 20+ events, |z| ≥ 2.58 (≈99% two-sided) and a lift of 20%+.",
} as const;

export function classifyConfidence(i: ConfidenceInput): ConfidenceResult | null {
  if (i.contents < 3 || i.exposures < 500 || i.events < 3) {
    return { level: "LOW_DATA", rule: CONFIDENCE_RULES.LOW_DATA };
  }
  const lift = i.lift ?? 0;
  const absLift = Math.abs(lift);
  const absZ = i.z == null ? null : Math.abs(i.z);
  if (i.contents >= 10 && i.events >= 20 && absZ != null && absZ >= 2.58 && absLift >= 0.2) {
    return { level: "STRONG_EVIDENCE", rule: CONFIDENCE_RULES.STRONG_EVIDENCE };
  }
  if (i.contents >= 5 && i.events >= 10 && ((absZ != null && absZ >= 1.96) || (absZ == null && absLift >= 0.2))) {
    return { level: "CONSISTENT", rule: CONFIDENCE_RULES.CONSISTENT };
  }
  if (absLift >= 0.15) return { level: "PROMISING", rule: CONFIDENCE_RULES.PROMISING };
  return null;
}

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  LOW_DATA: "Low data",
  PROMISING: "Promising",
  CONSISTENT: "Consistent",
  STRONG_EVIDENCE: "Strong evidence",
};
