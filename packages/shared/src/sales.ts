import { normalizeText } from "./similarity";
import type { LeadSignal } from "./schemas/agents";

/* ------------------------------------------------------------------ */
/* Opt-out detection (deterministic, runs BEFORE any AI call)          */
/* ------------------------------------------------------------------ */

/** Phrases that are an unambiguous request to stop, anywhere in the message. */
const OPT_OUT_PHRASES = [
  /\bpar[ae]r? de (me )?(mandar|enviar|chamar|mandarem|enviarem)\b/,
  /\bnao (me )?(mande|mandem|envie|envie|enviem|chame|chamem)( mais)?\b.*\b(mensag|msg|nada|isso|whats|zap)/,
  /\bnao (me )?(mande|mandem|envie|enviem) mais\b/,
  /\bnao (quero|desejo) (mais )?(receber|mensag|contato|que me)/,
  /\bnao (entre|entrem) (mais )?em contato\b/,
  /\b(sair|me tira|me tire|remova|remover|tirar) (da|dessa|desta|meu numero da|me da) lista\b/,
  /\bdescadastr/,
  /\bme (remova|remove|exclua|tira|tire)\b/,
  /\bunsubscribe\b/,
  /\bstop (messaging|texting|sending|contacting)\b/,
  /\bdo not (contact|message|text) me\b/,
  /\bno me (escribas|envies|mandes)( mas)?\b/,
  /\bchega de mensag/,
  /\bpara de me encher\b/,
];

/** Very short messages that consist only of a stop word (optionally + filler). */
const OPT_OUT_WHOLE = /^(pare|para|parar|stop|chega|sair|cancelar|nao quero|nao quero mais|nao tenho interesse mais|basta)( (por favor|pfv|pf|obrigad[oa]|mais|ja|agora))*$/;

export interface OptOutResult {
  optOut: boolean;
  matched: string | null;
}

export function detectOptOut(message: string): OptOutResult {
  const t = normalizeText(message);
  if (!t) return { optOut: false, matched: null };
  if (OPT_OUT_WHOLE.test(t)) return { optOut: true, matched: t };
  for (const re of OPT_OUT_PHRASES) {
    const m = t.match(re);
    if (m) return { optOut: true, matched: m[0] };
  }
  return { optOut: false, matched: null };
}

/* ------------------------------------------------------------------ */
/* Lead scoring (0–100). A transparent internal score, NOT a           */
/* "probability of purchase".                                          */
/* ------------------------------------------------------------------ */

export type ScoreFactor =
  | LeadSignal
  | "BASE"
  | "HAS_PHONE"
  | "HAS_EMAIL"
  | "REPLIED"
  | "MULTI_MESSAGE"
  | "QUALIFIED"
  | "CHECKOUT_CREATED"
  | "ATTRIBUTED_SOURCE";

export const DEFAULT_SCORE_WEIGHTS: Record<ScoreFactor, number> = {
  BASE: 10,
  HAS_PHONE: 5,
  HAS_EMAIL: 5,
  REPLIED: 10,
  MULTI_MESSAGE: 5,
  ATTRIBUTED_SOURCE: 5,
  QUALIFIED: 15,
  CHECKOUT_CREATED: 15,
  ASKED_PRICE: 12,
  ASKED_HOW_TO_BUY: 18,
  MENTIONED_BUDGET: 8,
  HAS_URGENCY: 10,
  DECISION_MAKER: 8,
  POSITIVE_SENTIMENT: 5,
  NEGATIVE_SENTIMENT: -10,
  PRICE_OBJECTION: -4,
  TRUST_OBJECTION: -4,
  TIMING_OBJECTION: -6,
  COMPETITOR_MENTION: 0,
  REQUESTED_HUMAN: 3,
  SHARED_CONTACT_INFO: 5,
  NOT_A_FIT: -35,
};

export interface LeadScoreInput {
  hasPhone: boolean;
  hasEmail: boolean;
  inboundMessages: number;
  qualified: boolean;
  checkoutCreated: boolean;
  attributed: boolean;
  signals: LeadSignal[];
}

export interface LeadScoreResult {
  score: number;
  breakdown: { factor: ScoreFactor; points: number }[];
}

export function computeLeadScore(input: LeadScoreInput, weightOverrides?: Partial<Record<string, number>>): LeadScoreResult {
  const w = { ...DEFAULT_SCORE_WEIGHTS, ...(weightOverrides ?? {}) } as Record<ScoreFactor, number>;
  const breakdown: { factor: ScoreFactor; points: number }[] = [{ factor: "BASE", points: w.BASE }];
  const add = (factor: ScoreFactor, on: boolean) => {
    if (on && w[factor] !== 0) breakdown.push({ factor, points: w[factor] });
  };
  add("HAS_PHONE", input.hasPhone);
  add("HAS_EMAIL", input.hasEmail);
  add("REPLIED", input.inboundMessages >= 1);
  add("MULTI_MESSAGE", input.inboundMessages >= 3);
  add("ATTRIBUTED_SOURCE", input.attributed);
  add("QUALIFIED", input.qualified);
  add("CHECKOUT_CREATED", input.checkoutCreated);
  for (const s of new Set(input.signals)) add(s, true);
  const raw = breakdown.reduce((sum, b) => sum + b.points, 0);
  return { score: Math.max(0, Math.min(100, Math.round(raw))), breakdown };
}

/* ------------------------------------------------------------------ */
/* Price guard: the Sales Agent may never quote a price that is not    */
/* in Product Knowledge (or a discount above the configured maximum).  */
/* ------------------------------------------------------------------ */

export function extractPricesCents(text: string): number[] {
  const out: number[] = [];
  const re = /(?:R\$|US\$|\$|€)\s?(\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g;
  for (const m of text.matchAll(re)) {
    let num = m[1]!.replace(/\s/g, "");
    if (/,\d{1,2}$/.test(num)) num = num.replace(/\./g, "").replace(",", ".");
    else if (/\.\d{3}/.test(num)) num = num.replace(/\./g, "");
    const v = Number(num);
    if (Number.isFinite(v)) out.push(Math.round(v * 100));
  }
  return out;
}

export function findUnknownPrices(text: string, allowedCents: number[], maxDiscountPct: number): number[] {
  const prices = extractPricesCents(text);
  return prices.filter((p) => {
    return !allowedCents.some((a) => {
      if (p === a) return true;
      // allow discounted prices within the configured maximum discount
      return p < a && p >= Math.round(a * (1 - maxDiscountPct / 100)) - 1;
    });
  });
}
