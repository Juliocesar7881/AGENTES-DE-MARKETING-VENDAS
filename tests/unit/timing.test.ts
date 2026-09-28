import { describe, expect, it } from "vitest";
import { bestTimeNear, bestWindows, buildTimingModel, pickDailyTimes, priorScore, type TimingObservation } from "@revenueos/shared";

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

describe("smart posting times — priors", () => {
  it("evenings and lunch beat the early morning on Instagram/TikTok", () => {
    const nets = ["INSTAGRAM", "TIKTOK"] as const;
    expect(priorScore([...nets], 3, 19)).toBeGreaterThan(priorScore([...nets], 3, 7));
    expect(priorScore([...nets], 3, 12)).toBeGreaterThan(priorScore([...nets], 3, 9));
    expect(priorScore(["TIKTOK"], 3, 21)).toBeGreaterThan(priorScore(["INSTAGRAM"], 3, 21) - 0.001);
  });

  it("adapts to the segment: restaurants before meals, B2B on weekdays", () => {
    expect(priorScore(["INSTAGRAM"], 3, 11, "restaurante e delivery")).toBeGreaterThan(priorScore(["INSTAGRAM"], 3, 11, ""));
    expect(priorScore(["INSTAGRAM"], 6, 19, "software B2B")).toBeLessThan(priorScore(["INSTAGRAM"], 6, 19, ""));
  });
});

describe("smart posting times — daily plan", () => {
  const model = buildTimingModel({ platforms: ["INSTAGRAM", "TIKTOK"], industry: "escola infantil" });

  it("posts ~15 min before the peak, with a minimum gap, inside the allowed window", () => {
    const times = pickDailyTimes(model, { weekday: 2, count: 2, seed: "ws:2026-10-06", explore: 0 });
    expect(times).toHaveLength(2);
    for (const t of times) {
      expect(t.endsWith(":45")).toBe(true);
      expect(mins(t)).toBeGreaterThanOrEqual(6 * 60 + 45);
      expect(mins(t)).toBeLessThanOrEqual(22 * 60 + 45);
    }
    expect(Math.abs(mins(times[1]!) - mins(times[0]!))).toBeGreaterThanOrEqual(180);
    // Weekday evening peak is part of the plan.
    expect(times.some((t) => mins(t) >= 17 * 60 && mins(t) <= 21 * 60)).toBe(true);
  });

  it("is deterministic per day and avoids times already taken", () => {
    const a = pickDailyTimes(model, { weekday: 4, count: 3, seed: "ws:2026-10-08" });
    const b = pickDailyTimes(model, { weekday: 4, count: 3, seed: "ws:2026-10-08" });
    expect(a).toEqual(b);
    const more = pickDailyTimes(model, { weekday: 4, count: 1, seed: "ws:2026-10-08", existing: a, explore: 0 });
    for (const t of more) for (const e of a) expect(Math.abs(mins(t) - mins(e))).toBeGreaterThanOrEqual(180);
  });

  it("explores untested but plausible hours sometimes", () => {
    const explored = new Set<string>();
    for (let d = 1; d <= 20; d++) for (const t of pickDailyTimes(model, { weekday: 2, count: 1, seed: `ws:${d}`, explore: 1 })) explored.add(t);
    expect(explored.size).toBeGreaterThan(1);
  });
});

describe("smart posting times — learning from the business's own results", () => {
  it("moves the plan towards hours that actually brought views and leads", () => {
    const obs: TimingObservation[] = [];
    // Lunchtime posts do great (and bring leads); evening posts flop — for this particular audience.
    for (let i = 0; i < 12; i++) obs.push({ platform: "INSTAGRAM", weekday: 1 + (i % 5), hour: 12, views: 4000 + i * 50, leads: 2 });
    for (let i = 0; i < 12; i++) obs.push({ platform: "INSTAGRAM", weekday: 1 + (i % 5), hour: 19, views: 300 + i * 10, leads: 0 });
    const prior = buildTimingModel({ platforms: ["INSTAGRAM"] });
    const learned = buildTimingModel({ platforms: ["INSTAGRAM"], observations: obs });
    expect(prior.score[0]![19]!).toBeGreaterThan(prior.score[0]![12]!);
    expect(learned.learned).toBe(true);
    expect(learned.score[0]![12]!).toBeGreaterThan(learned.score[0]![19]!);
    const plan = pickDailyTimes(learned, { weekday: 3, count: 1, seed: "x", explore: 0 });
    expect(plan).toEqual(["11:45"]);
    const top = bestWindows(learned).filter((w) => w.dayType === "weekday");
    expect(top.some((w) => w.hour === 12 && w.learned)).toBe(true);
  });

  it("few posts do not override the typical peaks (shrinkage)", () => {
    const m = buildTimingModel({ platforms: ["INSTAGRAM"], observations: [{ platform: "INSTAGRAM", weekday: 2, hour: 8, views: 9000 }, { platform: "INSTAGRAM", weekday: 2, hour: 19, views: 100 }] });
    expect(m.learned).toBe(false);
    expect(m.score[0]![19]!).toBeGreaterThan(m.score[0]![8]!);
  });
});

describe("per-network fine tuning", () => {
  it("each network moves to its own best moment within ±90 minutes", () => {
    const tiktok = bestTimeNear("TIKTOK", 3, "18:45");
    expect(Math.abs(mins(tiktok) - mins("18:45"))).toBeLessThanOrEqual(90);
    expect(mins(tiktok)).toBeGreaterThanOrEqual(mins("18:45")); // TikTok peaks later in the evening
    const fb = bestTimeNear("FACEBOOK", 3, "11:45");
    expect(Math.abs(mins(fb) - mins("11:45"))).toBeLessThanOrEqual(90);
  });
});
