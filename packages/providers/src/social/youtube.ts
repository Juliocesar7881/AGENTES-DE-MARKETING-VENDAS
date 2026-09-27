import { AppError, PLATFORM_CAPABILITIES } from "@revenueos/shared";
import { request } from "../http";
import {
  missingScopes,
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

const REQUIRED = ["https://www.googleapis.com/auth/youtube.upload"];

function describeGoogle(_status: number, body: unknown) {
  const err = (body as { error?: { message?: string; errors?: { reason?: string }[] } | string; error_description?: string })?.error;
  if (!err) return undefined;
  if (typeof err === "string") {
    if (err === "invalid_grant") return { code: "YT_INVALID_GRANT", userMessage: "Google revoked or expired the YouTube authorization. Reconnect YouTube in Integrations." };
    return { code: `YT_${err.toUpperCase()}`, userMessage: `Google OAuth error: ${err}` };
  }
  const reason = err.errors?.[0]?.reason ?? "";
  const map: Record<string, string> = {
    quotaExceeded: "YouTube Data API daily quota exhausted (each upload costs ~1,600 units of the default 10,000/day). Posting resumes after the quota resets (midnight Pacific).",
    uploadLimitExceeded: "YouTube upload limit reached for this channel. Try again later.",
    forbidden: "YouTube denied the upload: the channel or app is missing permission.",
    youtubeSignupRequired: "This Google account has no YouTube channel. Create a channel and reconnect.",
    invalidTitle: "YouTube rejected the title.",
    invalidDescription: "YouTube rejected the description.",
  };
  return { code: `YT_${reason || "ERROR"}`, userMessage: map[reason] ?? `YouTube: ${err.message ?? reason}` };
}

/**
 * YouTube Data API v3 — resumable upload, privacy, AI disclosure
 * (status.containsSyntheticMedia), optional thumbnail, status and statistics.
 * Vertical ≤180s uploads are surfaced by YouTube as Shorts.
 */
export class YouTubeProvider implements SocialProvider {
  readonly platform = "YOUTUBE" as const;
  readonly capabilities = PLATFORM_CAPABILITIES.YOUTUBE;
  readonly isMock = false;
  readonly usesPkce = true;

  constructor(private readonly app: SocialAppConfig) {}

  connect(opts: { state: string; codeChallenge?: string }): string {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", this.app.clientId);
    u.searchParams.set("redirect_uri", this.app.redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", this.capabilities.oauthScopes.join(" "));
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("include_granted_scopes", "true");
    u.searchParams.set("state", opts.state);
    if (opts.codeChallenge) {
      u.searchParams.set("code_challenge", opts.codeChallenge);
      u.searchParams.set("code_challenge_method", "S256");
    }
    return u.toString();
  }

  async completeConnect(opts: { code: string; codeVerifier?: string }): Promise<ConnectResult> {
    const form: Record<string, string> = {
      code: opts.code,
      client_id: this.app.clientId,
      client_secret: this.app.clientSecret,
      redirect_uri: this.app.redirectUri,
      grant_type: "authorization_code",
    };
    if (opts.codeVerifier) form.code_verifier = opts.codeVerifier;
    const res = await request<{ access_token: string; refresh_token?: string; expires_in: number; scope: string }>("https://oauth2.googleapis.com/token", {
      provider: "YouTube",
      form,
      describeError: describeGoogle,
    });
    if (!res.data.refresh_token) {
      throw new AppError({
        code: "YT_NO_REFRESH",
        userMessage: "Google did not return a refresh token. Remove RevenueOS from your Google account permissions and connect again.",
      });
    }
    const credentials: SocialCredentials = {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresAt: new Date(Date.now() + res.data.expires_in * 1000),
    };
    const account = await this.getAccount(credentials);
    account.scopes = res.data.scope.split(" ");
    return { credentials, account };
  }

  async refreshAuth(creds: SocialCredentials): Promise<SocialCredentials | null> {
    if (!creds.refreshToken) return null;
    const res = await request<{ access_token: string; expires_in: number }>("https://oauth2.googleapis.com/token", {
      provider: "YouTube",
      form: { client_id: this.app.clientId, client_secret: this.app.clientSecret, refresh_token: creds.refreshToken, grant_type: "refresh_token" },
      idempotent: true,
      describeError: describeGoogle,
    });
    return { accessToken: res.data.access_token, refreshToken: creds.refreshToken, expiresAt: new Date(Date.now() + res.data.expires_in * 1000) };
  }

  async disconnect(creds: SocialCredentials): Promise<void> {
    try {
      await request(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(creds.refreshToken ?? creds.accessToken)}`, {
        provider: "YouTube",
        method: "POST",
        form: {},
      });
    } catch {
      /* best effort */
    }
  }

  async getAccount(creds: SocialCredentials): Promise<SocialAccountInfo> {
    const res = await request<{ items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } } }[] }>(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet,status&mine=true",
      { provider: "YouTube", headers: { Authorization: `Bearer ${creds.accessToken}` }, describeError: describeGoogle },
    );
    const ch = res.data.items?.[0];
    if (!ch) {
      throw new AppError({ code: "YT_NO_CHANNEL", userMessage: "This Google account has no YouTube channel. Create one and reconnect." });
    }
    return {
      externalAccountId: ch.id,
      username: ch.snippet.customUrl ?? ch.snippet.title,
      displayName: ch.snippet.title,
      avatarUrl: ch.snippet.thumbnails?.default?.url ?? null,
      scopes: [],
    };
  }

  async validateConnection(creds: SocialCredentials, account: SocialAccountInfo): Promise<ConnectionTestResult> {
    try {
      const info = await request<{ scope?: string }>(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(creds.accessToken)}`, {
        provider: "YouTube",
        describeError: describeGoogle,
      });
      const granted = (info.data.scope ?? account.scopes.join(" ")).split(" ");
      const missing = missingScopes(REQUIRED, granted);
      const me = await this.getAccount(creds);
      return {
        authenticated: true,
        accountOk: me.externalAccountId === account.externalAccountId,
        permissionsOk: missing.length === 0,
        publishPermissionOk: missing.length === 0,
        missingScopes: missing,
        account: me,
        actionRequired:
          missing.length > 0
            ? {
                reason: "The YouTube connection is missing the upload permission.",
                steps: ["Click Reconnect and approve 'Manage your YouTube videos'"],
                links: [],
                missingScopes: missing,
              }
            : {
                reason:
                  "Note: videos uploaded through Google Cloud projects that have not completed the YouTube API audit are locked as private. Request an audit to publish publicly.",
                steps: ["Open the YouTube API Services audit form", "Describe RevenueOS usage (uploading your own channel's videos)"],
                links: [{ label: "YouTube API audit", url: "https://support.google.com/youtube/contact/yt_api_form" }],
              },
        details: { granted },
      };
    } catch (e) {
      return {
        authenticated: false,
        accountOk: false,
        permissionsOk: false,
        publishPermissionOk: false,
        missingScopes: REQUIRED,
        actionRequired: { reason: e instanceof AppError ? e.userMessage : "Google rejected the stored credentials.", steps: ["Reconnect YouTube"], links: [] },
        details: {},
      };
    }
  }

  async publishVideo(creds: SocialCredentials, _account: SocialAccountInfo, input: PublishInput): Promise<PublishResult> {
    const state: ProviderState = { ...input.state };
    const privacy = input.privacy && ["public", "unlisted", "private"].includes(input.privacy) ? input.privacy : input.mode === "DRAFT" ? "private" : "public";
    if (!state.videoId) {
      if (!state.uploadUrl) {
        const title = (input.title || input.caption.split("\n")[0] || "Short").slice(0, 100);
        const description = [input.caption, input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")].filter(Boolean).join("\n\n").slice(0, 4900);
        const init = await request<null>(
          "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
          {
            provider: "YouTube",
            method: "POST",
            headers: {
              Authorization: `Bearer ${creds.accessToken}`,
              "content-type": "application/json; charset=UTF-8",
              "x-upload-content-length": String(input.video.size),
              "x-upload-content-type": "video/mp4",
            },
            body: JSON.stringify({
              snippet: { title, description, tags: input.hashtags.map((h) => h.replace(/^#/, "")).slice(0, 15), categoryId: "22" },
              status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: input.aiGenerated },
            }),
            describeError: describeGoogle,
          },
        );
        const location = init.headers.get("location");
        if (!location) throw new AppError({ code: "YT_NO_UPLOAD_URL", userMessage: "YouTube did not return an upload session.", retryable: true });
        state.uploadUrl = location;
        state.privacy = privacy;
        await input.saveState(state);
      }
      const bytes = await input.video.read();
      const uploaded = await request<{ id: string; status?: { uploadStatus?: string; privacyStatus?: string } }>(String(state.uploadUrl), {
        provider: "YouTube",
        method: "PUT",
        headers: { Authorization: `Bearer ${creds.accessToken}`, "content-type": "video/mp4" },
        body: new Uint8Array(bytes),
        timeoutMs: 600_000,
        idempotent: true,
        describeError: describeGoogle,
      });
      state.videoId = uploaded.data.id;
      await input.saveState(state);
      if (input.video.thumbnail) {
        try {
          const thumb = await input.video.thumbnail();
          if (thumb) {
            await request(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${uploaded.data.id}`, {
              provider: "YouTube",
              method: "POST",
              headers: { Authorization: `Bearer ${creds.accessToken}`, "content-type": "image/jpeg" },
              body: new Uint8Array(thumb),
            });
          }
        } catch {
          /* custom thumbnails require a verified channel — optional */
        }
      }
    }
    const st = await this.getPublishStatus(creds, _account, state);
    if (st.status === "FAILED") throw new AppError({ code: "YT_PROCESSING_FAILED", userMessage: `YouTube could not process the video: ${st.error}` });
    return {
      outcome: "PUBLISHED",
      platformPostId: String(state.videoId),
      permalink: `https://www.youtube.com/shorts/${state.videoId}`,
      privacy: String(state.privacy ?? privacy),
      state,
      notice: state.privacy !== "public" ? `Uploaded as ${String(state.privacy).toUpperCase()}.` : null,
    };
  }

  async getPublishStatus(creds: SocialCredentials, _account: SocialAccountInfo, state: ProviderState): Promise<PostStatus> {
    if (!state.videoId) return { status: "UNKNOWN" };
    const res = await request<{ items?: { status?: { uploadStatus?: string; failureReason?: string; rejectionReason?: string } }[] }>(
      `https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${state.videoId}`,
      { provider: "YouTube", headers: { Authorization: `Bearer ${creds.accessToken}` }, describeError: describeGoogle },
    );
    const s = res.data.items?.[0]?.status;
    if (!s) return { status: "UNKNOWN" };
    if (s.uploadStatus === "failed" || s.uploadStatus === "rejected") return { status: "FAILED", error: s.failureReason ?? s.rejectionReason ?? s.uploadStatus };
    return { status: "PUBLISHED", platformPostId: String(state.videoId), permalink: `https://www.youtube.com/shorts/${state.videoId}` };
  }

  async getPost(creds: SocialCredentials, _account: SocialAccountInfo, platformPostId: string) {
    const res = await request<{ items?: unknown[] }>(`https://www.googleapis.com/youtube/v3/videos?part=id&id=${platformPostId}`, {
      provider: "YouTube",
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    const exists = (res.data.items?.length ?? 0) > 0;
    return { permalink: exists ? `https://www.youtube.com/shorts/${platformPostId}` : null, exists };
  }

  async getMetrics(creds: SocialCredentials, _account: SocialAccountInfo, platformPostId: string): Promise<MetricsSnapshot> {
    const res = await request<{ items?: { statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${platformPostId}`,
      { provider: "YouTube", headers: { Authorization: `Bearer ${creds.accessToken}` }, describeError: describeGoogle },
    );
    const st = res.data.items?.[0]?.statistics;
    const n = (v?: string) => (v != null ? Number(v) : null);
    return { views: n(st?.viewCount), likes: n(st?.likeCount), comments: n(st?.commentCount), raw: (st ?? {}) as Record<string, unknown> };
  }
}
