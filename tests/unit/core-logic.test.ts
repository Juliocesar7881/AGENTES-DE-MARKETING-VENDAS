import { describe, expect, it } from "vitest";
import { canTransitionContent, canTransitionPost, computeBufferNeed, extractFromHtml, nextLeadStage, nextMetricsSyncDelayHours, policy } from "@revenueos/core";
import { DEFAULT_AUTOPILOT_PERMISSIONS } from "@revenueos/shared";

describe("content buffer", () => {
  it("fills the deficit but never exceeds the daily generation cap", () => {
    expect(computeBufferNeed({ readyOrScheduled: 0, inProgress: 0, pendingPlanned: 0, target: 4, generatedToday: 0, maxGeneratedPerDay: 4 }).toCreate).toBe(4);
    expect(computeBufferNeed({ readyOrScheduled: 1, inProgress: 1, pendingPlanned: 0, target: 4, generatedToday: 3, maxGeneratedPerDay: 4 }).toCreate).toBe(1);
    expect(computeBufferNeed({ readyOrScheduled: 0, inProgress: 0, pendingPlanned: 2, target: 4, generatedToday: 2, maxGeneratedPerDay: 4 }).toCreate).toBe(0);
    expect(computeBufferNeed({ readyOrScheduled: 6, inProgress: 0, pendingPlanned: 0, target: 4, generatedToday: 0, maxGeneratedPerDay: 4 }).toCreate).toBe(0);
  });
});

describe("autopilot policy", () => {
  const ws = (mode: "MANUAL" | "ASSISTED" | "AUTOPILOT", status: "ACTIVE" | "PAUSED" = "ACTIVE") => ({ operatingMode: mode, autopilotPermissions: DEFAULT_AUTOPILOT_PERMISSIONS, status });
  it("MANUAL denies all automation, humans are always allowed", () => {
    expect(policy(ws("MANUAL"), "publishContent", "AUTOMATION")).toBe("DENY");
    expect(policy(ws("MANUAL"), "generateContent", "AUTOMATION")).toBe("DENY");
    expect(policy(ws("MANUAL"), "publishContent", "HUMAN")).toBe("ALLOW");
  });
  it("ASSISTED requires approval for publishing and checkout", () => {
    expect(policy(ws("ASSISTED"), "generateContent", "AUTOMATION")).toBe("ALLOW");
    expect(policy(ws("ASSISTED"), "publishContent", "AUTOMATION")).toBe("APPROVAL");
    expect(policy(ws("ASSISTED"), "sendCheckout", "AUTOMATION")).toBe("APPROVAL");
  });
  it("AUTOPILOT follows permissions; paused businesses do nothing", () => {
    expect(policy(ws("AUTOPILOT"), "publishContent", "AUTOMATION")).toBe("ALLOW");
    expect(policy({ ...ws("AUTOPILOT"), autopilotPermissions: { ...DEFAULT_AUTOPILOT_PERMISSIONS, publishContent: false } }, "publishContent", "AUTOMATION")).toBe("APPROVAL");
    expect(policy({ ...ws("AUTOPILOT"), autopilotPermissions: { ...DEFAULT_AUTOPILOT_PERMISSIONS, replyLeads: false } }, "replyLeads", "AUTOMATION")).toBe("DENY");
    expect(policy(ws("AUTOPILOT", "PAUSED"), "replyLeads", "AUTOMATION")).toBe("DENY");
  });
});

describe("state machines", () => {
  it("content cannot skip rendering or go back after publishing", () => {
    expect(canTransitionContent("READY_TO_RENDER", "RENDERING")).toBe(true);
    expect(canTransitionContent("IDEA", "PUBLISHED")).toBe(false);
    expect(canTransitionContent("PUBLISHED", "GENERATING")).toBe(false);
  });
  it("published posts are final", () => {
    expect(canTransitionPost("QUEUED", "UPLOADING")).toBe(true);
    expect(canTransitionPost("PUBLISHED", "FAILED")).toBe(false);
  });
  it("automatic lead stage moves only forward and never to WON", () => {
    expect(nextLeadStage("ENGAGED", "CONTACTED", { automatic: true })).toBe("ENGAGED");
    expect(nextLeadStage("ENGAGED", "QUALIFIED", { automatic: true })).toBe("QUALIFIED");
    expect(nextLeadStage("CHECKOUT", "WON", { automatic: true })).not.toBe("WON");
  });
});

describe("metrics sync cadence", () => {
  it("syncs often while young, then stops", () => {
    expect(nextMetricsSyncDelayHours(1)).toBe(2);
    expect(nextMetricsSyncDelayHours(48)).toBe(6);
    expect(nextMetricsSyncDelayHours(24 * 40)).toBeNull();
  });
});

describe("website analyzer extraction", () => {
  it("extracts name, colors, prices and headings from public HTML", () => {
    const html = `<html><head><title>Clínica Sorriso | Dentista em SP</title><meta name="description" content="Avaliação completa"><meta name="theme-color" content="#12AB34"><style>.btn{background:#ff6600}</style></head><body><h1>Seu sorriso em boas mãos</h1><p>Consulta R$ 99,00</p><a href="javascript:alert(1)">x</a></body></html>`;
    const r = extractFromHtml(html, "https://clinica.example");
    expect(r.name).toMatch(/Clínica Sorriso/);
    expect(r.description).toBe("Avaliação completa");
    expect(r.colors).toContain("#12ab34");
    expect(r.prices.join(" ")).toMatch(/99/);
    expect(r.headings).toContain("Seu sorriso em boas mãos");
  });
});
