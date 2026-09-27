import { AppError, PLATFORM_CAPABILITIES } from "@revenueos/shared";
import { request } from "../http";
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

const API = "https://open.tiktokapis.com";
const REQUIRED_DIRECT = ["user.info.basic", "video.publish"];
const REQUIRED_UPLOAD = ["user.info.basic", "video.upload"];

interface TikTokEnvelope<T> {
  data?: T;
  error?: { code: string; message?: string; log_id?: string };
}

const TIKTOK_ERRORS: Record<string, string> = {
  access_token_invalid: "TikTok session expired. Reconnect the TikTok account in Integrations.",
  scope_not_authorized: "The TikTok connection is missing a permission (video.publish / video.upload). Reconnect and approve all scopes.",
  unaudited_client_can_only_post_to_private_accounts:
    "TikTok rejected this public post because your TikTok app has not passed TikTok's audit yet. Unaudited apps can only post privately (SELF_ONLY).",
  spam_risk_too_many_posts: "TikTok blocked the post: this account reached TikTok's daily posting limit for API posts.",
  spam_risk_user_banned_from_posting: "TikTok does not allow this account to post via API right now.",
  privacy_level_option_mismatch: "The chosen TikTok privacy level is not available for this creator. RevenueOS will use an allowed option.",
  rate_limit_exceeded: "TikTok rate limit reached. RevenueOS will retry automatically.",
  url_ownership_unverified: "TikTok can only pull videos from verified domains. RevenueOS will upload the file directly instead.",
  file_format_check_failed: "TikTok rejected the video format. The render will be re-validated.",
  duration_check_failed: "The video duration is outside what TikTok allows for this creator.",
  frame_rate_check_failed: "TikTok rejected the video frame rate.",
  picture_size_check_failed: "TikTok rejected the video resolution.",
};

function describeTikTok(_status: number, body: unknown) {
  const code = (body as TikTokEnvelope<unknown>)?.error?.code;
  if (!code || code === "ok") return undefined;
  return { code: `TIKTOK_${code.toUpperCase()}`, userMessage: TIKTOK_ERRORS[code] ?? `TikTok error: ${code}` };
}

function assertOk<T>(env: TikTokEnvelope<T>): T {
  const code = env.error?.code;
  if (code && code !== "ok") {
    throw new AppError({
      code: `TIKTOK_${code.toUpperCase()}`,
      userMessage: TIKTOK_ERRORS[code] ?? `TikTok error: ${env.error?.message || code}`,
      details: { error: env.error },
      retryable: code === "rate_limit_exceeded",
    });
  }
  return env.data as T;
}

export interface CreatorInfo {
  creator_username?: string;
  creator_nickname?: string;
  creator_avatar_url?: string;
  privacy_level_options: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

/**
 * TikTok Content Posting API (official). Direct Post when the app has
 * video.publish; falls back to Upload-to-Inbox (draft the creator finishes in
 * the TikTok app) when only video.upload is available. Marks AI-generated
 * content with `is_aigc`. Never reports a private or draft post as public.
 */
export class TikTokProvider implements SocialProvider {
  readonly platform = "TIKTOK" as const;
  readonly capabilities = PLATFORM_CAPABILITIES.TIKTOK;
  readonly isMock = false;
  readonly usesPkce = false;

  constructor(private readonly app: SocialAppConfig) {}

  connect(opts: { state: string }): string {
    const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
    u.searchParams.set("client_key", this.app.clientId);
    u.searchParams.set("scope", this.capabilities.oauthScopes.join(","));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("redirect_uri", this.app.redirectUri);
    u.searchParams.set("state", opts.state);
    return u.toString();
  }

  private tokenToCreds(d: { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number }): SocialCredentials {
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token,
      expiresAt: new Date(Date.now() + d.expires_in * 1000),
      refreshExpiresAt: new Date(Date.now() + d.refresh_expires_in * 1000),
    };
  }

