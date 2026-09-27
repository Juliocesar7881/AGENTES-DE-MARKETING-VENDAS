import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, brandKits, eq, getDb, products, workspaces } from "@revenueos/database";
import { LeadForm } from "./lead-form";
import "@/server/boot";

export const metadata: Metadata = { title: "Fale com a gente", robots: { index: false } };

export default async function LeadPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string }> }) {
  const { slug } = await params;
  const { ref } = await searchParams;
  const [ws] = await getDb().select({ id: workspaces.id, name: workspaces.name, description: workspaces.description, environment: workspaces.environment, status: workspaces.status }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (!ws || ws.status === "ARCHIVED") notFound();
  const [kit] = await getDb().select().from(brandKits).where(eq(brandKits.workspaceId, ws.id)).limit(1);
  const prods = await getDb().select({ name: products.name, priceCents: products.priceCents, currency: products.currency, offer: products.offer }).from(products).where(and(eq(products.workspaceId, ws.id), eq(products.active, true))).orderBy(asc(products.sort)).limit(4);
  const primary = kit?.primaryColor ?? "#6D5BFF";
  const bg = kit?.backgroundColor ?? "#0B0F14";
  const fg = kit?.textColor ?? "#F5F7FA";
  return (
    <main className="flex min-h-dvh items-center justify-center p-5" style={{ background: `radial-gradient(90% 60% at 20% 0%, ${primary}40, transparent 60%), ${bg}`, color: fg }}>
      <div className="w-full max-w-md">
        {ws.environment === "DEMO" ? <div className="mb-3 rounded-md bg-white/10 px-3 py-1.5 text-center text-xs">Demonstração — dados simulados</div> : null}
        <h1 className="text-2xl font-bold tracking-tight">{kit?.businessName ?? ws.name}</h1>
        <p className="mt-1 text-sm opacity-80">{kit?.description || ws.description}</p>
        {prods.length ? (
          <ul className="mt-4 space-y-1.5 text-sm">
            {prods.map((p) => (
              <li key={p.name} className="flex justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                <span>{p.name}</span>
                <span className="font-semibold">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: p.currency }).format(p.priceCents / 100)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <LeadForm slug={slug} refCode={ref ?? null} color={primary} />
        <p className="mt-4 text-center text-[11px] opacity-60">Seus dados são usados apenas para este atendimento. Você pode pedir a exclusão a qualquer momento respondendo “SAIR”.</p>
      </div>
    </main>
  );
}
