import { AppError, PLATFORM_CAPABILITIES } from "@revenueos/shared";
import { request, ProviderHttpError } from "../http";
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

const REQUIRED = ["instagram_business_basic", "instagram_business_content_publish"];

interface MetaError {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string; error_user_msg?: string };
}

/** Human explanations for the most common Instagram Graph API errors. */
export function describeMetaError(platform: "Instagram" | "Facebook" | "WhatsApp") {
  return (_status: number, body: unknown) => {
    const e = (body as MetaError)?.error;
    if (!e) return undefined;
    const base = e.error_user_msg || e.message || "";
    switch (e.code) {
      case 190:
        return { code: "META_TOKEN_EXPIRED", userMessage: `${platform} session expired or was revoked. Reconnect the account in Integrations.` };
      case 10:
      case 200:
      case 3:
        return { code: "META_PERMISSION", userMessage: `${platform} denied this action: the connected app is missing a permission (${base}).` };
      case 4:
      case 17:
      case 32:
      case 613:
        return { code: "META_RATE_LIMIT", userMessage: `${platform} rate limit reached. RevenueOS will retry later.` };
      case 9:
      case 368:
        return { code: "META_BLOCKED", userMessage: `${platform} temporarily blocked this action for the account (${base}).` };
      case 100:
        return { code: "META_INVALID_PARAM", userMessage: `${platform} rejected a parameter: ${base}` };
      case 24:
      case 2207026:
        return { code: "META_MEDIA", userMessage: `${platform} could not process the video: ${base}` };
      default:
        return base ? { code: `META_${e.code ?? "ERROR"}`, userMessage: `${platform}: ${base}` } : undefined;
    }
  };
}

/**
 * Instagram API with Instagram Login (graph.instagram.com). Supports Reels via
 * resumable upload (bytes from the worker/cloud delivery) or video_url.
 * Requires a Professional (Business/Creator) account.
 */
export class InstagramProvider implements SocialProvider {
  readonly platform = "INSTAGRAM" as const;
  readonly capabilities = PLATFORM_CAPABILITIES.INSTAGRAM;
  readonly isMock = false;
  readonly usesPkce = false;
  private readonly version: string;

  constructor(private readonly app: SocialAppConfig) {
    this.version = app.apiVersion ?? "v23.0";
  }

  private graph(path: string, token: string, params: Record<string, string> = {}): string {
    const u = new URL(`https://graph.instagram.com/${this.version}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("access_token", token);
    return u.toString();
  }

  connect(opts: { state: string }): string {
    const u = new URL("https://www.instagram.com/oauth/authorize");
    u.searchParams.set("client_id", this.app.clientId);
    u.searchParams.set("redirect_uri", this.app.redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", this.capabilities.oauthScopes.join(","));
    u.searchParams.set("state", opts.state);
    return u.toString();
  }

  async completeConnect(opts: { code: string }): Promise<ConnectResult> {
    const short = await request<{ access_token?: string; user_id?: string | number; permissions?: string | string[]; data?: { access_token: string; user_id: string; permissions: string }[] }>(
      "https://api.instagram.com/oauth/access_token",
      {
        provider: "Instagram",
        form: {
          client_id: this.app.clientId,
          client_secret: this.app.clientSecret,
          grant_type: "authorization_code",
          redirect_uri: this.app.redirectUri,
          code: opts.code.replace(/#_$/, ""),
        },
        describeError: describeMetaError("Instagram"),
      },
    );
    const payload = short.data.data?.[0] ?? short.data;
    const shortToken = payload.access_token;
    if (!shortToken) throw new AppError({ code: "IG_NO_TOKEN", userMessage: "Instagram did not return an access token." });
    const perms = Array.isArray(payload.permissions) ? payload.permissions : String(payload.permissions ?? "").split(",");
    const long = await request<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(this.app.clientSecret)}&access_token=${encodeURIComponent(shortToken)}`,
      { provider: "Instagram", describeError: describeMetaError("Instagram") },
    );
    const credentials: SocialCredentials = {
      accessToken: long.data.access_token,
      expiresAt: new Date(Date.now() + long.data.expires_in * 1000),
    };
    const account = await this.getAccount(credentials);
    account.scopes = perms.map((p) => p.trim()).filter(Boolean);
    return { credentials, account };
  }

