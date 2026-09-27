/**
 * Content fatigue detection. We fingerprint the creative decisions of each
 * content (hook, script, template, angle) and compare new content against the
 * recent history of the same workspace. Pure functions, no AI calls.
 */

const STOPWORDS = new Set(
  "a o as os um uma uns umas de da do das dos e em no na nos nas por para com sem que se seu sua seus suas é ser ter mais muito pra pro the of to and in on for with is are you your this that it be".split(" "),
);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function shingles(text: string, size = 2): Set<string> {
  const t = tokens(text);
  const out = new Set<string>();
  if (t.length === 0) return out;
  if (t.length < size) {
    out.add(t.join(" "));
    return out;
  }
  for (let i = 0; i <= t.length - size; i++) out.add(t.slice(i, i + size).join(" "));
  // unigrams too, so short hooks still compare meaningfully
  for (const w of t) out.add(w);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface ContentFingerprint {
  hook: string;
  script: string;
  templateId: string;
  angle: string;
}

export interface SimilarityBreakdown {
  score: number;
  hook: number;
  script: number;
  template: number;
  angle: number;
}

export const SIMILARITY_WEIGHTS = { hook: 0.4, script: 0.3, template: 0.1, angle: 0.2 } as const;
/** Above this score, new content is considered too similar and must be regenerated. */
export const SIMILARITY_THRESHOLD = 0.72;

export function compareFingerprints(a: ContentFingerprint, b: ContentFingerprint): SimilarityBreakdown {
  const hook = jaccard(shingles(a.hook), shingles(b.hook));
  const script = jaccard(shingles(a.script), shingles(b.script));
  const template = a.templateId === b.templateId ? 1 : 0;
  const angle = jaccard(shingles(a.angle), shingles(b.angle));
  const score =
    hook * SIMILARITY_WEIGHTS.hook +
    script * SIMILARITY_WEIGHTS.script +
    template * SIMILARITY_WEIGHTS.template +
    angle * SIMILARITY_WEIGHTS.angle;
  return { score: Math.round(score * 1000) / 1000, hook, script, template, angle };
}

export function maxSimilarity(
  candidate: ContentFingerprint,
  history: (ContentFingerprint & { id: string })[],
): { id: string | null; breakdown: SimilarityBreakdown } {
  let best: { id: string | null; breakdown: SimilarityBreakdown } = {
    id: null,
    breakdown: { score: 0, hook: 0, script: 0, template: 0, angle: 0 },
  };
  for (const h of history) {
    const b = compareFingerprints(candidate, h);
    if (b.score > best.breakdown.score) best = { id: h.id, breakdown: b };
  }
  return best;
}
