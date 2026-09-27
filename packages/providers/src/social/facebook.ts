import { AppError, PLATFORM_CAPABILITIES } from "@revenueos/shared";
import { request, ProviderHttpError } from "../http";
import { describeMetaError } from "./instagram";
import {
  missingScopes,
  sleep,
  type ConnectionTestResult,
  type ConnectResult,
  type MetricsSnapshot,
  type PostStatus,
  type ProviderState,
  type PublishInput,
  type PublishResult,
  type SocialAccountInfo,
  type SocialAppConfig,
  type SocialCredentials,
  type SocialProvider,
} from "./types";

const REQUIRED = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"];

interface PageInfo {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  tasks?: string[];
}

/**
 * Facebook Pages Reels publishing via the official Video API
 * (/{page-id}/video_reels start → rupload → finish). Uses a non-expiring Page
 * token derived from a long-lived user token.
 */
export class FacebookProvider implements SocialProvider {
  readonly platform = "FACEBOOK" as const;
  readonly capabilities = PLATFORM_CAPABILITIES.FACEBOOK;
  readonly isMock = false;
  readonly usesPkce = false;
  private readonly version: string;

  constructor(private readonly app: SocialAppConfig) {
    this.version = app.apiVersion ?? "v23.0";
  }

  private graph(path: string, token: string, params: Record<string, string> = {}): string {
    const u = new URL(`https://graph.facebook.com/${this.version}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("access_token", token);
    return u.toString();
  }

  private pageToken(creds: SocialCredentials): string {
    const t = creds.extra?.pageAccessToken;
    if (!t) throw new AppError({ code: "FB_NO_PAGE_TOKEN", userMessage: "No Facebook Page is linked to this connection. Reconnect and select a Page." });
    return t;
  }

  connect(opts: { state: string }): string {
    const u = new URL(`https://www.facebook.com/${this.version}/dialog/oauth`);
    u.searchParams.set("client_id", this.app.clientId);
    u.searchParams.set("redirect_uri", this.app.redirectUri);
    u.searchParams.set("state", opts.state);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", [...this.capabilities.oauthScopes, "business_management"].join(","));
    return u.toString();
  }

  async completeConnect(opts: { code: string }): Promise<ConnectResult> {
    const tokenUrl = new URL(`https://graph.facebook.com/${this.version}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", this.app.clientId);
    tokenUrl.searchParams.set("client_secret", this.app.clientSecret);
    tokenUrl.searchParams.set("redirect_uri", this.app.redirectUri);
    tokenUrl.searchParams.set("code", opts.code);
    const short = await request<{ access_token: string }>(tokenUrl.toString(), { provider: "Facebook", describeError: describeMetaError("Facebook") });
    const longUrl = new URL(`https://graph.facebook.com/${this.version}/oauth/access_token`);
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", this.app.clientId);
    longUrl.searchParams.set("client_secret", this.app.clientSecret);
    longUrl.searchParams.set("fb_exchange_token", short.data.access_token);
    const long = await request<{ access_token: string; expires_in?: number }>(longUrl.toString(), {
      provider: "Facebook",
      describeError: describeMetaError("Facebook"),
    });
    const userToken = long.data.access_token;
    const perms = await request<{ data: { permission: string; status: string }[] }>(this.graph("me/permissions", userToken), {
      provider: "Facebook",
      describeError: describeMetaError("Facebook"),
    });
    const granted = perms.data.data.filter((p) => p.status === "granted").map((p) => p.permission);
    const pages = await request<{ data: PageInfo[] }>(this.graph("me/accounts", userToken, { fields: "id,name,access_token,picture{url},tasks" }), {
      provider: "Facebook",
      describeError: describeMetaError("Facebook"),
    });
    const page = pages.data.data?.[0];
    if (!page) {
      throw new AppError({
        code: "FB_NO_PAGES",
        userMessage: "This Facebook user manages no Pages (or none were selected). Create/select a Page and reconnect.",
      });
    }
    return {
      credentials: {
        accessToken: userToken,
        expiresAt: long.data.expires_in ? new Date(Date.now() + long.data.expires_in * 1000) : null,
        extra: { pageAccessToken: page.access_token },
      },
      account: {
        externalAccountId: page.id,
        username: page.name,
        displayName: page.name,
        avatarUrl: page.picture?.data?.url ?? null,
        scopes: granted,
        metadata: { pages: pages.data.data.map((p) => ({ id: p.id, name: p.name })), tasks: page.tasks ?? [] },
      },
    };
  }

  async refreshAuth(): Promise<SocialCredentials | null> {
    // Page tokens obtained from long-lived user tokens do not expire. Nothing to refresh.
    return null;
  }

  async disconnect(creds: SocialCredentials): Promise<void> {
    try {
      await request(this.graph("me/permissions", creds.accessToken), { provider: "Facebook", method: "DELETE" });
    } catch {
      /* best effort */
    }
  }

  async getAccount(creds: SocialCredentials): Promise<SocialAccountInfo> {
    const res = await request<{ id: string; name: string; picture?: { data?: { url?: string } } }>(
      this.graph("me", this.pageToken(creds), { fields: "id,name,picture{url}" }),
      { provider: "Facebook", describeError: describeMetaError("Facebook") },
    );
    return { externalAccountId: res.data.id, username: res.data.name, displayName: res.data.name, avatarUrl: res.data.picture?.data?.url ?? null, scopes: [] };
  }

  async validateConnection(creds: SocialCredentials, account: SocialAccountInfo): Promise<ConnectionTestResult> {
    const missing = missingScopes(REQUIRED, account.scopes);
    try {
      const me = await this.getAccount(creds);
      const accountOk = me.externalAccountId === account.externalAccountId;
      return {
        authenticated: true,
        accountOk,
        permissionsOk: missing.length === 0,
        publishPermissionOk: missing.length === 0 && accountOk,
        missingScopes: missing,
        account: me,
        actionRequired:
          missing.length > 0
            ? {
                reason: "The Facebook connection is missing Page publishing permissions.",
                steps: ["Click Reconnect", "Select the Page and approve all permissions", "Make sure your Meta app has pages_manage_posts approved (App Review) for Live mode"],
                links: [{ label: "Meta App Review", url: "https://developers.facebook.com/docs/app-review" }],
                missingScopes: missing,
              }
            : null,
        details: {},
      };
    } catch (e) {
      return {
        authenticated: false,
        accountOk: false,
        permissionsOk: false,
        publishPermissionOk: false,
        missingScopes: missing,
        actionRequired: { reason: e instanceof AppError ? e.userMessage : "Facebook rejected the stored credentials.", steps: ["Reconnect the Page"], links: [] },
        details: {},
      };
    }
  }

  async publishVideo(creds: SocialCredentials, account: SocialAccountInfo, input: PublishInput): Promise<PublishResult> {
    const token = this.pageToken(creds);
    const state: ProviderState = { ...input.state };
    const description = [input.caption, input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")].filter(Boolean).join("\n\n");
    if (!state.videoId) {
      const start = await request<{ video_id: string; upload_url: string }>(
        this.graph(`${account.externalAccountId}/video_reels`, token, { upload_phase: "start" }),
        { provider: "Facebook", method: "POST", json: {}, describeError: describeMetaError("Facebook") },
      );
      state.videoId = start.data.video_id;
      state.uploadUrl = start.data.upload_url;
      await input.saveState(state);
    }
    if (!state.uploaded) {
      const headers: Record<string, string> = { Authorization: `OAuth ${token}` };
      let body: Uint8Array<ArrayBuffer> | undefined;
      if (input.video.url) headers.file_url = input.video.url;
      else {
        const bytes = await input.video.read();
        headers.offset = "0";
        headers.file_size = String(bytes.length);
        headers["content-type"] = "application/octet-stream";
        body = new Uint8Array(bytes);
      }
      await request(String(state.uploadUrl ?? `https://rupload.facebook.com/video-upload/${this.version}/${state.videoId}`), {
        provider: "Facebook",
        method: "POST",
        headers,
        body,
        timeoutMs: 300_000,
        describeError: describeMetaError("Facebook"),
      });
      state.uploaded = true;
      await input.saveState(state);
    }
    if (!state.finished) {
      await request(
        this.graph(`${account.externalAccountId}/video_reels`, token, {
          upload_phase: "finish",
          video_id: String(state.videoId),
          video_state: input.mode === "DRAFT" ? "DRAFT" : "PUBLISHED",
          description,
        }),
        { provider: "Facebook", method: "POST", json: {}, describeError: describeMetaError("Facebook") },
      );
      state.finished = true;
      await input.saveState(state);
    }
    for (let i = 0; i < 12; i++) {
      const st = await this.getPublishStatus(creds, account, state);
      if (st.status === "PUBLISHED") return { outcome: "PUBLISHED", platformPostId: String(state.videoId), permalink: st.permalink ?? null, state };
      if (st.status === "FAILED") throw new AppError({ code: "FB_PROCESSING_FAILED", userMessage: `Facebook could not process the Reel: ${st.error ?? "unknown error"}` });
      if (input.mode === "DRAFT") return { outcome: "SENT_TO_DRAFTS", platformPostId: String(state.videoId), state };
      await sleep(5000);
    }
    return { outcome: "PROCESSING", platformPostId: String(state.videoId), state };
  }

  async getPublishStatus(creds: SocialCredentials, _account: SocialAccountInfo, state: ProviderState): Promise<PostStatus> {
    if (!state.videoId) return { status: "UNKNOWN" };
    const res = await request<{ status?: { video_status?: string; publishing_phase?: { status?: string; errors?: { message: string }[] }; processing_phase?: { status?: string } }; permalink_url?: string }>(
      this.graph(String(state.videoId), this.pageToken(creds), { fields: "status,permalink_url" }),
      { provider: "Facebook", describeError: describeMetaError("Facebook") },
    );
    const s = res.data.status;
    const permalink = res.data.permalink_url ? `https://www.facebook.com${res.data.permalink_url.startsWith("/") ? "" : "/"}${res.data.permalink_url.replace(/^https?:\/\/(www\.)?facebook\.com/, "")}` : null;
    if (s?.video_status === "error" || s?.publishing_phase?.status === "error") {
      return { status: "FAILED", error: s?.publishing_phase?.errors?.[0]?.message ?? "processing error" };
    }
    if (s?.publishing_phase?.status === "complete" || s?.video_status === "ready") {
      return { status: "PUBLISHED", platformPostId: String(state.videoId), permalink };
    }
    return { status: "PROCESSING" };
  }

  async getPost(creds: SocialCredentials, _account: SocialAccountInfo, platformPostId: string) {
    try {
      const res = await request<{ permalink_url?: string }>(this.graph(platformPostId, this.pageToken(creds), { fields: "permalink_url" }), {
        provider: "Facebook",
      });
      return { permalink: res.data.permalink_url ? `https://www.facebook.com${res.data.permalink_url}` : null, exists: true };
    } catch (e) {
      if (e instanceof ProviderHttpError && e.status === 400) return { permalink: null, exists: false };
      throw e;
    }
  }

  async getMetrics(creds: SocialCredentials, _account: SocialAccountInfo, platformPostId: string): Promise<MetricsSnapshot> {
    const values: Record<string, number> = {};
    for (const metric of ["blue_reels_play_count", "post_impressions_unique", "post_video_social_actions", "post_video_avg_time_watched"]) {
      try {
        const res = await request<{ data: { name: string; values?: { value: number | Record<string, number> }[] }[] }>(
          this.graph(`${platformPostId}/video_insights`, this.pageToken(creds), { metric }),
          { provider: "Facebook", retries: 0 },
        );
        const v = res.data.data?.[0]?.values?.[0]?.value;
        if (typeof v === "number") values[metric] = v;
        else if (v && typeof v === "object") for (const [k, n] of Object.entries(v)) values[`${metric}.${k}`] = n;
      } catch {
        /* metric not available — never invented */
      }
    }
    return {
      views: values.blue_reels_play_count ?? null,
      reach: values.post_impressions_unique ?? null,
      likes: values["post_video_social_actions.LIKE"] ?? null,
      comments: values["post_video_social_actions.COMMENT"] ?? null,
      shares: values["post_video_social_actions.SHARE"] ?? null,
      avgWatchMs: values.post_video_avg_time_watched ?? null,
      raw: values,
    };
  }
}
