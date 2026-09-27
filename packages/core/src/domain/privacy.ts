import { and, attributionEvents, checkouts, conversations, eq, isNull, leadScores, leads, lt, messages, payments, sql, workspaces } from "@revenueos/database";
import { db, now } from "../deps";
import { audit } from "../records";

/**
 * LGPD tools: export a lead's data, delete it (anonymize — financial records
 * are kept for accounting but detached from personal data), and retention.
 */
export async function exportLeadData(workspaceId: string, leadId: string) {
  const [lead] = await db().select().from(leads).where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId))).limit(1);
  if (!lead) return null;
  const msgs = await db().select().from(messages).where(eq(messages.leadId, leadId));
  const pays = await db().select().from(payments).where(eq(payments.leadId, leadId));
  const chks = await db().select().from(checkouts).where(eq(checkouts.leadId, leadId));
  return {
    exportedAt: now().toISOString(),
    lead: { ...lead },
    messages: msgs.map((m) => ({ at: m.createdAt, direction: m.direction, sender: m.senderType, body: m.body })),
    checkouts: chks.map((c) => ({ id: c.id, amountCents: c.amountCents, status: c.status, createdAt: c.createdAt })),
    payments: pays.map((p) => ({ id: p.id, amountCents: p.amountCents, status: p.status, approvedAt: p.approvedAt })),
  };
}

export async function anonymizeLead(workspaceId: string, leadId: string, actor: { userId: string | null; reason: string }): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .update(leads)
      .set({ name: "Anonymized lead", username: null, phone: null, email: null, company: null, contactKey: null, notes: "", doNotContact: true, anonymizedAt: now(), signals: [] })
      .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)));
    await tx.update(messages).set({ body: "[deleted]", metadata: {} }).where(and(eq(messages.leadId, leadId), eq(messages.workspaceId, workspaceId)));
    await tx.update(conversations).set({ externalThreadId: null, aiMode: "PAUSED", status: "CLOSED" }).where(eq(conversations.leadId, leadId));
    await tx.delete(leadScores).where(eq(leadScores.leadId, leadId));
    await tx.update(attributionEvents).set({ visitorHash: null }).where(eq(attributionEvents.leadId, leadId));
  });
  await audit({ workspaceId, actorType: actor.userId ? "USER" : "SYSTEM", actorId: actor.userId, action: "lead.anonymize", entityType: "lead", entityId: leadId, details: { reason: actor.reason } });
}

/** Applies workspace retention settings (daily). */
export async function applyRetention(): Promise<{ anonymized: number; messagesDeleted: number }> {
  let anonymized = 0;
  let messagesDeleted = 0;
  const all = await db().select().from(workspaces);
  for (const ws of all) {
    if (ws.retention.leadRetentionDays > 0) {
      const cutoff = new Date(now().getTime() - ws.retention.leadRetentionDays * 24 * 3600 * 1000);
      const stale = await db()
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.workspaceId, ws.id), isNull(leads.anonymizedAt), lt(sql`coalesce(${leads.lastContactAt}, ${leads.createdAt})`, cutoff), sql`${leads.stage} <> 'WON'`))
        .limit(500);
      for (const l of stale) {
        await anonymizeLead(ws.id, l.id, { userId: null, reason: `retention ${ws.retention.leadRetentionDays}d` });
        anonymized++;
      }
    }
    if (ws.retention.messageRetentionDays > 0) {
      const cutoff = new Date(now().getTime() - ws.retention.messageRetentionDays * 24 * 3600 * 1000);
      const res = await db()
        .update(messages)
        .set({ body: "[expired]" })
        .where(and(eq(messages.workspaceId, ws.id), lt(messages.createdAt, cutoff), sql`${messages.body} <> '[expired]'`))
        .returning({ id: messages.id });
      messagesDeleted += res.length;
    }
  }
  return { anonymized, messagesDeleted };
}
