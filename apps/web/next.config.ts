import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Single .env at the repository root (shared by the dashboard, worker and scripts).
loadEnvConfig(root, process.env.NODE_ENV !== "production");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@revenueos/shared", "@revenueos/core", "@revenueos/database", "@revenueos/providers", "@revenueos/agents", "@revenueos/video-engine"],
  // Native / heavy Node packages stay external to the server bundle.
  serverExternalPackages: ["postgres", "sharp", "@remotion/renderer", "@remotion/bundler", "playwright-core", "node-html-parser"],
  outputFileTracingRoot: root,
  turbopack: { root },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
