import { Clapperboard } from "lucide-react";
import { cn } from "@/lib/utils";

/** Card cover: real render thumbnail when available, otherwise a brand-colored poster with the hook. */
export function Poster({ src, hook, color, format = "9:16", className, label }: { src?: string | null; hook?: string | null; color: string; format?: string; className?: string; label?: string | null }) {
  const aspect = format === "1:1" ? "aspect-square" : format === "16:9" ? "aspect-video" : "aspect-[9/16]";
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-muted", aspect, className)}>
      {src ? (
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <div className="flex size-full flex-col justify-end p-3" style={{ background: `radial-gradient(120% 80% at 20% 10%, ${color}cc, transparent 60%), linear-gradient(160deg, ${color}55, #0b0f14 70%)` }}>
          <Clapperboard className="mb-auto size-4 text-white/60" />
          <div className="line-clamp-4 text-[13px] leading-snug font-semibold text-white drop-shadow">{hook ?? "Generating…"}</div>
        </div>
      )}
      {label ? <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">{label}</span> : null}
    </div>
  );
}
