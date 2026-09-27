"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  ["", "Overview"],
  ["/content", "Content"],
  ["/calendar", "Calendar"],
  ["/crm", "CRM"],
  ["/inbox", "Inbox"],
  ["/sales", "Sales"],
  ["/analytics", "Analytics"],
  ["/brand", "Brand"],
  ["/products", "Products"],
  ["/connections", "Connections"],
  ["/settings", "Settings"],
] as const;

export function WorkspaceTabs({ slug, counts }: { slug: string; counts?: Partial<Record<string, number>> }) {
  const path = usePathname();
  const base = `/w/${slug}`;
  return (
    <nav className="-mx-4 mb-6 overflow-x-auto border-b border-border px-4 md:-mx-8 md:px-8">
      <div className="flex min-w-max gap-1">
        {TABS.map(([p, label]) => {
          const href = base + p;
          const active = p === "" ? path === base : path === href || path.startsWith(`${href}/`);
          const n = counts?.[p];
          return (
            <Link key={p} href={href} className={cn("relative flex h-10 items-center gap-1.5 px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground", active && "text-foreground")}>
              {label}
              {n ? <span className="rounded bg-primary/15 px-1 text-[10px] font-semibold text-primary">{n}</span> : null}
              {active ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" /> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
