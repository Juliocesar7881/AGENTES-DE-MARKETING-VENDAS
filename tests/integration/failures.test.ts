import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@revenueos/shared";
import { checkWorkerOffline, enqueueJob, registerHandler, saveGlobalSettings, scheduleContent } from "@revenueos/core";
import { agents, and, contents, eq, getDb, jobs, notifications, socialAccounts, socialPosts, sql, workerInstances } from "@revenueos/database";
import { MockAIProvider } from "@revenueos/providers/ai";
import { MockSocialProvider, type PublishInput, type PublishResult, type SocialAccountInfo, type SocialCredentials } from "@revenueos/providers/social";
import { renderFinalFailure } from "../../apps/worker/src/handlers/render";
import { doubles, makeLiveBusiness, makeReadyContent, runner, sleep, useDoubles } from "./helpers";

class DraftOnlyTikTok extends MockSocialProvider {
  constructor() {
    super({ platform: "TIKTOK" });
  }
  override async publishVideo(_c: SocialCredentials, _a: SocialAccountInfo, input: PublishInput): Promise<PublishResult> {
    return { outcome: "SENT_TO_DRAFTS", state: { ...input.state, publishId: "inbox_1" }, notice: "TikTok app not audited: sent to the creator inbox as a draft." };
  }
}

async function publishNowAndDrain(contentId: string) {
  const r = await scheduleContent(contentId, "HUMAN", { at: new Date(Date.now() + 1000) });
  expect(r.scheduled).toBe(true);
  await sleep(1200);
  await runner().drain({ timeoutMs: 60_000 });
}

async function postsOf(contentId: string) {
  return getDb().select().from(socialPosts).where(eq(socialPosts.contentId, contentId));
}

async function publishJob(postId: string) {
  const [j] = await getDb().select().from(jobs).where(and(eq(jobs.type, "PUBLISH_POST"), sql`${jobs.payload}->>'socialPostId' = ${postId}`)).orderBy(sql`${jobs.createdAt} desc`).limit(1);
  return j!;
}

