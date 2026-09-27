import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RevenueOS", template: "%s · RevenueOS" },
  description: "Autonomous revenue engine: content, leads, sales and attribution for every business you run.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0b0f" },
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <Script id="rvos-theme" strategy="beforeInteractive" nonce={nonce}>
          {THEME_SCRIPT}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
