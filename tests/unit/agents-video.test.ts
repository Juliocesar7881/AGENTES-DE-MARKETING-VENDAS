import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildVideoSpec, EMPTY_MEMORY, findForbidden, generateCreative, planContent, salesReply, validateSalesReply, type BusinessContext, type SalesInput } from "@revenueos/agents";
import { MockAIProvider } from "@revenueos/providers/ai";
import { detectOptOut, VideoSpecSchema, type SalesReplyOutput } from "@revenueos/shared";
import { fitFontSize, computeLayout } from "@revenueos/video-engine";
import { runContentQA } from "@revenueos/video-engine/qa";

const ctx: BusinessContext = {
  workspace: { id: randomUUID(), name: "Clínica Teste", industry: "odontologia", description: "Clínica de bairro", website: null, locale: "pt-BR", currency: "BRL", timezone: "America/Sao_Paulo", whatsappNumber: "5511999999999", targetPlatforms: ["INSTAGRAM", "TIKTOK", "YOUTUBE"] },
  brand: { businessName: "Clínica Teste", logoAssetId: null, primaryColor: "#2EE6A6", secondaryColor: "#7C6CFF", accentColor: "#FFB547", backgroundColor: "#0B0F14", textColor: "#F5F7FA", fontHeading: "Montserrat", fontBody: "Inter", tone: "acolhedor", style: "moderno", voice: "", handle: "@clinicateste", website: null, description: "Avaliação e limpeza", targetAudience: "adultos", keywords: ["sorriso"], forbiddenWords: ["garantido"], ctaPreferences: ["Agende pelo WhatsApp"] },
  audience: { targetAudience: "adultos 25-45", problems: ["medo de dentista"], goals: ["sorriso bonito"], valueProposition: "Atendimento sem dor", differentiators: ["horário estendido"] },
  products: [{ id: randomUUID(), name: "Avaliação + Limpeza", description: "Consulta completa", type: "SERVICE", priceCents: 9900, currency: "BRL", benefits: ["diagnóstico completo"], features: [], faq: [], limitations: [], offer: "", support: "", terms: "" }],
  assets: [],
};

const rt = { ai: new MockAIProvider({ prices: {} }), model: { model: "claude-opus-5", effort: "default" as const, maxTokens: 8000 } };
const perf: Parameters<typeof planContent>[2] = { periodDays: 30, totals: { contents: 0, views: 0, leads: 0, qualifiedLeads: 0, sales: 0, revenueCents: 0 }, recentContents: [], insights: [], memories: [], campaigns: [], weeklyStrategy: null };

describe("agent pipeline with the mock provider (same schemas as real Claude)", () => {
  it("plans content, writes creatives and builds valid VideoSpecs that pass QA", async () => {
    const plan = await planContent(rt, ctx, perf, { count: 3, seed: "t1" });
    expect(plan.result.data.briefs.length).toBe(3);
    for (const brief of plan.result.data.briefs) {
      const creative = await generateCreative(rt, ctx, brief, { maxDurationSec: 60, avoidHooks: [], seed: `c-${brief.hook}`, feedback: null });
      const spec = buildVideoSpec(creative.result.data.video, ctx, { specId: randomUUID(), contentId: randomUUID(), campaignId: null }, { generator: "mock", promptVersion: creative.promptVersion });
      expect(VideoSpecSchema.safeParse(spec).success).toBe(true);
      expect(spec.workspaceId).toBe(ctx.workspace.id);
      expect(findForbidden([spec.hook.text, ...spec.scenes.map((s) => s.headline)], ctx.brand.forbiddenWords)).toEqual([]);
      const qa = runContentQA({ spec, platforms: ["INSTAGRAM", "TIKTOK", "YOUTUBE"], copy: creative.result.data.copy, validation: null, frames: null, similarity: { score: 0.1, threshold: 0.72 }, missingAssets: [] });
      expect(qa.status).not.toBe("FAILED");
    }
  });

  it("fails loudly (retryable) when Claude times out", async () => {
    const timeout = { ai: new MockAIProvider({ failWith: "timeout" }), model: rt.model };
    await expect(planContent(timeout, ctx, perf, { count: 1, seed: "x" })).rejects.toMatchObject({ code: "AI_TIMEOUT", retryable: true });
  });
});

describe("Sales Agent guardrails", () => {
  const input = (msg: string): SalesInput => ({
    business: ctx,
    products: ctx.products,
    lead: { id: randomUUID(), name: "Ana", stage: "CONTACTED", productId: ctx.products[0]!.id, source: "INSTAGRAM", score: 30 },
    memory: EMPTY_MEMORY,
    messages: [{ sender: "LEAD", body: msg, at: new Date().toISOString() }],
    rules: { maxDiscountPct: 10, allowCheckout: true },
  });

  it("quotes only catalog prices", async () => {
    const r = await salesReply(rt, input("Quanto custa?"));
    expect(validateSalesReply(r.result.data, input("Quanto custa?"))).toEqual([]);
  });

  it("rejects invented prices, links and over-limit discounts", () => {
    const bad: SalesReplyOutput = {
      reply: "Hoje sai por R$ 49,90! Pague em https://evil.example",
      intent: "INTERESTED",
      signals: [],
      qualified: false,
      suggestedStage: "ENGAGED",
      requestCheckout: { productId: ctx.products[0]!.id, discountPct: 40 },
      handoffToHuman: false,
      handoffReason: null,
      sensitive: false,
      followUpInHours: null,
      memory: EMPTY_MEMORY,
    };
    const problems = validateSalesReply(bad, input("Quanto custa?"));
    expect(problems.join(" ")).toMatch(/prices not present/);
    expect(problems.join(" ")).toMatch(/links/);
    expect(problems.join(" ")).toMatch(/discountPct/);
  });

  it("opt-out is detected deterministically before the AI", () => {
    expect(detectOptOut("para de me mandar mensagem").optOut).toBe(true);
  });
});

describe("motion design layout", () => {
  it("keeps text inside platform safe zones", () => {
    const l = computeLayout(1080, 1920);
    expect(l.safe.top).toBeGreaterThanOrEqual(250);
    expect(1920 - l.safe.bottom).toBeGreaterThanOrEqual(440);
    expect(l.safe.right).toBeLessThan(1080 - 84);
  });
  it("detects text that cannot fit", () => {
    expect(fitFontSize("Texto curto", 900, 2, 120, 40).overflow).toBe(false);
    expect(fitFontSize("Supercalifragilisticexpialidociousssssssssssssssssss", 300, 1, 120, 80).overflow).toBe(true);
  });
});
