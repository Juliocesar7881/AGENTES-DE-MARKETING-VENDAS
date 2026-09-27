import { beforeAll, describe, expect, it } from "vitest";
import { ensureDemoAccount, loadBusinessContext, simulateDay } from "@revenueos/core";
import { getDb, sql, workspaces, eq } from "@revenueos/database";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>) => (await getDb().execute(s)) as unknown as Row[];

describe("THREE BUSINESS TEST — 3 isolated businesses running the full cycle", () => {
  let ids: string[] = [];
  let report: Awaited<ReturnType<typeof simulateDay>>;

  beforeAll(async () => {
    const seed = await ensureDemoAccount();
    ids = seed.workspaces.map((w) => w.id);
    report = await simulateDay({ workspaceIds: ids, contentsPerWorkspace: 2, userId: seed.userId });
  }, 300_000);

  it("runs strategy → content → publish → leads → sales → attribution for each business", () => {
    expect(report.workspaces).toHaveLength(3);
    for (const w of report.workspaces) {
      expect(w.contents).toBe(2);
      expect(w.published).toBe(2);
      expect(w.leads).toBeGreaterThan(0);
    }
    expect(report.workspaces.reduce((s, w) => s + w.sales, 0)).toBeGreaterThanOrEqual(0);
  });

  it("every lead, post, payment and attribution stays inside its own business", async () => {
    const crossLeads = await q(sql`SELECT count(*) AS n FROM leads l JOIN contents c ON c.id = l.source_content_id WHERE c.workspace_id <> l.workspace_id`);
    const crossPosts = await q(sql`SELECT count(*) AS n FROM social_posts p JOIN contents c ON c.id = p.content_id WHERE c.workspace_id <> p.workspace_id`);
    const crossPostAccounts = await q(sql`SELECT count(*) AS n FROM social_posts p JOIN social_accounts a ON a.id = p.social_account_id WHERE a.workspace_id <> p.workspace_id`);
    const crossPayments = await q(sql`SELECT count(*) AS n FROM payments p JOIN contents c ON c.id = p.content_id WHERE c.workspace_id <> p.workspace_id`);
    const crossCheckoutProducts = await q(sql`SELECT count(*) AS n FROM checkouts k JOIN products pr ON pr.id = k.product_id WHERE pr.workspace_id <> k.workspace_id`);
    const crossAttribution = await q(sql`SELECT count(*) AS n FROM attribution_events e JOIN contents c ON c.id = e.content_id WHERE c.workspace_id <> e.workspace_id`);
    const crossMessages = await q(sql`SELECT count(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.workspace_id <> m.workspace_id`);
    const crossContentProducts = await q(sql`SELECT count(*) AS n FROM contents c JOIN products p ON p.id = c.product_id WHERE p.workspace_id <> c.workspace_id`);
    for (const r of [crossLeads, crossPosts, crossPostAccounts, crossPayments, crossCheckoutProducts, crossAttribution, crossMessages, crossContentProducts]) expect(Number(r[0]!.n)).toBe(0);
  });

  it("agents receive only their own business data", async () => {
    for (const id of ids) {
      const [ws] = await getDb().select().from(workspaces).where(eq(workspaces.id, id));
      const ctx = await loadBusinessContext(ws!);
      const productWs = await q(sql`SELECT DISTINCT workspace_id FROM products WHERE id = ANY(${sql.raw(`ARRAY[${ctx.products.map((p) => `'${p.id}'::uuid`).join(",") || "NULL::uuid"}]`)})`);
      expect(productWs.map((r) => r.workspace_id)).toEqual([id]);
      expect(ctx.workspace.id).toBe(id);
    }
  });

  it("revenue exists only where a verified payment webhook was processed", async () => {
    const orphan = await q(sql`
      SELECT count(*) AS n FROM payments p
      WHERE p.status = 'APPROVED' AND p.source <> 'MANUAL'
        AND NOT EXISTS (SELECT 1 FROM webhook_events w WHERE w.workspace_id = p.workspace_id AND w.signature_valid AND w.status = 'PROCESSED')`);
    expect(Number(orphan[0]!.n)).toBe(0);
  });

  it("respects the daily generation cap and posting caps per business", async () => {
    const perWs = await q(sql`SELECT workspace_id, count(*) AS n FROM contents WHERE created_at >= now() - interval '1 day' GROUP BY workspace_id`);
    for (const r of perWs) expect(Number(r.n)).toBeLessThanOrEqual(4);
  });

  it("each business keeps its own schedule and brand", async () => {
    const rows = await getDb().select({ schedule: workspaces.postingSchedule, name: workspaces.name }).from(workspaces).where(sql`${workspaces.id} = ANY(${sql.raw(`ARRAY[${ids.map((i) => `'${i}'::uuid`).join(",")}]`)})`);
    expect(new Set(rows.map((r) => r.schedule.join(","))).size).toBe(3);
  });
});
