/*
 * Smart posting times (pure, unit-tested).
 *
 * 1. PRIOR — typical audience activity per network (local time of the business),
 *    weekday vs. weekend, adjusted by segment (e.g. restaurants peak before meals,
 *    B2B in office hours, schools/parents in the evening).
 * 2. LEARNING — the business's own results: each published post's views (relative
 *    to that account's median) and leads/clicks, credited to the local hour it went
 *    out, smoothed across neighbouring hours and shrunk towards the prior until
 *    there is enough data.
 * 3. EXPLORATION — a small, deterministic share of slots tests promising hours that
 *    have little data, so the model keeps learning instead of repeating itself.
 * Posts go out ~15 minutes BEFORE the peak hour, so the video is processed and
 * already being distributed when the audience arrives.
 */

export type TimingPlatform = "INSTAGRAM" | "TIKTOK" | "YOUTUBE" | "FACEBOOK";
export type PostingMode = "smart" | "fixed" | "asap";
export const POSTING_MODES = ["smart", "fixed", "asap"] as const;

type Curve = number[]; // 24 values, 0..1, index = local hour

// prettier-ignore
const PRIORS: Record<TimingPlatform, { weekday: Curve; weekend: Curve }> = {
  INSTAGRAM: {
    weekday: [0.12, 0.06, 0.04, 0.03, 0.04, 0.1, 0.25, 0.42, 0.5, 0.5, 0.55, 0.7, 0.85, 0.75, 0.55, 0.5, 0.55, 0.65, 0.85, 1, 0.95, 0.8, 0.55, 0.3],
    weekend: [0.15, 0.08, 0.05, 0.03, 0.03, 0.05, 0.12, 0.22, 0.32, 0.45, 0.65, 0.8, 0.8, 0.7, 0.6, 0.55, 0.55, 0.6, 0.7, 0.85, 0.9, 0.8, 0.6, 0.35],
  },
  TIKTOK: {
    weekday: [0.35, 0.2, 0.1, 0.06, 0.05, 0.08, 0.2, 0.35, 0.4, 0.4, 0.45, 0.55, 0.75, 0.7, 0.5, 0.5, 0.55, 0.65, 0.8, 0.9, 1, 1, 0.85, 0.6],
    weekend: [0.45, 0.3, 0.15, 0.08, 0.05, 0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 0.7, 0.75, 0.75, 0.7, 0.65, 0.65, 0.7, 0.8, 0.9, 1, 0.95, 0.85, 0.65],
  },
  YOUTUBE: {
    weekday: [0.2, 0.1, 0.06, 0.04, 0.04, 0.06, 0.15, 0.3, 0.38, 0.4, 0.45, 0.55, 0.7, 0.65, 0.6, 0.65, 0.7, 0.75, 0.85, 0.95, 1, 0.9, 0.7, 0.4],
    weekend: [0.25, 0.12, 0.06, 0.04, 0.04, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.75, 0.8, 0.8, 0.75, 0.75, 0.75, 0.8, 0.85, 0.95, 1, 0.9, 0.7, 0.45],
  },
  FACEBOOK: {
    weekday: [0.08, 0.04, 0.03, 0.03, 0.04, 0.1, 0.3, 0.5, 0.6, 0.7, 0.7, 0.75, 0.85, 0.8, 0.65, 0.6, 0.6, 0.65, 0.75, 0.9, 0.85, 0.7, 0.45, 0.2],
    weekend: [0.1, 0.05, 0.03, 0.03, 0.03, 0.05, 0.15, 0.3, 0.45, 0.6, 0.7, 0.75, 0.75, 0.7, 0.6, 0.55, 0.55, 0.6, 0.7, 0.8, 0.8, 0.65, 0.45, 0.25],
  },
};

interface SegmentRule {
  match: RegExp;
  label: string;
  boost: (weekend: boolean, hour: number) => number;
}

const in_ = (h: number, from: number, to: number) => h >= from && h <= to;

