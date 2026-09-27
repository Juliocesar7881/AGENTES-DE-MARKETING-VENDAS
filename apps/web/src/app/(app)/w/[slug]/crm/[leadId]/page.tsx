import { ArrowLeft, ArrowRight, Ban, MessageCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { activities, and, asc, attributionEvents, checkouts, contents, conversations, conversationSummaries, desc, eq, isUuid, leadScores, leads, messages, payments, products, socialPosts, withUser } from "@revenueos/database";
import { ActivityFeed } from "@/components/activity-feed";
import { LeadActions } from "@/components/crm/lead-actions";
import { PlatformIcon, platformLabel } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/misc";
import { LEAD_STAGE, PAYMENT_STATUS } from "@/lib/status";
import { ago, dateTime, money } from "@/lib/utils";
import { requireWorkspace } from "@/server/session";

const MODEL_LABEL: Record<string, string> = {
  TRACKED_LINK: "Tracked link click",
  REF_CODE: "Reference code in the first message",
  PLATFORM_REFERRAL: "Platform referral (ad/post click-to-message)",
  INFERRED_RECENT: "Inferred: most recent post (lower confidence)",
  MANUAL: "Added manually",
  NONE: "Unknown source",
};

export default async function LeadPage({ params }: { params: Promise<{ slug: string; leadId: string }> }) {
  const { slug, leadId } = await params;
  if (!isUuid(leadId)) notFound();
  const { user, ws } = await requireWorkspace(slug);
  const d = await withUser(user.id, async (tx) => {
    const [lead] = await tx.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.workspaceId, ws.id))).limit(1);
    if (!lead) return null;
    const [content] = lead.sourceContentId ? await tx.select({ id: contents.id, number: contents.number, hook: contents.hook, title: contents.title }).from(contents).where(eq(contents.id, lead.sourceContentId)).limit(1) : [];
    const [post] = lead.sourceSocialPostId ? await tx.select({ platform: socialPosts.platform, permalink: socialPosts.permalink, publishedAt: socialPosts.publishedAt }).from(socialPosts).where(eq(socialPosts.id, lead.sourceSocialPostId)).limit(1) : [];
    const [product] = lead.productId ? await tx.select({ name: products.name }).from(products).where(eq(products.id, lead.productId)).limit(1) : [];
    const convs = await tx.select().from(conversations).where(eq(conversations.leadId, leadId)).orderBy(desc(conversations.lastMessageAt));
    const lastMsgs = convs[0] ? await tx.select().from(messages).where(eq(messages.conversationId, convs[0].id)).orderBy(desc(messages.createdAt)).limit(6) : [];
    const [summary] = convs[0] ? await tx.select().from(conversationSummaries).where(eq(conversationSummaries.conversationId, convs[0].id)).limit(1) : [];
    const scores = await tx.select().from(leadScores).where(eq(leadScores.leadId, leadId)).orderBy(desc(leadScores.createdAt)).limit(8);
    const chks = await tx.select({ c: checkouts, product: products.name }).from(checkouts).leftJoin(products, eq(products.id, checkouts.productId)).where(eq(checkouts.leadId, leadId)).orderBy(desc(checkouts.createdAt));
    const pays = await tx.select().from(payments).where(eq(payments.leadId, leadId)).orderBy(desc(payments.createdAt));
    const events = await tx.select().from(attributionEvents).where(eq(attributionEvents.leadId, leadId)).orderBy(asc(attributionEvents.occurredAt));
    const history = await tx.select().from(activities).where(eq(activities.leadId, leadId)).orderBy(desc(activities.createdAt)).limit(40);
    const prods = await tx.select({ id: products.id, name: products.name, priceCents: products.priceCents }).from(products).where(and(eq(products.workspaceId, ws.id), eq(products.active, true)));
    return { lead, content, post, product, convs, lastMsgs, summary, scores, chks, pays, events, history, prods };
  });
  if (!d) notFound();
  const { lead } = d;
  const breakdown = d.scores[0]?.breakdown ?? [];

  return (
    <div>
      <Link href={`/w/${slug}/crm`} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> CRM
      </Link>
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold tracking-[-0.02em]">{lead.name || "Unnamed lead"}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusBadge map={LEAD_STAGE} value={lead.stage} />
                    {lead.doNotContact ? (
                      <Badge tone="danger">
                        <Ban /> Do not contact
                      </Badge>
                    ) : null}
                    {lead.aiPaused && !lead.doNotContact ? <Badge tone="warning">AI paused</Badge> : null}
                    {lead.isDemo ? <Badge tone="info">DEMO</Badge> : null}
                    <span>
                      {[lead.phone, lead.email, lead.username].filter(Boolean).join(" · ") || "no contact data"} · created {ago(lead.createdAt)}
                    </span>
                  </div>
                </div>
                <div className="w-44">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Lead score</span>
                    <span className="tabular text-2xl font-semibold">{lead.score}</span>
                  </div>
                  <Progress value={lead.score} tone={lead.score >= 70 ? "success" : lead.score >= 40 ? "warning" : "primary"} className="mt-1" />
                  <p className="mt-1 text-[10px] text-subtle">0–100 rule-based signal. Not a probability.</p>
                </div>
              </div>
              {lead.signals.length ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {lead.signals.map((s) => (
                    <Badge key={s} tone="primary">
                      {s.toLowerCase().replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Attribution path</CardTitle>
                <CardDescription>How this person found the business — {MODEL_LABEL[lead.attributionModel] ?? lead.attributionModel}</CardDescription>
              </div>
              {lead.attributionModel === "INFERRED_RECENT" ? <Badge tone="warning">inferred</Badge> : null}
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                {d.content ? (
                  <Link href={`/w/${slug}/content/${d.content.id}`} className="rounded-lg border border-border px-3 py-2 hover:bg-muted/60">
                    <div className="text-[11px] text-muted-foreground">Content #{d.content.number}</div>
                    <div className="max-w-[260px] truncate font-medium">{d.content.hook ?? d.content.title}</div>
                  </Link>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-3 py-2 text-muted-foreground">No content linked</div>
                )}
                <ArrowRight className="size-4 text-subtle" />
                <div className="rounded-lg border border-border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Post</div>
                  <div className="flex items-center gap-1.5 font-medium">
                    {d.post ? <PlatformIcon platform={d.post.platform} size={14} /> : null}
                    {d.post ? platformLabel(d.post.platform) : platformLabel(lead.sourcePlatform ?? lead.channel)}
                  </div>
                </div>
                <ArrowRight className="size-4 text-subtle" />
                <div className="rounded-lg border border-border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Ref code</div>
                  <div className="font-mono font-medium">{lead.refCode ?? "—"}</div>
                </div>
                <ArrowRight className="size-4 text-subtle" />
                <div className="rounded-lg border border-border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Channel</div>
                  <div className="font-medium">{platformLabel(lead.channel)}</div>
                </div>
                <ArrowRight className="size-4 text-subtle" />
                <div className="rounded-lg border border-border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Interest</div>
                  <div className="font-medium">{d.product?.name ?? "—"}</div>
                </div>
              </div>
              {d.events.length ? (
                <ol className="mt-4 space-y-1.5 border-l border-border pl-4">
                  {d.events.map((e) => (
                    <li key={e.id} className="relative text-[13px]">
                      <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-primary" />
                      <span className="font-medium">{e.eventType.toLowerCase().replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {e.model.toLowerCase().replace(/_/g, " ")} · {dateTime(e.occurredAt, ws.timezone)}
                        {e.amountCents ? ` · ${money(e.amountCents, e.currency ?? ws.currency)}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Conversation</CardTitle>
                <CardDescription>{d.summary?.summary || "Latest messages"}</CardDescription>
              </div>
              {d.convs[0] ? (
                <Link href={`/w/${slug}/inbox?c=${d.convs[0].id}`} className="inline-flex items-center gap-1.5 text-[13px] text-primary hover:underline">
                  <MessageCircle className="size-4" /> Open in Inbox
                </Link>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-2">
              {d.lastMsgs.length === 0 ? <p className="text-sm text-muted-foreground">No messages yet.</p> : null}
              {[...d.lastMsgs].reverse().map((m) => (
                <div key={m.id} className={m.direction === "INBOUND" ? "mr-12" : "ml-12"}>
                  <div className={`rounded-lg px-3 py-2 text-[13px] ${m.direction === "INBOUND" ? "bg-muted" : m.senderType === "AI" ? "bg-primary-soft" : "bg-info-soft"}`}>{m.body}</div>
                  <div className={`mt-0.5 text-[10px] text-subtle ${m.direction === "INBOUND" ? "" : "text-right"}`}>
                    {m.direction === "INBOUND" ? "lead" : m.senderType === "AI" ? "sales agent" : "you"} · {dateTime(m.createdAt, ws.timezone)}
                  </div>
                </div>
              ))}
              {d.summary && (d.summary.needs.length || d.summary.objections.length) ? (
                <div className="grid gap-2 border-t border-border pt-3 text-[12px] sm:grid-cols-2">
                  <div>
                    <div className="mb-1 font-medium text-muted-foreground">Needs</div>
                    <ul className="list-disc pl-4">{d.summary.needs.map((n) => <li key={n}>{n}</li>)}</ul>
                  </div>
                  <div>
                    <div className="mb-1 font-medium text-muted-foreground">Objections</div>
                    <ul className="list-disc pl-4">{d.summary.objections.map((n) => <li key={n}>{n}</li>)}</ul>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent className="px-3">
              <ActivityFeed items={d.history.map((a) => ({ a }))} workspace slugOf={slug} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <LeadActions lead={{ id: lead.id, stage: lead.stage, doNotContact: lead.doNotContact, notes: lead.notes, anonymized: Boolean(lead.anonymizedAt) }} products={d.prods} workspaceId={ws.id} currency={ws.currency} hasConversation={d.convs.length > 0} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Checkouts & payments</CardTitle>
                <CardDescription>Payments are confirmed only by provider webhook + official query</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {d.chks.length === 0 && d.pays.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
              {d.chks.map(({ c, product }) => (
                <div key={c.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[13px]">
                  <div>
                    <div className="font-medium">{product ?? "Checkout"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.provider.toLowerCase()} · {c.createdBy === "AI" ? "sent by AI" : "by you"} · {ago(c.createdAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tabular">{money(c.amountCents, c.currency)}</div>
                    <Badge tone={c.status === "PAID" ? "success" : c.status === "EXPIRED" ? "neutral" : "warning"}>{c.status.toLowerCase()}</Badge>
                  </div>
                </div>
              ))}
              {d.pays.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-md border border-success/30 bg-success-soft/40 px-3 py-2 text-[13px]">
                  <div>
                    <div className="font-medium">Payment · {p.source === "MANUAL" ? "manual" : p.provider.toLowerCase()}</div>
                    <div className="text-[11px] text-muted-foreground">{dateTime(p.approvedAt ?? p.createdAt, ws.timezone)}</div>
                  </div>
                  <div className="text-right">
                    <div className="tabular font-semibold">{money(p.amountCents, p.currency)}</div>
                    <StatusBadge map={PAYMENT_STATUS} value={p.status} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          {d.scores.length ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Score breakdown</CardTitle>
                  <CardDescription>{d.scores[0]?.reason}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-[12px]">
                {breakdown.map((b) => (
                  <div key={b.factor} className="flex justify-between">
                    <span className="text-muted-foreground">{b.factor.toLowerCase().replace(/_/g, " ")}</span>
                    <span className="tabular">{b.points > 0 ? `+${b.points}` : b.points}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