  async completeConnect(opts: { code: string }): Promise<ConnectResult> {
    const res = await request<{ access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number; open_id: string; scope: string; error?: string; error_description?: string }>(
      `${API}/v2/oauth/token/`,
      {
        provider: "TikTok",
        form: {
          client_key: this.app.clientId,
          client_secret: this.app.clientSecret,
          code: opts.code,
          grant_type: "authorization_code",
          redirect_uri: this.app.redirectUri,
        },
      },
    );
    if (res.data.error) {
      throw new AppError({ code: "TIKTOK_OAUTH", userMessage: `TikTok login failed: ${res.data.error_description ?? res.data.error}` });
    }
    const credentials = this.tokenToCreds(res.data);
    const account = await this.getAccount(credentials);
    account.scopes = res.data.scope.split(",").map((s) => s.trim());
    return { credentials, account };
  }

  async refreshAuth(creds: SocialCredentials): Promise<SocialCredentials | null> {
    if (!creds.refreshToken) return null;
    const res = await request<{ access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number; error?: string; error_description?: string }>(
      `${API}/v2/oauth/token/`,
      {
        provider: "TikTok",
        form: { client_key: this.app.clientId, client_secret: this.app.clientSecret, grant_type: "refresh_token", refresh_token: creds.refreshToken },
        idempotent: true,
      },
    );
    if (res.data.error) {
      throw new AppError({ code: "TIKTOK_REFRESH", userMessage: "TikTok session could not be refreshed. Reconnect the account in Integrations." });
    }
    return this.tokenToCreds(res.data);
  }

  async disconnect(creds: SocialCredentials): Promise<void> {
    try {
      await request(`${API}/v2/oauth/revoke/`, {
        provider: "TikTok",
        form: { client_key: this.app.clientId, client_secret: this.app.clientSecret, token: creds.accessToken },
      });
    } catch {
      /* best effort */
    }
  }

  async getAccount(creds: SocialCredentials): Promise<SocialAccountInfo> {
    const res = await request<TikTokEnvelope<{ user: { open_id: string; username?: string; display_name?: string; avatar_url?: string } }>>(
      `${API}/v2/user/info/?fields=open_id,avatar_url,display_name,username`,
      { provider: "TikTok", headers: { Authorization: `Bearer ${creds.accessToken}` }, describeError: describeTikTok },
    );
    const user = assertOk(res.data).user;
    return {
      externalAccountId: user.open_id,
      username: user.username ?? user.display_name ?? user.open_id,
      displayName: user.display_name ?? null,
      avatarUrl: user.avatar_url ?? null,
      scopes: [],
    };
  }

  async creatorInfo(creds: SocialCredentials): Promise<CreatorInfo> {
    const res = await request<TikTokEnvelope<CreatorInfo>>(`${API}/v2/post/publish/creator_info/query/`, {
      provider: "TikTok",
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json; charset=UTF-8" },
      body: "{}",
      idempotent: true,
      describeError: describeTikTok,
    });
    return assertOk(res.data);
  }

  async validateConnection(creds: SocialCredentials, account: SocialAccountInfo): Promise<ConnectionTestResult> {
    const missingDirect = missingScopes(REQUIRED_DIRECT, account.scopes);
    const missingUpload = missingScopes(REQUIRED_UPLOAD, account.scopes);
    try {
      const me = await this.getAccount(creds);
      let creator: CreatorInfo | null = null;
      try {
        creator = await this.creatorInfo(creds);
      } catch {
        /* creator info requires video.publish */
      }
      const canDirect = missingDirect.length === 0 && creator != null;
      const publicAllowed = this.app.audited === true;
      return {
        authenticated: true,
        accountOk: me.externalAccountId === account.externalAccountId,
        permissionsOk: canDirect || missingUpload.length === 0,
        publishPermissionOk: canDirect,
        missingScopes: missingDirect,
        account: me,
        actionRequired: !canDirect
          ? {
              reason:
                missingUpload.length === 0
                  ? "Direct Post is not available for this TikTok app/account. Videos will be sent to the creator's TikTok inbox as drafts."
                  : "The TikTok connection is missing posting permissions.",
              steps: [
                "Open the TikTok for Developers portal and add the Content Posting API product to your app",
                "Enable Direct Post and request the video.publish scope",
                "Reconnect TikTok in RevenueOS and approve all permissions",
              ],
              links: [{ label: "TikTok Content Posting API", url: this.capabilities.docsUrl }],
              missingScopes: missingDirect,
            }
          : !publicAllowed
            ? {
                reason: "Your TikTok app has not been audited by TikTok yet, so API posts are restricted to private (SELF_ONLY) visibility.",
                steps: [
                  "In TikTok for Developers, submit your app for the Content Posting API audit",
                  "After approval, enable 'App audited' in Integrations → TikTok settings",
                ],
                links: [{ label: "TikTok audit guidelines", url: "https://developers.tiktok.com/doc/content-sharing-guidelines" }],
              }
            : null,
        details: { creator, audited: publicAllowed },
      };
    } catch (e) {
      return {
        authenticated: false,
        accountOk: false,
        permissionsOk: false,
        publishPermissionOk: false,
        missingScopes: missingDirect,
        actionRequired: { reason: e instanceof AppError ? e.userMessage : "TikTok rejected the stored credentials.", steps: ["Reconnect TikTok"], links: [] },
        details: {},
      };
    }
  }

