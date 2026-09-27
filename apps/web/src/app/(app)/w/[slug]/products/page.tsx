import { asc, eq, products, withUser } from "@revenueos/database";
import { ProductsManager } from "@/components/brand/product-editor";
import { requireWorkspace } from "@/server/session";

export default async function ProductsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, ws } = await requireWorkspace(slug);
  const rows = await withUser(user.id, (tx) => tx.select().from(products).where(eq(products.workspaceId, ws.id)).orderBy(asc(products.sort), asc(products.createdAt)));
  return (
    <ProductsManager
      workspaceId={ws.id}
      currency={ws.currency}
      products={rows.map((p) => ({ id: p.id, name: p.name, description: p.description, type: p.type, priceCents: p.priceCents, currency: p.currency, benefits: p.benefits, features: p.features, faq: p.faq, limitations: p.limitations, offer: p.offer, checkoutUrl: p.checkoutUrl, support: p.support, terms: p.terms, active: p.active }))}
    />
  );
}