const SEGMENTS: SegmentRule[] = [
  { match: /restaur|lanch|pizz|delivery|comida|food|hamburg|a[cç]a[ií]|padaria|cafe|café|bar\b/i, label: "food", boost: (_w, h) => (in_(h, 10, 11) || in_(h, 17, 19) ? 1.3 : 1) },
  { match: /b2b|saas|software|consult|contab|jur[ií]dic|advoca|empresa|marketing|agenc/i, label: "b2b", boost: (w, h) => (w ? 0.65 : in_(h, 8, 10) || in_(h, 12, 13) || in_(h, 17, 18) ? 1.25 : 1) },
  { match: /escola|infantil|educa|curso|col[eé]gio|creche|professor/i, label: "education", boost: (w, h) => (in_(h, 19, 21) ? 1.15 : w && in_(h, 9, 11) ? 1.1 : in_(h, 6, 7) ? 1.1 : 1) },
  { match: /cl[ií]nic|odont|dent|sa[uú]de|m[eé]dic|est[eé]tic|fisio|psic|nutri/i, label: "health", boost: (_w, h) => (in_(h, 12, 13) || in_(h, 19, 21) ? 1.12 : 1) },
  { match: /oficina|auto|carro|ve[ií]cul|moto|mec[aâ]nic/i, label: "automotive", boost: (w, h) => (in_(h, 18, 21) ? 1.12 : w && in_(h, 8, 11) ? 1.2 : 1) },
  { match: /academ|fitness|gym|crossfit|personal|yoga|pilates/i, label: "fitness", boost: (_w, h) => (in_(h, 6, 7) || in_(h, 17, 19) ? 1.2 : 1) },
  { match: /beleza|sal[aã]o|moda|loja|ecommerce|e-commerce|cosm[eé]t|roupa|acess[oó]r/i, label: "retail", boost: (w, h) => (in_(h, 19, 22) ? 1.1 : w ? 1.08 : 1) },
];

export function segmentOf(industry: string): string | null {
  return SEGMENTS.find((s) => s.match.test(industry))?.label ?? null;
}

/** Prior 0..1 for a local weekday (0 = Sunday) and hour, averaged over the target networks. */
export function priorScore(platforms: TimingPlatform[], weekday: number, hour: number, industry = ""): number {
  const nets = platforms.length ? platforms : (["INSTAGRAM"] as TimingPlatform[]);
  const weekend = weekday === 0 || weekday === 6;
  const base = nets.reduce((s, p) => s + (weekend ? PRIORS[p].weekend : PRIORS[p].weekday)[hour]!, 0) / nets.length;
  const seg = SEGMENTS.find((s) => s.match.test(industry));
  return Math.min(1, base * (seg ? seg.boost(weekend, hour) : 1));
}

/** One published post: when it went out (local) and how it did. */
export interface TimingObservation {
  platform: TimingPlatform;
  weekday: number;
  hour: number;
  views: number;
  leads?: number;
  clicks?: number;
}

export interface TimingModel {
  /** [dayType 0 = weekday, 1 = weekend][hour] → expected relative score (prior × learned multiplier). */
  score: number[][];
  /** Effective number of observations per cell (after smoothing). */
  support: number[][];
  observations: number;
  segment: string | null;
  /** true once the business's own data meaningfully moves the curve. */
  learned: boolean;
}

const PSEUDO_COUNT = 3;

/** Relative performance of a post vs. the median of the same network (log2 scale, clamped). */
function relativeScores(obs: TimingObservation[]): number[] {
  const byNet = new Map<TimingPlatform, number[]>();
  for (const o of obs) byNet.set(o.platform, [...(byNet.get(o.platform) ?? []), o.views]);
  const median = new Map<TimingPlatform, number>();
  for (const [p, v] of byNet) {
    const s = [...v].sort((a, b) => a - b);
    median.set(p, s[Math.floor(s.length / 2)] ?? 0);
  }
  return obs.map((o) => {
    const rel = Math.log2((o.views + 10) / ((median.get(o.platform) ?? 0) + 10));
    const conv = 0.6 * Math.log2(1 + (o.leads ?? 0)) + 0.15 * Math.log2(1 + (o.clicks ?? 0));
    return Math.max(-2, Math.min(2, rel + conv));
  });
}

export function buildTimingModel(opts: { platforms: TimingPlatform[]; industry?: string; observations?: TimingObservation[] }): TimingModel {
  const obs = opts.observations ?? [];
  const rel = relativeScores(obs);
  const sum = [Array(24).fill(0), Array(24).fill(0)];
  const weight = [Array(24).fill(0), Array(24).fill(0)];
  obs.forEach((o, i) => {
    const d = o.weekday === 0 || o.weekday === 6 ? 1 : 0;
    // Smooth across neighbouring hours: the audience does not switch off at :59.
    for (const [dh, w] of [[0, 1], [-1, 0.5], [1, 0.5], [-2, 0.2], [2, 0.2]] as const) {
      const h = o.hour + dh;
      if (h < 0 || h > 23) continue;
      sum[d]![h] += w * rel[i]!;
      weight[d]![h] += w;
    }
  });
  const score = [0, 1].map((d) =>
    Array.from({ length: 24 }, (_, h) => {
      const prior = priorScore(opts.platforms, d === 1 ? 6 : 3, h, opts.industry);
      const adj = sum[d]![h] / (PSEUDO_COUNT + weight[d]![h]);
      return prior * Math.pow(2, 0.6 * adj);
    }),
  );
  const learned = obs.length >= 8 && weight.flat().filter((w) => w >= 1).length >= 3;
  return { score, support: weight, observations: obs.length, segment: segmentOf(opts.industry ?? ""), learned };
}

