import { NextResponse } from "next/server";
import { audit, exportLeadData } from "@revenueos/core";
import { eq, isUuid, leads, withUser } from "@revenueos/database";
import { getUser } from "@/server/session";

/** LGPD data export (JSON) for one lead. Authorization through RLS. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [lead] = await withUser(user.id, (tx) => tx.select({ id: leads.id, ws: leads.workspaceId }).from(leads).where(eq(leads.id, id)).limit(1));
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  const data = await exportLeadData(lead.ws, id);
  await audit({ workspaceId: lead.ws, actorType: "USER", actorId: user.id, action: "lead.export", entityType: "lead", entityId: id });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="lead-${id}.json"`, "cache-control": "no-store" },
  });
}
