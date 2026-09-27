import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getUser } from "@/server/session";
import { Logo } from "@/components/logo";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (await getUser().catch(() => null)) redirect("/overview");
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top_left,black_20%,transparent_70%)]" />
        <div className="pointer-events-none absolute -top-40 -left-40 size-[520px] rounded-full bg-primary/20 blur-[120px]" />
        <Logo className="relative" />
        <div className="relative max-w-md">
          <h2 className="text-3xl leading-tight font-semibold tracking-[-0.03em]">
            From business to revenue,
            <br />
            <span className="bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">on autopilot.</span>
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Strategy, motion-design videos, publishing, leads, sales conversations, checkout and attribution — one engine for every business you run, with humans in control.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              ["Videos / day", "6"],
              ["Businesses", "3"],
              ["Attributed revenue", "R$ ↑"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border bg-card/60 p-3 backdrop-blur">
                <div className="text-[11px] text-muted-foreground">{k}</div>
                <div className="mt-1 text-lg font-semibold">{v}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-subtle">Rendering runs on your own computer. Your data stays in your database.</p>
      </aside>
      <main className="flex items-center justify-center p-6">{children}</main>
    </div>
  );
}
