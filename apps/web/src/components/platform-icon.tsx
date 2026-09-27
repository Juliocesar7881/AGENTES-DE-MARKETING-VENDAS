import { cn } from "@/lib/utils";

const STYLE: Record<string, { label: string; short: string; bg: string }> = {
  INSTAGRAM: { label: "Instagram", short: "IG", bg: "linear-gradient(135deg,#f58529,#dd2a7b 50%,#8134af)" },
  FACEBOOK: { label: "Facebook", short: "f", bg: "#1877f2" },
  TIKTOK: { label: "TikTok", short: "TT", bg: "#111" },
  YOUTUBE: { label: "YouTube", short: "YT", bg: "#e62117" },
  MOCK: { label: "Demo channel", short: "D", bg: "#6b7280" },
  WHATSAPP: { label: "WhatsApp", short: "WA", bg: "#25d366" },
  WEBFORM: { label: "Web form", short: "WF", bg: "#6d5bff" },
  MANUAL: { label: "Manual", short: "M", bg: "#6b7280" },
};

export function platformLabel(p: string | null | undefined): string {
  return p ? (STYLE[p]?.label ?? p) : "—";
}

export function PlatformIcon({ platform, size = 20, className }: { platform: string | null | undefined; size?: number; className?: string }) {
  const s = STYLE[platform ?? ""] ?? { label: platform ?? "?", short: (platform ?? "?").slice(0, 2), bg: "#6b7280" };
  return (
    <span
      title={s.label}
      aria-label={s.label}
      className={cn("inline-grid shrink-0 place-items-center rounded-[6px] font-bold text-white ring-1 ring-white/10", className)}
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42), background: s.bg }}
    >
      {s.short}
    </span>
  );
}
