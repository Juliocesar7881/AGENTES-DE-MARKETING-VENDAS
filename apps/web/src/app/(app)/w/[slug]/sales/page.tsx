import { CircleDollarSign, Receipt, RotateCcw, Target } from "lucide-react";
import Link from "next/link";
import { and, checkouts, contents, desc, eq, gte, integrations, leads, payments, products, sql, withUser } from "@revenueos/database";
import { ManualSaleButton } from "@/components/crm/manual-sale-button";
import { RangeTabs, parseRange } from "@/components/range-tabs";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, StatCard, Table, TBody, TD, TH, THead, TR } from "@/components/ui/misc";
import { PAYMENT_STATUS } from "@/lib/status";
import { dateTime, money } from "@/lib/utils";
import { requireWorkspace } from "@/server/session";

export default async function SalesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ range?: string }> }) {
  const { slug } = await params;
  const range = parseRange((await searchParams).range);
  const { user, ws } = await requireWorkspace(slug);
  const from = new Date(Date.now() - range * 86400_000);
  const d = await withUser(user.id, async (tx) => {
    const pays = await tx
      .select({ p: payments, lead: leads.name, leadId: leads.id, product: products.name, content: contents.hook, contentNumber: contents.number })
      .from(payments)
      .leftJoin(leads, eq(leads.id, payments.leadId))
      .leftJoin(products, eq(products.id, payments.productId))
      .leftJoin(contents, eq(contents.id, payments.contentId))
      .where(and(eq(payments.workspaceId, ws.id), gte(payments.createdAt, from)))
      .orderBy(desc(payments.createdAt))
      .limit(200);
    const chks = await tx
      .select({ c: checkouts, lead: leads.name, leadId: leads.id, product: products.name })
      .from(checkouts)
      .leftJoin(leads, eq(leads.id, checkouts.leadId))
      .leftJoin(products, eq(products.id, checkouts.productId))
      .where(and(eq(checkouts.workspaceId, ws.id), gte(checkouts.createdAt, from)))
      .orderBy(desc(checkouts.createdAt))
      .limit(100);
    const prods = await tx.select({ id: products.id, name: products.name, priceCents: products.priceCents }).from(products).where(and(eq(products.workspaceId, ws.id), eq(products.active, true)));
    const payInteg = await tx.select({ key: integrations.key, status: integrations.status }).from(integrations).where(and(eq(integrations.workspaceId, ws.id), sql`${integrations.key} IN ('mercadopago','stripe')`));
    return { pays, chks, prods, payInteg };
  });
  const approved = d.pays.filter((x) => x.p.status === "APPROVED");
  const revenue = approved.reduce((s, x) => s + x.p.amountCents, 0);
  const refunded = d.pays.filter((x) => x.p.status === "REFUNDED").reduce((s, x) => s + x.p.amountCents, 0);
  const manual = approved.filter((x) => x.p.source === "MANUAL").reduce((s, x) => s + x.p.amountCents, 0);
  const paidChk = d.chks.filter((x) => x.c.status === "PAID").length;
  const provider = ws.environment === "DEMO" ? "Demo checkout (simulated)" : d.payInteg.find((i) => i.status === "CONNECTED")?.key ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          Payment provider:{" "}
          {provider ? (
            <Badge tone="success">{provider === "mercadopago" ? "Mercado Pago" : provider === "stripe" ? "Stripe" : provider}</Badge>
          ) : (
            <Link href={`/w/${slug}/connections`} className="text-warning hover:underline">
              not connected — connect Mercado Pago or Stripe
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <RangeTabs value={range} base={`/w/${slug}/sales`} />
          <ManualSaleButton workspaceId={ws.id} currency={ws.currency} products={d.prods} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Confirmed revenue" value={money(revenue, ws.currency)} icon={CircleDollarSign} hint={manual ? `${money(manual, ws.currency)} recorded manually` : "all via payment webhooks"} />
        <StatCard label="Sales" value={approved.length} icon={Receipt} hint={approved.length ? `avg ticket ${money(Math.round(revenue / approved.length), ws.currency)}` : "—"} />
        <StatCard label="Checkout conversion" value={d.chks.length ? `${Math.round((paidChk / d.chks.length) * 100)}%` : "—"} icon={Target} hint={`${paidChk} of ${d.chks.length} links paid`} />
        <StatCard label="Refunds" value={money(refunded, ws.currency)} icon={RotateCcw} hint="deducted from attributed revenue" />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Payments</CardTitle>
            <CardDescription>Approved only after a verified webhook and an official status query — never because the AI said so.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-2">
          {d.pays.length === 0 ? (
            <EmptyState icon={Receipt} title="No payments in this period" className="mx-3" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Customer</TH>
                  <TH>Product</TH>
                  <TH>Attributed content</TH>
                  <TH>Source</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {d.pays.map(({ p, lead, leadId, product, content, contentNumber }) => (
                  <TR key={p.id}>
                    <TD className="text-[12px] whitespace-nowrap text-muted-foreground">{dateTime(p.approvedAt ?? p.createdAt, ws.timezone)}</TD>
                    <TD>{leadId ? <Link href={`/w/${slug}/crm/${leadId}`} className="hover:underline">{lead || "Lead"}</Link> : <span className="text-muted-foreground">—</span>}</TD>
                    <TD>{product ?? "—"}</TD>
                    <TD className="max-w-[220px] truncate text-[12px]">{p.contentId ? <Link href={`/w/${slug}/content/${p.contentId}`} className="hover:underline">#{contentNumber} {content}</Link> : <span className="text-muted-foreground">not attributed</span>}</TD>
                    <TD>
                      <Badge tone={p.source === "MANUAL" ? "warning" : "neutral"}>{p.source === "MANUAL" ? "manual" : p.provider.toLowerCase()}</Badge>
                      {p.isDemo ? <Badge tone="info" className="ml-1">demo</Badge> : null}
                    </TD>
                    <TD>
                      <StatusBadge map={PAYMENT_STATUS} value={p.status} />
                    </TD>
                    <TD className="tabular text-right font-medium">{money(p.amountCents, p.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Checkout links</CardTitle>
            <CardDescription>Created by the Sales Agent (within your discount limits) or by you</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-2">
          {d.chks.length === 0 ? (
            <p className="px-3 text-sm text-muted-foreground">No checkout links in this period.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Created</TH>
                  <TH>Lead</TH>
                  <TH>Product</TH>
                  <TH>By</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {d.chks.map(({ c, lead, leadId, product }) => (
                  <TR key={c.id}>
                    <TD className="text-[12px] whitespace-nowrap text-muted-foreground">{dateTime(c.createdAt, ws.timezone)}</TD>
                    <TD>{leadId ? <Link href={`/w/${slug}/crm/${leadId}`} className="hover:underline">{lead || "Lead"}</Link> : "—"}</TD>
                    <TD>{product ?? "—"}</TD>
                    <TD className="text-[12px]">{c.createdBy === "AI" ? "Sales Agent" : "You"}{Number(c.discountPct) ? ` · ${Number(c.discountPct)}% off` : ""}</TD>
                    <TD>
                      <Badge tone={c.status === "PAID" ? "success" : c.status === "SENT" ? "info" : c.status === "EXPIRED" || c.status === "CANCELLED" ? "neutral" : "warning"}>{c.status.toLowerCase()}</Badge>
                      {c.url && (c.status === "CREATED" || c.status === "SENT") ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-[12px] text-primary hover:underline">
                          open link
                        </a>
                      ) : null}
                    </TD>
                    <TD className="tabular text-right">{money(c.amountCents, c.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
