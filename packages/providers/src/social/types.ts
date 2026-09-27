import type { Platform, PlatformCapabilities } from "@revenueos/shared";

export interface ActionRequiredInfo {
  reason: string;
  steps: string[];
  links: { label: string; url: string }[];
  missingScopes?: string[];
}

export interface SocialAppConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiVersion?: string;
  /** TikTok: whether the app passed TikTok's audit (unaudited apps can only post SELF_ONLY). */
  audited?: boolean;
}

export interface SocialCredentials {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
  /** Provider-specific extra secrets (e.g. Facebook Page access token). */
  extra?: Record<string, string>;
}

export interface SocialAccountInfo {
  externalAccountId: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  scopes: string[];
  metadata?: Record<string, unknown>;
}

export interface ConnectResult {
  credentials: SocialCredentials;
  account: SocialAccountInfo;
}

export interface VideoSource {
  size: number;
  /** Public/signed URL, when the platform can pull the file itself. */
  url?: string | null;
  read: () => Promise<Buffer>;
  thumbnail?: () => Promise<Buffer | null>;
}

export type ProviderState = Record<string, unknown>;

export interface PublishInput {
  idempotencyKey: string;
  video: VideoSource;
  caption: string;
  title?: string | null;
  hashtags: string[];
  privacy?: string | null;
  mode: "DIRECT" | "DRAFT";
  aiGenerated: boolean;
  durationSec: number;
  /** State persisted by previous attempts; providers resume instead of re-uploading. */
  state: ProviderState;
  /** Persist intermediate progress (container ids, upload ids…) before long waits. */
  saveState: (state: ProviderState) => Promise<void>;
}

export type PublishOutcome = "PUBLISHED" | "PROCESSING" | "SENT_TO_DRAFTS";

export interface PublishResult {
  outcome: PublishOutcome;
  platformPostId?: string | null;
  permalink?: string | null;
  privacy?: string | null;
  state: ProviderState;
  notice?: string | null;
}

export interface PostStatus {
  status: "PROCESSING" | "PUBLISHED" | "FAILED" | "SENT_TO_DRAFTS" | "UNKNOWN";
  platformPostId?: string | null;
  permalink?: string | null;
  error?: string | null;
}

export interface MetricsSnapshot {
  views?: number | null;
  reach?: number | null;
  impressions?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  clicks?: number | null;
  watchTimeMs?: number | null;
  avgWatchMs?: number | null;
  raw: Record<string, unknown>;
}

export interface ConnectionTestResult {
  authenticated: boolean;
  permissionsOk: boolean;
  accountOk: boolean;
  publishPermissionOk: boolean;
  missingScopes: string[];
  account?: SocialAccountInfo | null;
  actionRequired?: ActionRequiredInfo | null;
  details: Record<string, unknown>;
}

export interface SocialProvider {
  readonly platform: Platform;
  readonly capabilities: PlatformCapabilities;
  readonly isMock: boolean;
  /** Whether this provider uses PKCE in the OAuth flow. */
  readonly usesPkce: boolean;
  /** Step 1 of connect(): the official OAuth authorization URL. */
  connect(opts: { state: string; codeChallenge?: string }): string;
  /** Step 2 of connect(): exchange the callback code for credentials + account. */
  completeConnect(opts: { code: string; codeVerifier?: string }): Promise<ConnectResult>;
  refreshAuth(creds: SocialCredentials): Promise<SocialCredentials | null>;
  disconnect(creds: SocialCredentials): Promise<void>;
  validateConnection(creds: SocialCredentials, account: SocialAccountInfo): Promise<ConnectionTestResult>;
  getAccount(creds: SocialCredentials): Promise<SocialAccountInfo>;
  publishVideo(creds: SocialCredentials, account: SocialAccountInfo, input: PublishInput): Promise<PublishResult>;
  getPublishStatus(creds: SocialCredentials, account: SocialAccountInfo, state: ProviderState): Promise<PostStatus>;
  getPost(creds: SocialCredentials, account: SocialAccountInfo, platformPostId: string): Promise<{ permalink?: string | null; exists: boolean }>;
  getMetrics(creds: SocialCredentials, account: SocialAccountInfo, platformPostId: string, state: ProviderState): Promise<MetricsSnapshot>;
}

export function missingScopes(required: string[], granted: string[]): string[] {
  const g = new Set(granted.map((s) => s.trim()).filter(Boolean));
  return required.filter((r) => !g.has(r));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
