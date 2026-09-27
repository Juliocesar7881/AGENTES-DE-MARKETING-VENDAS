import { and, contents, desc, eq, isNull, leads, opportunities, products, sql, withUser } from "@revenueos/database";
import { Kanban, type KanbanLead } from "@/components/crm/kanban";
import { requireWorkspace } from "@/server/session";

export default async function CrmPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, ws } = await requireWorkspace(slug);
  const rows = await withUser(user.id, (tx) =>
    tx
      .select({
        l: leads,
        product: products.name,
        hook: contents.hook,
        value: sql<number | null>`(SELECT max(o.value_cents) FROM ${opportunities} o WHERE o.lead_id = "leads"."id" AND o.stage IN ('OPEN','CHECKOUT','WON'))`,
      })
      .from(leads)
      .leftJoin(products, eq(products.id, leads.productId))
      .leftJoin(contents, eq(contents.id, leads.sourceContentId))
      .where(and(eq(leads.workspaceId, ws.id), isNull(leads.anonymizedAt)))
      .orderBy(desc(leads.score), desc(leads.updatedAt))
      .limit(500),
  );
  const data: KanbanLead[] = rows.map((r) => ({
    id: r.l.id,
    name: r.l.name,
    stage: r.l.stage,
    score: r.l.score,
    source: r.l.sourcePlatform ?? r.l.channel,
    product: r.product,
    lastContactAt: (r.l.lastContactAt ?? r.l.createdAt).toISOString(),
    doNotContact: r.l.doNotContact,
    aiPaused: r.l.aiPaused,
    valueCents: r.value,
    contentHook: r.hook,
    isDemo: r.l.isDemo,
  }));
  return <Kanban workspaceId={ws.id} slug={slug} currency={ws.currency} leads={data} />;
}
