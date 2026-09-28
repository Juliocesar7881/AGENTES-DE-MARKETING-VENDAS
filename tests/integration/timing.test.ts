import { beforeAll, describe, expect, it } from "vitest";
import { ensureSlots, scheduleContent } from "@revenueos/core";
import { contents, eq, getDb, postingSlots, socialPosts, workspaces } from "@revenueos/database";
import { makeLiveBusiness, makeReadyContent, useDoubles } from "./helpers";

async function reload(id: string) {
  const [w] = await getDb().select().from(workspaces).where(eq(workspaces.id, id));
  return w!;
}

describe("posting times", () => {
  beforeAll(() => useDoubles());

  it("smart mode: each day gets postsPerDay slots at peak-minus-15 times, planned only once", async () => {
    const { ws } = await makeLiveBusiness("SmartTimes");
    expect(ws.postingMode).toBe("smart");
    await getDb().delete(postingSlots).where(eq(postingSlots.workspaceId, ws.id));
    const created = await ensureSlots(ws, 3);
    expect(created).toBeGreaterThanOrEqual(2 * ws.postsPerDay);
    expect(await ensureSlots(ws, 3)).toBe(0);
    const slots = await getDb().select().from(postingSlots).where(eq(postingSlots.workspaceId, ws.id));
    const perDay = new Map<string, string[]>();
    for (const s of slots) perDay.set(s.localDate, [...(perDay.get(s.localDate) ?? []), s.localTime]);
    const days = [...perDay.keys()].sort();
    for (const d of days.slice(1)) expect(perDay.get(d)!.length).toBe(ws.postsPerDay);
    for (const s of slots) expect(s.localTime.endsWith(":45")).toBe(true);
    expect(slots.every((s) => s.scheduledFor.getTime() > Date.now())).toBe(true);
  });

  it("as soon as ready: the first video goes out in minutes (no slot), the next keeps 30 min apart, the daily cap holds", async () => {
    const { ws } = await makeLiveBusiness("AsapCo");
    await getDb().update(workspaces).set({ maxContentPublishedPerDay: 2 }).where(eq(workspaces.id, ws.id));
    const ids = await makeReadyContent(await reload(ws.id), 3);
    await getDb().update(contents).set({ publishAsap: true }).where(eq(contents.workspaceId, ws.id));
    const r1 = await scheduleContent(ids[0]!, "AUTOMATION");
    const r2 = await scheduleContent(ids[1]!, "AUTOMATION");
    expect(r1.scheduled && r2.scheduled).toBe(true);
    const t1 = r1.scheduledFor!.getTime();
    expect(t1 - Date.now()).toBeGreaterThan(60_000);
    expect(t1 - Date.now()).toBeLessThan(4 * 60_000);
    expect(r2.scheduledFor!.getTime() - t1).toBeGreaterThanOrEqual(30 * 60_000);
    const [c1] = await getDb().select().from(contents).where(eq(contents.id, ids[0]!));
    expect(c1!.slotId).toBeNull();
    // Third video the same day exceeds the cap (2/day) → waits for a regular slot.
    const r3 = await scheduleContent(ids[2]!, "AUTOMATION");
    const [c3] = await getDb().select().from(contents).where(eq(contents.id, ids[2]!));
    if (r3.scheduled) {
      expect(c3!.slotId).not.toBeNull();
      expect(new Date(r3.scheduledFor!).toDateString() === new Date(t1).toDateString() && r3.scheduledFor!.getTime() - t1 < 30 * 60_000).toBe(false);
    }
  });

  it("smart slots fine-tune each network to its own moment (within ±90 min)", async () => {
    const { ws } = await makeLiveBusiness("TunedCo");
    await ensureSlots(ws, 3);
    const [id] = await makeReadyContent(ws, 1);
    const r = await scheduleContent(id!, "AUTOMATION");
    expect(r.scheduled).toBe(true);
    const posts = await getDb().select().from(socialPosts).where(eq(socialPosts.contentId, id!));
    expect(posts.map((p) => p.platform).sort()).toEqual(["INSTAGRAM", "TIKTOK"]);
    for (const p of posts) expect(Math.abs(p.scheduledFor!.getTime() - r.scheduledFor!.getTime())).toBeLessThanOrEqual(90 * 60_000);
  });

  it("fixed mode keeps the owner's exact times", async () => {
    const { ws } = await makeLiveBusiness("FixedCo");
    await getDb().update(workspaces).set({ postingMode: "fixed", postingSchedule: ["10:10", "20:20"] }).where(eq(workspaces.id, ws.id));
    await getDb().delete(postingSlots).where(eq(postingSlots.workspaceId, ws.id));
    await ensureSlots(await reload(ws.id), 3);
    const slots = await getDb().select().from(postingSlots).where(eq(postingSlots.workspaceId, ws.id));
    expect(new Set(slots.map((s) => s.localTime))).toEqual(new Set(["10:10", "20:20"]));
  });
});