/** Deterministic PRNG (mulberry32) so the same day always gets the same plan. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toHHMM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Minutes before the peak hour at which the post goes out. */
export const LEAD_BEFORE_PEAK_MIN = 15;

/**
 * Times (HH:MM, local) for one day. Picks the best hours by expected score with a
 * little Thompson-style noise (more where data is scarce), keeps a minimum gap
 * between posts and away from times already taken, and occasionally explores a
 * plausible hour that has not been tried.
 */
export function pickDailyTimes(
  model: TimingModel,
  opts: { weekday: number; count: number; seed: string; existing?: string[]; earliestHour?: number; latestHour?: number; minGapHours?: number; explore?: number },
): string[] {
  if (opts.count <= 0) return [];
  const d = opts.weekday === 0 || opts.weekday === 6 ? 1 : 0;
  const rnd = seededRandom(opts.seed);
  const earliest = opts.earliestHour ?? 7;
  const latest = opts.latestHour ?? 23;
  const gap = (opts.minGapHours ?? (opts.count <= 3 ? 3 : Math.max(1, Math.floor(16 / (opts.count + 1))))) * 60;
  const taken = (opts.existing ?? []).map(minutesOf);
  const candidates = Array.from({ length: latest - earliest + 1 }, (_, i) => earliest + i).map((h) => {
    const s = model.score[d]![h]!;
    const uncertainty = 0.35 / Math.sqrt(1 + model.support[d]![h]!);
    const noise = (rnd() + rnd() + rnd() - 1.5) * uncertainty; // ~N(0, σ)
    return { h, s, sample: s * (1 + noise), support: model.support[d]![h]! };
  });
  const out: number[] = [];
  const fits = (min: number) => [...taken, ...out].every((t) => Math.abs(t - min) >= gap);
  const at = (h: number) => h * 60 - LEAD_BEFORE_PEAK_MIN;
  // Exploration slot: a plausible hour (≥ 60% of the best) with little data.
  const explore = opts.explore ?? 0.15;
  if (opts.count >= 1 && rnd() < explore) {
    const best = Math.max(...candidates.map((c) => c.s));
    const pool = candidates.filter((c) => c.s >= 0.6 * best && c.support < 1.5 && fits(at(c.h)));
    if (pool.length) out.push(at(pool[Math.floor(rnd() * pool.length)]!.h));
  }
  for (const c of [...candidates].sort((a, b) => b.sample - a.sample)) {
    if (out.length >= opts.count) break;
    const m = at(c.h);
    if (fits(m)) out.push(m);
  }
  return out.sort((a, b) => a - b).map(toHHMM);
}

/** Human summary of the best windows, for the dashboard. */
export function bestWindows(model: TimingModel, top = 3): { dayType: "weekday" | "weekend"; hour: number; score: number; learned: boolean }[] {
  const cells: { dayType: "weekday" | "weekend"; hour: number; score: number; learned: boolean }[] = [];
  model.score.forEach((row, d) =>
    row.forEach((s, h) => {
      if (h >= 7 && h <= 23) cells.push({ dayType: d === 1 ? "weekend" : "weekday", hour: h, score: s, learned: model.support[d]![h]! >= 1 });
    }),
  );
  const pick = (dt: "weekday" | "weekend") => {
    const chosen: typeof cells = [];
    for (const c of cells.filter((x) => x.dayType === dt).sort((a, b) => b.score - a.score)) {
      if (chosen.length >= top) break;
      if (chosen.every((x) => Math.abs(x.hour - c.hour) >= 2)) chosen.push(c);
    }
    return chosen.sort((a, b) => a.hour - b.hour);
  };
  return [...pick("weekday"), ...pick("weekend")];
}

/** Best local time within ±`windowMin` of a base time for ONE network (per-network fine tuning). */
export function bestTimeNear(platform: TimingPlatform, weekday: number, baseHHMM: string, industry = "", windowMin = 90): string {
  const base = minutesOf(baseHHMM);
  let best = { m: base, s: -1 };
  for (let dm = -windowMin; dm <= windowMin; dm += 15) {
    const m = base + dm;
    if (m < 6 * 60 || m > 23 * 60 + 45) continue;
    const peakHour = Math.floor((m + LEAD_BEFORE_PEAK_MIN) / 60) % 24;
    // Prefer staying close to the shared time when the curve is flat.
    const s = priorScore([platform], weekday, peakHour, industry) - Math.abs(dm) / 2000;
    if (s > best.s) best = { m, s };
  }
  return toHHMM(best.m);
}