describe("FAILURE TESTS", () => {
  beforeAll(() => useDoubles());
  beforeEach(async () => {
    doubles.ai = new MockAIProvider();
    doubles.social = {};
    await saveGlobalSettings({ emergencyStop: false }, null);
  });

  it("Claude timeout: the job is retried with backoff, nothing half-created, agent marked on final failure", async () => {
    const { ws } = await makeLiveBusiness("TimeoutCo");
    doubles.ai = new MockAIProvider({ failWith: "timeout" });
    const id = await enqueueJob({ type: "STRATEGY_PLAN", workspaceId: ws.id, payload: { count: 1 }, origin: "HUMAN" });
    await runner().drain({ timeoutMs: 20_000 });
    let [job] = await getDb().select().from(jobs).where(eq(jobs.id, id));
    expect(job!.status).toBe("RETRYING");
    expect(job!.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    expect(job!.lastError).toMatch(/too long/);
    expect(await getDb().select().from(contents).where(eq(contents.workspaceId, ws.id))).toHaveLength(0);
    await getDb().update(jobs).set({ scheduledAt: new Date(), maxAttempts: job!.attempts + 1 }).where(eq(jobs.id, id));
    await runner().drain({ timeoutMs: 20_000 });
    [job] = await getDb().select().from(jobs).where(eq(jobs.id, id));
    expect(job!.status).toBe("FAILED");
    const [agent] = await getDb().select().from(agents).where(and(eq(agents.workspaceId, ws.id), eq(agents.role, "STRATEGIST")));
    expect(agent!.status).toBe("ERROR");
  });

  it("Render failure: retried, then the content is marked FAILED with the reason (spec kept, Retry available)", async () => {
    const { ws } = await makeLiveBusiness("RenderFailCo");
    const [contentId] = await makeReadyContent(ws);
    await getDb().update(contents).set({ status: "READY_TO_RENDER" }).where(eq(contents.id, contentId!));
    registerHandler(
      "RENDER_VIDEO",
      async () => {
        throw new AppError({ code: "RENDER_FAILED", userMessage: "Remotion render failed: Chrome crashed (simulated).", retryable: true });
      },
      renderFinalFailure,
    );
    const id = await enqueueJob({ type: "RENDER_VIDEO", workspaceId: ws.id, payload: { contentId }, origin: "AUTOMATION", maxAttempts: 2 });
    await runner().drain({ timeoutMs: 20_000 });
    expect((await getDb().select().from(jobs).where(eq(jobs.id, id)))[0]!.status).toBe("RETRYING");
    await getDb().update(jobs).set({ scheduledAt: new Date() }).where(eq(jobs.id, id));
    await runner().drain({ timeoutMs: 20_000 });
    const [c] = await getDb().select().from(contents).where(eq(contents.id, contentId!));
    expect(c!.status).toBe("FAILED");
    expect(c!.failureReason).toMatch(/Chrome crashed/);
    expect(c!.currentSpecId).not.toBeNull();
    const n = await getDb().select().from(notifications).where(and(eq(notifications.workspaceId, ws.id), eq(notifications.type, "JOB_FAILED")));
    expect(n.length).toBeGreaterThan(0);
  });

  it("Instagram failure does not block TikTok; the failed post is retried and then marked FAILED", async () => {
    const { ws } = await makeLiveBusiness("IgFailCo");
    doubles.social = { INSTAGRAM: new MockSocialProvider({ platform: "INSTAGRAM", fail: "publish" }) };
    const [contentId] = await makeReadyContent(ws);
    await publishNowAndDrain(contentId!);
    const posts = await postsOf(contentId!);
    const ig = posts.find((p) => p.platform === "INSTAGRAM")!;
    const tt = posts.find((p) => p.platform === "TIKTOK")!;
    expect(tt.status).toBe("PUBLISHED");
    expect(ig.status).toBe("QUEUED");
    expect(ig.lastError).toMatch(/rejected this upload/);
    const job = await publishJob(ig.id);
    expect(job.status).toBe("RETRYING");
    await getDb().update(jobs).set({ scheduledAt: new Date(), maxAttempts: job.attempts + 1 }).where(eq(jobs.id, job.id));
    await runner().drain({ timeoutMs: 30_000 });
    const [after] = await getDb().select().from(socialPosts).where(eq(socialPosts.id, ig.id));
    expect(after!.status).toBe("FAILED");
    const n = await getDb().select().from(notifications).where(and(eq(notifications.workspaceId, ws.id), eq(notifications.type, "PUBLISH_FAILED")));
    expect(n.length).toBeGreaterThan(0);
  });

  it("TikTok without direct-post permission falls back to DRAFT and asks the human to finish", async () => {
    const { ws } = await makeLiveBusiness("TikTokDraftCo");
    doubles.social = { TIKTOK: new DraftOnlyTikTok() };
    const [contentId] = await makeReadyContent(ws);
    await publishNowAndDrain(contentId!);
    const tt = (await postsOf(contentId!)).find((p) => p.platform === "TIKTOK")!;
    expect(tt.status).toBe("DRAFT");
    const n = await getDb().select().from(notifications).where(and(eq(notifications.workspaceId, ws.id), eq(notifications.type, "ACTION_REQUIRED")));
    expect(n.some((x) => /Finish posting/.test(x.title))).toBe(true);
  });

  it("Expired token: account marked EXPIRED, publication fails fast with a reconnect notification", async () => {
    const { ws } = await makeLiveBusiness("ExpiredCo");
    doubles.social = { INSTAGRAM: new MockSocialProvider({ platform: "INSTAGRAM", fail: "expired_token" }) };
    const [contentId] = await makeReadyContent(ws);
    await publishNowAndDrain(contentId!);
    const ig = (await postsOf(contentId!)).find((p) => p.platform === "INSTAGRAM")!;
    expect(ig.status).toBe("FAILED");
    const [acc] = await getDb().select().from(socialAccounts).where(and(eq(socialAccounts.workspaceId, ws.id), eq(socialAccounts.platform, "INSTAGRAM")));
    expect(acc!.status).toBe("EXPIRED");
    const n = await getDb().select().from(notifications).where(and(eq(notifications.workspaceId, ws.id), eq(notifications.type, "TOKEN_EXPIRED")));
    expect(n.length).toBeGreaterThan(0);
  });

  it("Worker offline: local jobs stay queued and an alert is raised", async () => {
    const { ws } = await makeLiveBusiness("OfflineCo");
    await getDb().delete(workerInstances);
    const id = await enqueueJob({ type: "RENDER_VIDEO", workspaceId: ws.id, payload: { contentId: "00000000-0000-0000-0000-000000000000" }, origin: "AUTOMATION" });
    expect(await checkWorkerOffline(120)).toBe(true);
    const [job] = await getDb().select().from(jobs).where(eq(jobs.id, id));
    expect(job!.status).toBe("QUEUED");
    const n = await getDb().select().from(notifications).where(eq(notifications.type, "WORKER_OFFLINE"));
    expect(n.length).toBeGreaterThan(0);
    await getDb().insert(workerInstances).values({ id: "test-worker", name: "test", lastHeartbeatAt: new Date() });
    expect(await checkWorkerOffline(120)).toBe(false);
    await getDb().update(jobs).set({ status: "CANCELLED" }).where(eq(jobs.id, id));
  });

  it("Cross-business publish attempt: a post pointing at another business's account is blocked server-side", async () => {
    const a = await makeLiveBusiness("IsoA");
    const b = await makeLiveBusiness("IsoB");
    const [contentId] = await makeReadyContent(a.ws);
    await scheduleContent(contentId!, "HUMAN", { at: new Date(Date.now() + 60_000) });
    const [post] = (await postsOf(contentId!)).filter((p) => p.platform === "INSTAGRAM");
    const [foreign] = await getDb().select().from(socialAccounts).where(and(eq(socialAccounts.workspaceId, b.ws.id), eq(socialAccounts.platform, "INSTAGRAM")));
    // Simulate a tampered row: A's post aimed at B's Instagram account.
    await getDb().update(socialPosts).set({ socialAccountId: foreign!.id }).where(eq(socialPosts.id, post!.id));
    await getDb().update(jobs).set({ scheduledAt: new Date() }).where(and(eq(jobs.type, "PUBLISH_POST"), eq(jobs.workspaceId, a.ws.id)));
    await runner().drain({ timeoutMs: 30_000 });
    const [after] = await getDb().select().from(socialPosts).where(eq(socialPosts.id, post!.id));
    expect(after!.status).toBe("FAILED");
    expect(after!.platformPostId).toBeNull();
    expect(after!.lastError).toMatch(/workspace mismatch|does not belong to this workspace/);
    const job = await publishJob(post!.id);
    expect(job.status).toBe("FAILED");
    expect(job.lastError).toMatch(/does not belong to this workspace/);
    const audits = await getDb().execute(sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'publish.blocked_workspace_mismatch' AND entity_id = ${post!.id}`);
    expect(Number((audits as unknown as { n: number }[])[0]!.n)).toBe(1);
  });

  it("Emergency stop: nothing is published; jobs wait and resume afterwards", async () => {
    const { ws } = await makeLiveBusiness("StopCo");
    const [contentId] = await makeReadyContent(ws);
    await saveGlobalSettings({ emergencyStop: true }, null);
    await publishNowAndDrain(contentId!);
    const posts = await postsOf(contentId!);
    expect(posts.every((p) => p.status === "QUEUED")).toBe(true);
    // Outbound jobs are not even claimed while the stop is active: they wait in the queue untouched.
    const job = await publishJob(posts[0]!.id);
    expect(job.status).toBe("QUEUED");
    expect(job.attempts).toBe(0);
    await saveGlobalSettings({ emergencyStop: false }, null);
    await getDb().update(jobs).set({ scheduledAt: new Date() }).where(and(eq(jobs.type, "PUBLISH_POST"), eq(jobs.workspaceId, ws.id)));
    await runner().drain({ timeoutMs: 30_000 });
    expect((await postsOf(contentId!)).every((p) => p.status === "PUBLISHED")).toBe(true);
  });
});
