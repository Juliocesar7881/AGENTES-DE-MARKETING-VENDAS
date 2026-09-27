import { DEFAULT_MODEL_PRICES, type ModelPrice } from "@revenueos/shared";
import type { TokenUsage } from "./types";

export function priceFor(model: string, overrides: Record<string, ModelPrice> = {}): ModelPrice | null {
  if (overrides[model]) return overrides[model]!;
  if (DEFAULT_MODEL_PRICES[model]) return DEFAULT_MODEL_PRICES[model]!;
  // tolerate dated/suffixed ids by longest-prefix match
  const all = { ...DEFAULT_MODEL_PRICES, ...overrides };
  const match = Object.keys(all)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return match ? all[match]! : null;
}

export function estimateCostUsd(
  model: string,
  usage: TokenUsage,
  overrides: Record<string, ModelPrice> = {},
): { costUsd: number; priceKnown: boolean } {
  const p = priceFor(model, overrides);
  if (!p) return { costUsd: 0, priceKnown: false };
  const cacheRead = p.cacheReadPerMTok ?? p.inputPerMTok * 0.1;
  const cacheWrite = p.cacheWritePerMTok ?? p.inputPerMTok * 1.25;
  const cost =
    (usage.inputTokens * p.inputPerMTok +
      usage.outputTokens * p.outputPerMTok +
      usage.cacheReadTokens * cacheRead +
      usage.cacheWriteTokens * cacheWrite) /
    1_000_000;
  return { costUsd: Math.round(cost * 1_000_000) / 1_000_000, priceKnown: true };
}

export function addUsage(a: TokenUsage, b: Partial<TokenUsage>): TokenUsage {
  return {
    inputTokens: a.inputTokens + (b.inputTokens ?? 0),
    outputTokens: a.outputTokens + (b.outputTokens ?? 0),
    cacheReadTokens: a.cacheReadTokens + (b.cacheReadTokens ?? 0),
    cacheWriteTokens: a.cacheWriteTokens + (b.cacheWriteTokens ?? 0),
  };
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Rough token estimate (≈4 chars/token) used only for DEMO cost simulation. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