  async refreshAuth(creds: SocialCredentials): Promise<SocialCredentials | null> {
    const res = await request<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(creds.accessToken)}`,
      { provider: "Instagram", describeError: describeMetaError("Instagram") },
    );
    return { accessToken: res.data.access_token, expiresAt: new Date(Date.now() + res.data.expires_in * 1000) };
  }

  async disconnect(): Promise<void> {
    // Instagram Login has no token revocation endpoint; tokens are deleted locally and expire.
  }

  async getAccount(creds: SocialCredentials): Promise<SocialAccountInfo> {
    const res = await request<{ user_id?: string; id: string; username: string; name?: string; profile_picture_url?: string; account_type?: string }>(
      this.graph("me", creds.accessToken, { fields: "user_id,username,name,profile_picture_url,account_type" }),
      { provider: "Instagram", describeError: describeMetaError("Instagram") },
    );
    return {
      externalAccountId: String(res.data.user_id ?? res.data.id),
      username: res.data.username,
      displayName: res.data.name ?? null,
      avatarUrl: res.data.profile_picture_url ?? null,
      scopes: [],
      metadata: { accountType: res.data.account_type ?? null },
    };
  }

  async validateConnection(creds: SocialCredentials, account: SocialAccountInfo): Promise<ConnectionTestResult> {
    const missing = missingScopes(REQUIRED, account.scopes);
    try {
      const me = await this.getAccount(creds);
      const professional = me.metadata?.accountType !== "PERSONAL";
      let quota: unknown = null;
      try {
        const q = await request<{ data: { quota_usage: number; config?: { quota_total: number } }[] }>(
          this.graph(`${me.externalAccountId}/content_publishing_limit`, creds.accessToken, { fields: "quota_usage,config" }),
          { provider: "Instagram", describeError: describeMetaError("Instagram") },
        );
        quota = q.data.data?.[0] ?? null;
      } catch {
        /* optional */
      }
      const publishOk = missing.length === 0 && professional;
      return {
        authenticated: true,
        accountOk: professional,
        permissionsOk: missing.length === 0,
        publishPermissionOk: publishOk,
        missingScopes: missing,
        account: me,
        actionRequired: !professional
          ? {
              reason: "Instagram only allows API publishing for Professional (Business or Creator) accounts.",
              steps: ["Open Instagram → Settings → Account type and tools", "Switch to a Professional account", "Reconnect in RevenueOS"],
              links: [{ label: "Instagram help", url: "https://help.instagram.com/502981923235522" }],
            }
          : missing.length > 0
            ? {
                reason: "The connection is missing publishing permissions.",
                steps: ["Click Reconnect", "Approve all requested permissions on the Instagram screen"],
                links: [{ label: "Meta App Dashboard", url: this.capabilities.developerPortalUrl }],
                missingScopes: missing,
              }
            : null,
        details: { quota },
      };
    } catch (e) {
      return {
        authenticated: false,
        accountOk: false,
        permissionsOk: false,
        publishPermissionOk: false,
        missingScopes: missing,
        actionRequired: {
          reason: e instanceof AppError ? e.userMessage : "Instagram rejected the stored credentials.",
          steps: ["Click Reconnect and log in with Instagram again"],
          links: [],
        },
        details: {},
      };
    }
  }

  async publishVideo(creds: SocialCredentials, account: SocialAccountInfo, input: PublishInput): Promise<PublishResult> {
    const state: ProviderState = { ...input.state };
    const caption = [input.caption, input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")].filter(Boolean).join("\n\n").slice(0, 2200);
    // 1) Create (or resume) the media container.
    if (!state.containerId) {
      const params: Record<string, string> = { media_type: "REELS", caption, share_to_feed: "true" };
      if (input.video.url) params.video_url = input.video.url;
      else params.upload_type = "resumable";
      const created = await request<{ id: string; uri?: string }>(this.graph(`${account.externalAccountId}/media`, creds.accessToken), {
        provider: "Instagram",
        method: "POST",
        form: params,
        describeError: describeMetaError("Instagram"),
      });
      state.containerId = created.data.id;
      state.uploadUri = created.data.uri ?? null;
      state.uploaded = Boolean(input.video.url);
      await input.saveState(state);
    }
    // 2) Upload bytes (resumable) if needed.
    if (!state.uploaded) {
      const bytes = await input.video.read();
      const uri = (state.uploadUri as string) || `https://rupload.facebook.com/ig-api-upload/${this.version}/${state.containerId}`;
      await request(uri, {
        provider: "Instagram",
        method: "POST",
        headers: { Authorization: `OAuth ${creds.accessToken}`, offset: "0", file_size: String(bytes.length), "content-type": "application/octet-stream" },
        body: new Uint8Array(bytes),
        timeoutMs: 300_000,
        describeError: describeMetaError("Instagram"),
      });
      state.uploaded = true;
      await input.saveState(state);
    }
    // 3) Wait for processing (bounded). If still processing, report PROCESSING; the job re-checks later.
    const status = await this.waitForContainer(creds, String(state.containerId), 90_000);
    if (status === "ERROR" || status === "EXPIRED") {
      throw new AppError({ code: "IG_CONTAINER_ERROR", userMessage: `Instagram could not process the video (status ${status}). Check format/duration and retry.` });
    }
    if (status !== "FINISHED" && status !== "PUBLISHED") return { outcome: "PROCESSING", state };
    // 4) Publish (idempotent guard: never publish the same container twice).
    if (!state.mediaId) {
      const published = await request<{ id: string }>(this.graph(`${account.externalAccountId}/media_publish`, creds.accessToken), {
        provider: "Instagram",
        method: "POST",
        form: { creation_id: String(state.containerId) },
        describeError: describeMetaError("Instagram"),
      });
      state.mediaId = published.data.id;
      await input.saveState(state);
    }
    const post = await this.getPost(creds, account, String(state.mediaId));
    return { outcome: "PUBLISHED", platformPostId: String(state.mediaId), permalink: post.permalink ?? null, state };
  }

  private async waitForContainer(creds: SocialCredentials, containerId: string, maxMs: number): Promise<string> {
    const started = Date.now();
    let status = "IN_PROGRESS";
    while (Date.now() - started < maxMs) {
      const res = await request<{ status_code?: string }>(this.graph(containerId, creds.accessToken, { fields: "status_code,status" }), {
        provider: "Instagram",
        describeError: describeMetaError("Instagram"),
      });
      status = res.data.status_code ?? "IN_PROGRESS";
      if (status !== "IN_PROGRESS") return status;
      await sleep(5000);
    }
    return status;
  }

  async getPublishStatus(creds: SocialCredentials, account: SocialAccountInfo, state: ProviderState): Promise<PostStatus> {
    if (state.mediaId) {
      const p = await this.getPost(creds, account, String(state.mediaId));
      return { status: p.exists ? "PUBLISHED" : "UNKNOWN", platformPostId: String(state.mediaId), permalink: p.permalink };
    }
    if (!state.containerId) return { status: "UNKNOWN" };
    const res = await request<{ status_code?: string; status?: string }>(
      this.graph(String(state.containerId), creds.accessToken, { fields: "status_code,status" }),
      { provider: "Instagram", describeError: describeMetaError("Instagram") },
    );
    const code = res.data.status_code;
    if (code === "PUBLISHED") return { status: "PUBLISHED" };
    if (code === "ERROR" || code === "EXPIRED") return { status: "FAILED", error: res.data.status ?? code };
    return { status: "PROCESSING" };
  }

  async getPost(creds: SocialCredentials, _account: SocialAccountInfo, platformPostId: string) {
    try {
      const res = await request<{ permalink?: string }>(this.graph(platformPostId, creds.accessToken, { fields: "permalink,timestamp,media_type" }), {
        provider: "Instagram",
        describeError: describeMetaError("Instagram"),
      });
      return { permalink: res.data.permalink ?? null, exists: true };
    } catch (e) {
      if (e instanceof ProviderHttpError && e.status === 400) return { permalink: null, exists: false };
      throw e;
    }
  }

  async getMetrics(creds: SocialCredentials, _account: SocialAccountInfo, platformPostId: string): Promise<MetricsSnapshot> {
    const metrics = ["views", "reach", "likes", "comments", "shares", "saved", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"];
    const values: Record<string, number> = {};
    // Request individually-tolerant: if the batch fails (unsupported metric), fall back to one by one.
    try {
      const res = await request<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
        this.graph(`${platformPostId}/insights`, creds.accessToken, { metric: metrics.join(",") }),
        { provider: "Instagram", describeError: describeMetaError("Instagram") },
      );
      for (const m of res.data.data ?? []) values[m.name] = m.total_value?.value ?? m.values?.[0]?.value ?? 0;
    } catch {
      for (const metric of metrics) {
        try {
          const res = await request<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
            this.graph(`${platformPostId}/insights`, creds.accessToken, { metric }),
            { provider: "Instagram", retries: 0 },
          );
          const m = res.data.data?.[0];
          if (m) values[m.name] = m.total_value?.value ?? m.values?.[0]?.value ?? 0;
        } catch {
          /* metric unavailable for this media — leave undefined, never invent */
        }
      }
    }
    return {
      views: values.views ?? null,
      reach: values.reach ?? null,
      likes: values.likes ?? null,
      comments: values.comments ?? null,
      shares: values.shares ?? null,
      saves: values.saved ?? null,
      avgWatchMs: values.ig_reels_avg_watch_time ?? null,
      watchTimeMs: values.ig_reels_video_view_total_time ?? null,
      raw: values,
    };
  }
}
