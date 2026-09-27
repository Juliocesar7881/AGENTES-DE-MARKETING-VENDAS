import type { Platform } from "./enums";
import type { VideoFormat } from "./schemas/video-spec";

/**
 * Declarative description of what each platform accepts. UI and business
 * logic read these objects — no platform rules are hard-coded in components.
 * Values reflect the official APIs' documented limits; providers can refine
 * them at runtime (e.g. TikTok creator_info returns a per-creator max duration).
 */
export interface PlatformCapabilities {
  platform: Platform;
  displayName: string;
  maxDurationSec: number;
  minDurationSec: number;
  maxFileSizeBytes: number;
  supportedFormats: VideoFormat[];
  preferredFormat: VideoFormat;
  supportsSchedule: boolean;
  supportsDirectPost: boolean;
  supportsDraftUpload: boolean;
  supportsAnalytics: boolean;
  supportsThumbnail: boolean;
  supportsAiLabel: boolean;
  requiresReview: boolean;
  requiresPublicVideoUrl: boolean;
  captionMaxLength: number;
  maxHashtags: number;
  dailyPublishLimit: number | null;
  oauthScopes: string[];
  developerPortalUrl: string;
  docsUrl: string;
}

const MB = 1024 * 1024;

export const PLATFORM_CAPABILITIES: Record<Platform, PlatformCapabilities> = {
  INSTAGRAM: {
    platform: "INSTAGRAM",
    displayName: "Instagram Reels",
    maxDurationSec: 180,
    minDurationSec: 3,
    maxFileSizeBytes: 300 * MB,
    supportedFormats: ["9:16", "1:1"],
    preferredFormat: "9:16",
    supportsSchedule: false,
    supportsDirectPost: true,
    supportsDraftUpload: false,
    supportsAnalytics: true,
    supportsThumbnail: true,
    supportsAiLabel: false,
    requiresReview: true,
    requiresPublicVideoUrl: false,
    captionMaxLength: 2200,
    maxHashtags: 30,
    dailyPublishLimit: 50,
    oauthScopes: [
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_messages",
      "instagram_business_manage_insights",
    ],
    developerPortalUrl: "https://developers.facebook.com/apps/",
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
  },
  FACEBOOK: {
    platform: "FACEBOOK",
    displayName: "Facebook Reels",
    maxDurationSec: 90,
    minDurationSec: 3,
    maxFileSizeBytes: 1024 * MB,
    supportedFormats: ["9:16"],
    preferredFormat: "9:16",
    supportsSchedule: true,
    supportsDirectPost: true,
    supportsDraftUpload: true,
    supportsAnalytics: true,
    supportsThumbnail: false,
    supportsAiLabel: false,
    requiresReview: true,
    requiresPublicVideoUrl: false,
    captionMaxLength: 5000,
    maxHashtags: 30,
    dailyPublishLimit: 30,
    oauthScopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "read_insights"],
    developerPortalUrl: "https://developers.facebook.com/apps/",
    docsUrl: "https://developers.facebook.com/docs/video-api/guides/reels-publishing",
  },
  TIKTOK: {
    platform: "TIKTOK",
    displayName: "TikTok",
    maxDurationSec: 600,
    minDurationSec: 3,
    maxFileSizeBytes: 4 * 1024 * MB,
    supportedFormats: ["9:16", "1:1", "16:9"],
    preferredFormat: "9:16",
    supportsSchedule: false,
    supportsDirectPost: true,
    supportsDraftUpload: true,
    supportsAnalytics: true,
    supportsThumbnail: false,
    supportsAiLabel: true,
    requiresReview: true,
    requiresPublicVideoUrl: false,
    captionMaxLength: 2200,
    maxHashtags: 10,
    dailyPublishLimit: 15,
    oauthScopes: ["user.info.basic", "video.publish", "video.upload", "video.list"],
    developerPortalUrl: "https://developers.tiktok.com/apps/",
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
  },
  YOUTUBE: {
    platform: "YOUTUBE",
    displayName: "YouTube Shorts",
    maxDurationSec: 180,
    minDurationSec: 1,
    maxFileSizeBytes: 256 * 1024 * MB,
    supportedFormats: ["9:16", "1:1", "16:9"],
    preferredFormat: "9:16",
    supportsSchedule: true,
    supportsDirectPost: true,
    supportsDraftUpload: true,
    supportsAnalytics: true,
    supportsThumbnail: true,
    supportsAiLabel: true,
    requiresReview: true,
    requiresPublicVideoUrl: false,
    captionMaxLength: 5000,
    maxHashtags: 15,
    dailyPublishLimit: null,
    oauthScopes: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    developerPortalUrl: "https://console.cloud.google.com/apis/credentials",
    docsUrl: "https://developers.google.com/youtube/v3/guides/uploading_a_video",
  },
  MOCK: {
    platform: "MOCK",
    displayName: "Mock Social (DEMO)",
    maxDurationSec: 600,
    minDurationSec: 1,
    maxFileSizeBytes: 4 * 1024 * MB,
    supportedFormats: ["9:16", "1:1", "16:9"],
    preferredFormat: "9:16",
    supportsSchedule: true,
    supportsDirectPost: true,
    supportsDraftUpload: true,
    supportsAnalytics: true,
    supportsThumbnail: true,
    supportsAiLabel: true,
    requiresReview: false,
    requiresPublicVideoUrl: false,
    captionMaxLength: 5000,
    maxHashtags: 30,
    dailyPublishLimit: null,
    oauthScopes: [],
    developerPortalUrl: "",
    docsUrl: "",
  },
};

export function getCapabilities(platform: Platform): PlatformCapabilities {
  return PLATFORM_CAPABILITIES[platform];
}

/** Longest duration acceptable for every platform in the list. */
export function maxDurationFor(platforms: Platform[]): number {
  if (platforms.length === 0) return 90;
  return Math.min(...platforms.map((p) => PLATFORM_CAPABILITIES[p].maxDurationSec));
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  MOCK: "Mock",
};
