"use client";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Ban, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { LeadStage } from "@revenueos/shared";
import { PlatformIcon } from "@/components/platform-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ago, cn, money } from "@/lib/utils";
import { createLeadAction, moveLeadAction } from "@/server/actions/crm";

export interface KanbanLead {
  id: string;
  name: string;
  stage: string;
  score: number;
  source: string | null;
  product: string | null;
  lastContactAt: string | null;
  doNotContact: boolean;
  aiPaused: boolean;
  valueCents: number | null;
  contentHook: string | null;
  isDemo: boolean;
}

const STAGES: { id: LeadStage; label: string; dot: string }[] = [
  { id: "NEW", label: "New", dot: "bg-subtle" },
  { id: "CONTACTED", label: "Contacted", dot: "bg-info" },
  { id: "ENGAGED", label: "Engaged", dot: "bg-primary" },
  { id: "QUALIFIED", label: "Qualified", dot: "bg-warning" },
  { id: "CHECKOUT", label: "Checkout", dot: "bg-warning" },
  { id: "WON", label: "Won", dot: "bg-success" },
  { id: "LOST", label: "Lost", dot: "bg-danger" },
];

function scoreTone(s: number) {
  return s >= 70 ? "success" : s >= 40 ? "warning" : "neutral";
}

function LeadCard({ lead, slug, currency }: { lead: KanbanLead; slug: string; currency: string }) {
  // WON only comes from a confirmed payment. A locked card is not a drag handle, so it gets no
  // role/aria-disabled (which would also mark its link as disabled for assistive tech).
  const locked = lead.stage === "WON";
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id, disabled: locked });
  return (
    <div
      ref={setNodeRef}
      {...(locked ? {} : listeners)}
      {...(locked ? {} : attributes)}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn("rounded-lg border border-border bg-card p-2.5 shadow-card", !locked && "cursor-grab active:cursor-grabbing", isDragging && "z-50 shadow-pop ring-2 ring-primary")}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/w/${slug}/crm/${lead.id}`} onPointerDown={(e) => e.stopPropagation()} className="min-w-0 truncate text-[13px] font-medium hover:underline">
          {lead.name || "Unnamed lead"}
        </Link>
        <Badge tone={scoreTone(lead.score)} title="Lead score (0–100): rule-based signal, not a probability">
          {lead.score}
        </Badge>
      </div>
      {lead.contentHook ? <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">from “{lead.contentHook}”</div> : null}
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-subtle">
        {lead.source ? <PlatformIcon platform={lead.source} size={14} /> : null}
        <span className="truncate">{lead.product ?? "no product yet"}</span>
        <span className="ml-auto shrink-0">{ago(lead.lastContactAt)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {lead.valueCents ? <Badge tone="success">{money(lead.valueCents, currency)}</Badge> : null}
        {lead.doNotContact ? (
          <Badge tone="danger">
            <Ban /> DNC
          </Badge>
        ) : null}
        {lead.aiPaused && !lead.doNotContact ? <Badge tone="warning">AI paused</Badge> : null}
        {lead.isDemo ? <Badge tone="info">demo</Badge> : null}
      </div>
    </div>
  );
}

function Column({ stage, children, count, total, currency }: { stage: (typeof STAGES)[number]; children: React.ReactNode; count: number; total: number; currency: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled: stage.id === "WON" });
  return (
    <div ref={setNodeRef} className={cn("flex w-64 shrink-0 flex-col rounded-xl border border-border bg-muted/30 transition-colors", isOver && "border-primary bg-primary-soft/40")}>
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className={cn("size-2 rounded-full", stage.dot)} />
        <span className="text-[13px] font-semibold">{stage.label}</span>
        <span className="tabular text-xs text-subtle">{count}</span>
        {total ? <span className="tabular ml-auto text-[11px] text-muted-foreground">{money(total, currency)}</span> : null}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2" style={{ maxHeight: "calc(100vh - 300px)" }}>
        {children}
      </div>
    </div>
  );
}

export function Kanban({ workspaceId, slug, currency, leads }: { workspaceId: string; slug: string; currency: string; leads: KanbanLead[] }) {
  const router = useRouter();
  const [items, setItems] = useState(leads);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  // Reset local (optimistic) state when the server sends fresh data (React's "adjust state on prop change" pattern).
  const [prevLeads, setPrevLeads] = useState(leads);
  if (leads !== prevLeads) {
    setPrevLeads(leads);
    setItems(leads);
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const stage = e.over.id as LeadStage;
    const id = String(e.active.id);
    const lead = items.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    if (stage === "WON") {
      toast.error("Leads become Won only when a payment is confirmed. Use “Record manual sale” for offline payments.");
      return;
    }
    let reason: string | undefined;
    if (stage === "LOST") {
      reason = prompt("Why was this lead lost? (optional)") ?? undefined;
    }
    const before = items;
    setItems((xs) => xs.map((l) => (l.id === id ? { ...l, stage } : l)));
    start(async () => {
      const r = await moveLeadAction(id, stage, reason);
      if (!r.ok) {
        toast.error(r.error);
        setItems(before);
      }
      router.refresh();
    });
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Drag cards between stages. The Sales Agent also moves leads automatically as conversations progress.</p>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus /> Add lead
        </Button>
      </div>
      <DndContext id="crm-dnd" sensors={sensors} onDragEnd={onDragEnd}>
        <div className={cn("-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8", pending && "cursor-progress")}>
          {STAGES.map((s) => {
            const col = items.filter((l) => l.stage === s.id);
            return (
              <Column key={s.id} stage={s} count={col.length} total={col.reduce((sum, l) => sum + (l.valueCents ?? 0), 0)} currency={currency}>
                {col.map((l) => (
                  <LeadCard key={l.id} lead={l} slug={slug} currency={currency} />
                ))}
                {col.length === 0 ? <div className="rounded-md border border-dashed border-border py-6 text-center text-[11px] text-subtle">{s.id === "WON" ? "Confirmed payments land here" : "Drop leads here"}</div> : null}
              </Column>
            );
          })}
        </div>
      </DndContext>
      <AddLeadDialog open={open} onOpenChange={setOpen} workspaceId={workspaceId} />
    </>
  );
}

function AddLeadDialog({ open, onOpenChange, workspaceId }: { open: boolean; onOpenChange: (o: boolean) => void; workspaceId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add lead manually" description="For contacts that reached you outside the tracked channels (phone call, walk-in, referral).">
        <form
          className="grid gap-3"
          action={(fd) =>
            start(async () => {
              setError(null);
              const r = await createLeadAction(workspaceId, { name: fd.get("name"), phone: fd.get("phone") || null, email: fd.get("email") || "", notes: fd.get("notes") || "" });
              if (r.ok) {
                toast.success(r.message);
                onOpenChange(false);
                router.refresh();
              } else setError(r.error);
            })
          }
        >
          <Field label="Name">
            <Input name="name" required maxLength={120} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="WhatsApp / phone" hint="With country code, e.g. 5511999999999">
              <Input name="phone" inputMode="tel" />
            </Field>
            <Field label="E-mail">
              <Input name="email" type="email" />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea name="notes" rows={3} maxLength={2000} />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Add lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
