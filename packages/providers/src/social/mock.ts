import { createHash } from "node:crypto";
import { AppError, PLATFORM_CAPABILITIES, type Platform } from "@revenueos/shared";
import type {
  ConnectionTestResult,
  ConnectResult,
  MetricsSnapshot,
  PostStatus,
  ProviderState,
  PublishInput,
  PublishResult,
  SocialAccountInfo,
  SocialCredentials,
  SocialProvider,
} from "./types";

export interface MockSocialOptions {
  /** Which real platform this mock stands in for (labels only; results are always marked DEMO). */
  platform?: Platform;
  /** Failure injection for tests. */
  fail?: "publish" | "expired_token" | "processing" | null;
}

function seeded(seed: string): () => number {
  let h = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100_000) / 100_000;
  };
}

/**
 * MockSocialProvider — DEMO/TEST only. Generates fake provider ids prefixed with
 * "mock_" and deterministic simulated metrics. The UI always labels these posts
 * DEMO; they are never presented as real publications.
 */
export class MockSocialProvider implements SocialProvider {
  readonly platform: Platform;
  readonly capabilities;
  readonly isMock = true;
  readonly usesPkce = false;

  constructor(private readonly opts: MockSocialOptions = {}) {
    this.platform = opts.platform ?? "MOCK";
    this.capabilities = { ...PLATFORM_CAPABILITIES.MOCK, platform: this.platform, displayName: `${PLATFORM_CAPABILITIES[this.platform].displayName} (DEMO)` };
  }

  connect(opts: { state: string }): string {
    return `/demo/oauth?state=${encodeURIComponent(opts.state)}&platform=${this.platform}`;
  }

  async completeConnect(opts: { code: string }): Promise<ConnectResult> {
    const id = `mock_${this.platform.toLowerCase()}_${opts.code.slice(0, 8)}`;
    return {
      credentials: { accessToken: `mock-token-${opts.code}`, expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000) },
      account: { externalAccountId: id, username: `demo_${this.platform.toLowerCase()}`, displayName: "Demo account", scopes: ["demo"] },
    };
  }

  async refreshAuth(creds: SocialCredentials): Promise<SocialCredentials> {
    return { ...creds, expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000) };
  }

  async disconnect(): Promise<void> {}

  async getAccount(): Promise<SocialAccountInfo> {
    return { externalAccountId: `mock_${this.platform.toLowerCase()}`, username: `demo_${this.platform.toLowerCase()}`, scopes: ["demo"] };
  }

  async validateConnection(_creds: SocialCredentials, account: SocialAccountInfo): Promise<ConnectionTestResult> {
    if (this.opts.fail === "expired_token") {
      return {
        authenticated: false,
        accountOk: false,
        permissionsOk: false,
        publishPermissionOk: false,
        missingScopes: [],
        actionRequired: { reason: "Simulated expired token (DEMO).", steps: ["Reconnect"], links: [] },
        details: {},
      };
    }
    return { authenticated: true, accountOk: true, permissionsOk: true, publishPermissionOk: true, missingScopes: [], account, details: { demo: true } };
  }

  async publishVideo(_creds: SocialCredentials, account: SocialAccountInfo, input: PublishInput): Promise<PublishResult> {
    if (this.opts.fail === "expired_token") {
      throw new AppError({ code: "META_TOKEN_EXPIRED", userMessage: `${this.platform} session expired (simulated). Reconnect the account in Integrations.` });
    }
    if (this.opts.fail === "publish") {
      throw new AppError({
        code: "MOCK_PUBLISH_FAILED",
        userMessage: `${this.platform} rejected this upload (simulated failure for testing).`,
        retryable: true,
      });
    }
    if (input.state.platformPostId) {
      // Idempotent: a retry never publishes twice.
      return { outcome: "PUBLISHED", platformPostId: String(input.state.platformPostId), permalink: String(input.state.permalink ?? ""), state: input.state };
    }
    const hash = createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 12);
    const platformPostId = `mock_${this.platform.toLowerCase()}_${hash}`;
    const state: ProviderState = { ...input.state, platformPostId, permalink: `/demo/post/${platformPostId}`, account: account.externalAccountId };
    await input.saveState(state);
    if (this.opts.fail === "processing") return { outcome: "PROCESSING", state };
    return { outcome: "PUBLISHED", platformPostId, permalink: `/demo/post/${platformPostId}`, state, notice: "DEMO publication — nothing was posted to a real network." };
  }

  async getPublishStatus(_c: SocialCredentials, _a: SocialAccountInfo, state: ProviderState): Promise<PostStatus> {
    if (state.platformPostId) return { status: "PUBLISHED", platformPostId: String(state.platformPostId), permalink: String(state.permalink ?? "") };
    return { status: "UNKNOWN" };
  }

  async getPost(_c: SocialCredentials, _a: SocialAccountInfo, platformPostId: string) {
    return { permalink: `/demo/post/${platformPostId}`, exists: true };
  }

  /** Deterministic simulated growth curve based on post id and age. Marked as simulated by the caller. */
  async getMetrics(_c: SocialCredentials, _a: SocialAccountInfo, platformPostId: string, state: ProviderState): Promise<MetricsSnapshot> {
    const rnd = seeded(platformPostId);
    const publishedAt = typeof state.publishedAt === "string" ? Date.parse(state.publishedAt) : Date.now() - 6 * 3600_000;
    const hours = Math.max(1, (Date.now() - publishedAt) / 3600_000);
    const quality = 0.4 + rnd() * 1.6;
    const views = Math.round((800 + rnd() * 9000) * quality * Math.min(1, Math.log10(1 + hours) / 1.4));
    const likes = Math.round(views * (0.03 + rnd() * 0.06));
    return {
      views,
      reach: Math.round(views * (0.7 + rnd() * 0.2)),
      likes,
      comments: Math.round(likes * (0.05 + rnd() * 0.1)),
      shares: Math.round(likes * (0.08 + rnd() * 0.15)),
      saves: Math.round(likes * (0.1 + rnd() * 0.2)),
      avgWatchMs: Math.round(4000 + rnd() * 9000),
      raw: { simulated: true, quality },
    };
  }
}