  private choosePrivacy(options: string[], requested?: string | null): string {
    if (!this.app.audited) return "SELF_ONLY";
    if (requested && options.includes(requested)) return requested;
    for (const pref of ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]) {
      if (options.includes(pref)) return pref;
    }
    return options[0] ?? "SELF_ONLY";
  }

  async publishVideo(creds: SocialCredentials, _account: SocialAccountInfo, input: PublishInput): Promise<PublishResult> {
    const state: ProviderState = { ...input.state };
    if (!state.publishId) {
      let direct = input.mode === "DIRECT";
      let creator: CreatorInfo | null = null;
      if (direct) {
        try {
          creator = await this.creatorInfo(creds);
        } catch (e) {
          if (e instanceof AppError && /SCOPE_NOT_AUTHORIZED/.test(e.code)) direct = false;
          else throw e;
        }
      }
      if (creator?.max_video_post_duration_sec && input.durationSec > creator.max_video_post_duration_sec) {
        throw new AppError({
          code: "TIKTOK_DURATION",
          userMessage: `This video is ${Math.round(input.durationSec)}s but this TikTok creator can post at most ${creator.max_video_post_duration_sec}s.`,
        });
      }
      const size = input.video.size;
      const chunkSize = size <= 64 * 1024 * 1024 ? size : 10 * 1024 * 1024;
      const totalChunks = size <= 64 * 1024 * 1024 ? 1 : Math.floor(size / chunkSize);
      const sourceInfo = { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunks };
      const title = [input.caption, input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")].filter(Boolean).join(" ").slice(0, 2200);
      const privacy = direct && creator ? this.choosePrivacy(creator.privacy_level_options, input.privacy) : null;
      const url = direct ? `${API}/v2/post/publish/video/init/` : `${API}/v2/post/publish/inbox/video/init/`;
      const body = direct
        ? {
            post_info: {
              title,
              privacy_level: privacy,
              disable_comment: creator?.comment_disabled ?? false,
              disable_duet: creator?.duet_disabled ?? false,
              disable_stitch: creator?.stitch_disabled ?? false,
              video_cover_timestamp_ms: 1000,
              is_aigc: input.aiGenerated,
            },
            source_info: sourceInfo,
          }
        : { source_info: sourceInfo };
      const init = await request<TikTokEnvelope<{ publish_id: string; upload_url: string }>>(url, {
        provider: "TikTok",
        method: "POST",
        headers: { Authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify(body),
        describeError: describeTikTok,
      });
      const data = assertOk(init.data);
      state.publishId = data.publish_id;
      state.uploadUrl = data.upload_url;
      state.mode = direct ? "DIRECT" : "DRAFT";
      state.privacy = privacy;
      state.chunkSize = chunkSize;
      state.totalChunks = totalChunks;
      state.uploadedChunks = 0;
      await input.saveState(state);
    }
    if (Number(state.uploadedChunks) < Number(state.totalChunks)) {
      const bytes = await input.video.read();
      const chunkSize = Number(state.chunkSize);
      const total = Number(state.totalChunks);
      for (let i = Number(state.uploadedChunks); i < total; i++) {
        const start = i * chunkSize;
        const end = i === total - 1 ? bytes.length - 1 : start + chunkSize - 1;
        const chunk = bytes.subarray(start, end + 1);
        await request(String(state.uploadUrl), {
          provider: "TikTok",
          method: "PUT",
          headers: { "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${bytes.length}` },
          body: new Uint8Array(chunk),
          timeoutMs: 300_000,
          idempotent: true,
        });
        state.uploadedChunks = i + 1;
        await input.saveState(state);
      }
    }
    for (let i = 0; i < 18; i++) {
      const st = await this.getPublishStatus(creds, _account, state);
      if (st.status === "PUBLISHED") {
        return {
          outcome: "PUBLISHED",
          platformPostId: st.platformPostId ?? String(state.publishId),
          permalink: st.permalink ?? null,
          privacy: String(state.privacy ?? ""),
          state,
          notice: state.privacy === "SELF_ONLY" ? "Published as PRIVATE (SELF_ONLY): the TikTok app is not audited for public posting." : null,
        };
      }
      if (st.status === "SENT_TO_DRAFTS") {
        return { outcome: "SENT_TO_DRAFTS", platformPostId: String(state.publishId), state, notice: "Sent to the creator's TikTok inbox. Open TikTok to finish posting." };
      }
      if (st.status === "FAILED") {
        throw new AppError({ code: "TIKTOK_PUBLISH_FAILED", userMessage: TIKTOK_ERRORS[st.error ?? ""] ?? `TikTok could not publish the video: ${st.error ?? "unknown reason"}` });
      }
      await sleep(5000);
    }
    return { outcome: "PROCESSING", state };
  }

  async getPublishStatus(creds: SocialCredentials, _account: SocialAccountInfo, state: ProviderState): Promise<PostStatus> {
    if (!state.publishId) return { status: "UNKNOWN" };
    const res = await request<TikTokEnvelope<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>>(
      `${API}/v2/post/publish/status/fetch/`,
      {
        provider: "TikTok",
        method: "POST",
        headers: { Authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ publish_id: state.publishId }),
        idempotent: true,
        describeError: describeTikTok,
      },
    );
    const d = assertOk(res.data);
    switch (d.status) {
      case "PUBLISH_COMPLETE": {
        const postId = d.publicaly_available_post_id?.[0];
        return {
          status: "PUBLISHED",
          platformPostId: postId != null ? String(postId) : String(state.publishId),
          permalink: postId != null ? `https://www.tiktok.com/video/${postId}` : null,
        };
      }
      case "SEND_TO_USER_INBOX":
        return { status: "SENT_TO_DRAFTS" };
      case "FAILED":
        return { status: "FAILED", error: d.fail_reason ?? "failed" };
      default:
        return { status: "PROCESSING" };
    }
  }

  async getPost(_creds: SocialCredentials, _account: SocialAccountInfo, platformPostId: string) {
    return { permalink: /^\d+$/.test(platformPostId) ? `https://www.tiktok.com/video/${platformPostId}` : null, exists: true };
  }

  async getMetrics(creds: SocialCredentials, _account: SocialAccountInfo, platformPostId: string): Promise<MetricsSnapshot> {
    if (!/^\d+$/.test(platformPostId)) return { raw: { note: "Metrics are only available for public post ids." } };
    const res = await request<TikTokEnvelope<{ videos: { id: string; view_count?: number; like_count?: number; comment_count?: number; share_count?: number }[] }>>(
      `${API}/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count`,
      {
        provider: "TikTok",
        method: "POST",
        headers: { Authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ filters: { video_ids: [platformPostId] } }),
        idempotent: true,
        describeError: describeTikTok,
      },
    );
    const v = assertOk(res.data).videos?.[0];
    return {
      views: v?.view_count ?? null,
      likes: v?.like_count ?? null,
      comments: v?.comment_count ?? null,
      shares: v?.share_count ?? null,
      raw: (v ?? {}) as Record<string, unknown>,
    };
  }
}
