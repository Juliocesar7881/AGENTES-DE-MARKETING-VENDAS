import { notFound } from "next/navigation";
import { checkouts, eq, getDb, products, workspaces } from "@revenueos/database";
import { DemoPay } from "./demo-pay";
import "@/server/boot";

/** DEMO-only checkout page. Real businesses use Mercado Pago / Stripe hosted checkouts. */
export default async function DemoCheckout({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const [row] = await getDb().select({ c: checkouts, ws: workspaces.name, env: workspaces.environment, product: products.name }).from(checkouts).innerJoin(workspaces, eq(workspaces.id, checkouts.workspaceId)).leftJoin(products, eq(products.id, checkouts.productId)).where(eq(checkouts.externalReference, decodeURIComponent(ref))).limit(1);
  if (!row || row.env !== "DEMO") notFound();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-5">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-pop">
        <div className="mb-4 rounded-md bg-info-soft px-3 py-1.5 text-center text-xs font-medium text-info">DEMO checkout — no real money moves</div>
        <div className="text-sm text-muted-foreground">{row.ws}</div>
        <div className="mt-1 text-lg font-semibold">{row.product ?? "Order"}</div>
        <div className="tabular mt-3 text-3xl font-bold">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: row.c.currency }).format(row.c.amountCents / 100)}</div>
        <DemoPay externalReference={row.c.externalReference} status={row.c.status} />
        <p className="mt-4 text-[11px] text-muted-foreground">Paying here sends a signed test webhook through the same verification pipeline as Mercado Pago and Stripe.</p>
      </div>
    </main>
  );
}
