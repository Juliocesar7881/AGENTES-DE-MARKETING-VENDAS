import { describe, expect, it } from "vitest";
import {
  classifyConfidence,
  compareFingerprints,
  computeLeadScore,
  detectOptOut,
  findUnknownPrices,
  generateSlots,
  isWithinBusinessHours,
  localDateString,
  localTimeString,
  normalizeVideoSpecTiming,
  redact,
  redactString,
  SIMILARITY_THRESHOLD,
  twoProportionZ,
  VideoSpecSchema,
  zonedToUtc,
} from "@revenueos/shared";
import { SAMPLE_SPEC } from "@revenueos/video-engine";

describe("VideoSpec schema", () => {
  it("accepts the sample spec", () => {
    expect(VideoSpecSchema.safeParse(SAMPLE_SPEC).success).toBe(true);
  });

  it("rejects gaps between scenes", () => {
    const spec = structuredClone(SAMPLE_SPEC);
    spec.scenes[1]!.start += 2;
    expect(VideoSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("normalizes small timing drift instead of failing", () => {
    const spec = structuredClone(SAMPLE_SPEC);
    spec.scenes[1]!.start += 0.05;
    const fixed = normalizeVideoSpecTiming(spec);
    expect(VideoSpecSchema.safeParse(fixed).success).toBe(true);
  });

  it("rejects dimensions that do not match the format", () => {
    const spec = { ...structuredClone(SAMPLE_SPEC), width: 1920, height: 1080 };
    expect(VideoSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects references to unknown assets", () => {
    const spec = structuredClone(SAMPLE_SPEC);
    spec.scenes[0]!.assets = ["does-not-exist"];
    expect(VideoSpecSchema.safeParse(spec).success).toBe(false);
  });
});

describe("opt-out detection (runs before any AI call)", () => {
  it.each(["PARE", "parar por favor", "Sair", "stop", "não quero mais receber mensagens", "me tira dessa lista", "descadastrar"])("detects %s", (msg) => {
    expect(detectOptOut(msg).optOut).toBe(true);
  });
  it.each(["Qual o preço?", "Quero parar de sofrer com dor de dente", "Pode me mandar o link?", "sair de casa mais tarde"])("does not flag %s", (msg) => {
    expect(detectOptOut(msg).optOut).toBe(false);
  });
});

describe("lead score", () => {
  it("is bounded to 0–100 and explains every point", () => {
    const hot = computeLeadScore({ hasPhone: true, hasEmail: true, inboundMessages: 5, qualified: true, checkoutCreated: true, attributed: true, signals: ["ASKED_PRICE", "ASKED_HOW_TO_BUY", "HAS_URGENCY", "MENTIONED_BUDGET", "DECISION_MAKER", "POSITIVE_SENTIMENT"] });
    expect(hot.score).toBeLessThanOrEqual(100);
    expect(hot.score).toBeGreaterThan(70);
    const cold = computeLeadScore({ hasPhone: false, hasEmail: false, inboundMessages: 0, qualified: false, checkoutCreated: false, attributed: false, signals: ["NOT_A_FIT", "NEGATIVE_SENTIMENT"] });
    expect(cold.score).toBe(0);
    expect(hot.breakdown.find((b) => b.factor === "BASE")).toBeTruthy();
  });
});

describe("price guard for the Sales Agent", () => {
  it("allows catalog prices and discounts within the limit", () => {
    expect(findUnknownPrices("Fica R$ 99,00 à vista", [9900], 10)).toEqual([]);
    expect(findUnknownPrices("Com desconto sai por R$ 89,10", [9900], 10)).toEqual([]);
  });
  it("blocks invented prices", () => {
    expect(findUnknownPrices("Hoje sai por R$ 49,90", [9900], 10)).toEqual([4990]);
  });
});

describe("insight confidence rules", () => {
  it("labels small samples LOW_DATA", () => {
    expect(classifyConfidence({ contents: 2, exposures: 10000, events: 50, lift: 1, z: 5 })?.level).toBe("LOW_DATA");
    expect(classifyConfidence({ contents: 10, exposures: 300, events: 50, lift: 1, z: 5 })?.level).toBe("LOW_DATA");
  });
  it("requires statistics for STRONG_EVIDENCE", () => {
    expect(classifyConfidence({ contents: 12, exposures: 50000, events: 40, lift: 0.4, z: 3 })?.level).toBe("STRONG_EVIDENCE");
    expect(classifyConfidence({ contents: 12, exposures: 50000, events: 40, lift: 0.4, z: 1 })?.level).not.toBe("STRONG_EVIDENCE");
  });
  it("computes a two-proportion z-score", () => {
    const z = twoProportionZ(60, 1000, 30, 1000)!;
    expect(z).toBeGreaterThan(3);
    expect(twoProportionZ(1, 0, 1, 10)).toBeNull();
  });
});

describe("similarity / creative fatigue", () => {
  it("flags near-duplicates and allows new angles", () => {
    const a = { hook: "Você não precisa gastar mais com odontologia", script: "Avaliação completa com limpeza por 99 reais", templateId: "BOLD_TYPOGRAPHY", angle: "preço acessível" };
    expect(compareFingerprints(a, { ...a }).score).toBeGreaterThan(SIMILARITY_THRESHOLD);
    const b = { hook: "3 sinais de que seu filho precisa de reforço", script: "Rotina de estudos e acompanhamento", templateId: "LISTICLE", angle: "educação" };
    expect(compareFingerprints(a, b).score).toBeLessThan(0.3);
  });
});

describe("time zones & scheduling", () => {
  it("converts local São Paulo time to UTC", () => {
    expect(zonedToUtc("2026-09-28", "09:00", "America/Sao_Paulo").toISOString()).toBe("2026-09-28T12:00:00.000Z");
    const d = new Date("2026-09-28T23:30:00Z");
    expect(localDateString(d, "America/Sao_Paulo")).toBe("2026-09-28");
    expect(localTimeString(d, "America/Sao_Paulo")).toBe("20:30");
  });

  it("generates posting slots per workspace schedule", () => {
    const slots = generateSlots({ schedule: ["09:00", "18:00"], timezone: "America/Sao_Paulo", from: new Date("2026-09-28T10:00:00Z"), days: 2, postsPerDay: 2, minLeadMinutes: 0 });
    expect(slots.map((s) => s.localTime)).toEqual(["09:00", "18:00", "09:00", "18:00"]);
    expect(slots[0]!.scheduledFor.toISOString()).toBe("2026-09-28T12:00:00.000Z");
  });

  it("respects business hours", () => {
    const bh = { enabled: true, days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" };
    expect(isWithinBusinessHours(new Date("2026-09-28T13:00:00Z"), "America/Sao_Paulo", bh)).toBe(true); // Mon 10:00
    expect(isWithinBusinessHours(new Date("2026-09-28T23:00:00Z"), "America/Sao_Paulo", bh)).toBe(false); // Mon 20:00
    expect(isWithinBusinessHours(new Date("2026-09-27T13:00:00Z"), "America/Sao_Paulo", bh)).toBe(false); // Sunday
  });
});

describe("log redaction", () => {
  it("removes secrets from strings and objects", () => {
    const s = redactString("key sk-ant-api03-abcdefghijklmnopqrstuv and Bearer abc.def.ghijkl postgres://u:pass@host/db");
    expect(s).not.toContain("abcdefghijklmnop");
    expect(s).not.toContain("pass@");
    const o = redact({ accessToken: "EAAabcdefghijklmnopqrstuvwxyz", nested: { client_secret: "x", ok: "visible" } }) as Record<string, unknown>;
    expect(JSON.stringify(o)).not.toContain("EAAabcdef");
    expect(JSON.stringify(o)).toContain("visible");
  });
});
