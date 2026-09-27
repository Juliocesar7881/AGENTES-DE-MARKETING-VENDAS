import { NextResponse } from "next/server";
import { asc, conversations, eq, isUuid, leads, messages, withUser } from "@revenueos/database";
import { getUser } from "@/server/session";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const data = await withUser(user.id, async (tx) => {
    const [conv] = await tx.select({ c: conversations, lead: { id: leads.id, name: leads.name, stage: leads.stage, score: leads.score, doNotContact: leads.doNotContact, aiPaused: leads.aiPaused } }).from(conversations).innerJoin(leads, eq(leads.id, conversations.leadId)).where(eq(conversations.id, id)).limit(1);
    if (!conv) return null;
    const msgs = await tx
      .select({ id: messages.id, direction: messages.direction, senderType: messages.senderType, body: messages.body, deliveryStatus: messages.deliveryStatus, error: messages.error, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt))
      .limit(300);
    return { conversation: { id: conv.c.id, aiMode: conv.c.aiMode, channel: conv.c.channel, lastInboundAt: conv.c.lastInboundAt }, lead: conv.lead, messages: msgs };
  });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
