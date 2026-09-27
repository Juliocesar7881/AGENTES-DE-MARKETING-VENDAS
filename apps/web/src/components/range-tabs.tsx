import Link from "next/link";
import { cn } from "@/lib/utils";

export function RangeTabs({ value, base, options = [7, 30, 90] }: { value: number; base: string; options?: number[] }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/60 p-0.5">
      {options.map((d) => (
        <Link key={d} href={`${base}?range=${d}`} scroll={false} className={cn("inline-flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition hover:text-foreground", value === d && "bg-card text-foreground shadow-card")}>
          {d}d
        </Link>
      ))}
    </div>
  );
}

export function parseRange(v: string | undefined, fallback = 30): number {
  const n = Number(v);
  return [7, 30, 90].includes(n) ? n : fallback;
}
