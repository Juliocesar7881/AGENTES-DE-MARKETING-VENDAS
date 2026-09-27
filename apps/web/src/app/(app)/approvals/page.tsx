import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { approvalRequests, desc, eq, ne, withUser, workspaces } from "@revenueos/database";
import { ApprovalButtons } from "@/components/approval-buttons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ago } from "@/lib/utils";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Approvals" };

const TYPE_LABEL: Record<string, string> = {
  PUBLISH_CONTENT: "Publish content",
  SEND_CHECKOUT: "Send checkout link",
  DISCOUNT: "Discount",
  CUSTOM_COMPOSITION: "New video composition",
  HIGH_VALUE_CHECKOUT: "High-value checkout",
};

function entityLink(slug: string, type: string | null, id: string | null) {
  if (!id) return null;
  if (type === "content") return `/w/${slug}/content/${id}`;
  if (type === "lead") return `/w/${slug}/crm/${id}`;
  if (type === "conversation") return `/w/${slug}/inbox?c=${id}`;
  return null;
}

export default async function ApprovalsPage() {
  const user = await requireUser();
  const { pending, recent } = await withUser(user.id, async (tx) => ({
    pending: await tx.select({ a: approvalRequests, ws: workspaces.name, slug: workspaces.slug, color: workspaces.color }).from(approvalRequests).innerJoin(workspaces, eq(workspaces.id, approvalRequests.workspaceId)).where(eq(approvalRequests.status, "PENDING")).orderBy(desc(approvalRequests.createdAt)).limit(100),
    recent: await tx.select({ a: approvalRequests, ws: workspaces.name }).from(approvalRequests).innerJoin(workspaces, eq(workspaces.id, approvalRequests.workspaceId)).where(ne(approvalRequests.status, "PENDING")).orderBy(desc(approvalRequests.decidedAt)).limit(20),
  }));
  return (
    <>
      <PageHeader title="Approvals" description="In Assisted mode (or above your limits) the agents prepare the action and wait for you." />
      {pending.length === 0 ? <EmptyState icon={CircleCheck} title="Nothing waiting for approval" description="Publishing and checkout links in Assisted businesses, high-value checkouts and new compositions appear here." /> : null}
      <div className="space-y-3">
        {pending.map(({ a, ws, slug, color }) => {
          const href = entityLink(slug, a.entityType, a.entityId);
          const payload = a.payload as Record<string, unknown>;
          return (
            <Card key={a.id}>
              <CardContent className="flex flex-col gap-3 pt-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="size-2 rounded-sm" style={{ background: color }} />
                    {ws}
                    <Badge tone="warning">{TYPE_LABEL[a.type] ?? a.type}</Badge>
                    <span>requested by {a.requestedBy.toLowerCase()} · {ago(a.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-sm font-medium">{href ? <Link href={href} className="hover:underline">{a.title}</Link> : a.title}</div>
                  {a.description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{a.description}</p> : null}
                  {typeof payload.amountCents === "number" ? <p className="mt-0.5 text-[12px]">Amount: {new Intl.NumberFormat("pt-BR", { style: "currency", currency: String(payload.currency ?? "BRL") }).format(payload.amountCents / 100)}</p> : null}
                </div>
                <ApprovalButtons id={a.id} />
              </CardContent>
            </Card>
          );
        })}
      </div>
      {recent.length ? (
        <>
          <h2 className="mt-8 mb-2 text-sm font-semibold">Recently decided</h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {recent.map(({ a, ws }) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                <span className="truncate">
                  {a.title} <span className="text-subtle">· {ws}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <Badge tone={a.status === "APPROVED" ? "success" : a.status === "REJECTED" ? "danger" : "neutral"}>{a.status.toLowerCase()}</Badge>
                  {ago(a.decidedAt)}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
