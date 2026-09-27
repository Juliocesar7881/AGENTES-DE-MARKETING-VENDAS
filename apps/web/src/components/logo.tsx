import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-7", className)} aria-hidden>
      <defs>
        <linearGradient id="rvos-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7C6CFF" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#rvos-g)" />
      <path d="M18 44V20h14.5c5.8 0 9.5 3.4 9.5 8.4 0 3.9-2.2 6.7-5.8 7.8L44 44h-7.6l-6.8-7.3H25V44h-7zm7-13.2h7c2.3 0 3.8-1.2 3.8-3.2s-1.5-3.2-3.8-3.2h-7v6.4z" fill="#fff" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-[-0.02em]">RevenueOS</span>
    </div>
  );
}
