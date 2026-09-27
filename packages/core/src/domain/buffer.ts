/**
 * Content buffer math (pure). The system keeps `target` pieces of content
 * ready/scheduled ahead of publication, without ever exceeding the daily
 * generation limit — so a bug can never produce hundreds of videos.
 */
export interface BufferInput {
  readyOrScheduled: number;
  inProgress: number;
  /** Contents promised by strategy jobs that have not created their rows yet. */
  pendingPlanned: number;
  target: number;
  generatedToday: number;
  maxGeneratedPerDay: number;
}

export interface BufferResult {
  available: number;
  deficit: number;
  remainingToday: number;
  toCreate: number;
}

export function computeBufferNeed(i: BufferInput): BufferResult {
  const available = i.readyOrScheduled + i.inProgress + i.pendingPlanned;
  const deficit = Math.max(0, i.target - available);
  const remainingToday = Math.max(0, i.maxGeneratedPerDay - i.generatedToday - i.pendingPlanned);
  return { available, deficit, remainingToday, toCreate: Math.min(deficit, remainingToday) };
}

/** Metrics sync cadence: frequent while a post is young, then rarer, then stop. */
export function nextMetricsSyncDelayHours(ageHours: number): number | null {
  if (ageHours < 24) return 2;
  if (ageHours < 72) return 6;
  if (ageHours < 24 * 7) return 24;
  if (ageHours < 24 * 30) return 72;
  return null;
}
