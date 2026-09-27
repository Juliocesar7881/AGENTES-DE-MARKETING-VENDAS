"use client";
import { Ban, CircleDollarSign, Download, Link2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { LeadStage } from "@revenueos/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/server/action";
import { anonymizeLeadAction, doNotContactAction, manualSaleAction, moveLeadAction, sendCheckoutAction, updateNotesAction } from "@/server/actions/crm";

interface Product {
  id: string;
  name: string;
  priceCents: number;
}

export function LeadActions({ lead, products, workspaceId, currency, hasConversation }: { lead: { id: string; stage: string; doNotContact: boolean; notes: string; anonymized: boolean }; products: Product[]; workspaceId: string; currency: string; hasConversation: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<null | "sale" | "checkout" | "delete">(null);
  const [notes, setNotes] = useState(lead.notes);
  const [amount, setAmount] = useState("");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [discount, setDiscount] = useState("0");
  const [sendIt, setSendIt] = useState(hasConversation);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const fmt = (c: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(c / 100);

  const act = (fn: () => Promise<ActionResult<unknown>>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message ?? "Done");
        after?.();
      } else toast.error(r.error);
      router.refresh();
    });

  if (lead.anonymized) return <p className="text-sm text-muted-foreground">This lead was anonymized (LGPD). Only aggregated financial records remain.</p>;

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Field label="Stage">
          <Select value={lead.stage} disabled={pending || lead.stage === "WON"} onChange={(e) => act(() => moveLeadAction(lead.id, e.target.value as LeadStage))}>
            {["NEW", "CONTACTED", "ENGAGED", "QUALIFIED", "CHECKOUT", "LOST"].map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
            {lead.stage === "WON" ? <option value="WON">Won (payment confirmed)</option> : null}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button className="flex-1" size="md" onClick={() => setDialog("checkout")} disabled={!products.length || lead.doNotContact}>
            <Link2 /> Checkout link
          </Button>
          <Button className="flex-1" size="md" onClick={() => setDialog("sale")}>
            <CircleDollarSign /> Manual sale
          </Button>
        </div>
      </div>
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={5000} onBlur={() => notes !== lead.notes && act(() => updateNotesAction(lead.id, notes))} />
      </Field>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {!lead.doNotContact ? (
          <Button size="sm" variant="danger-outline" loading={pending} onClick={() => confirm("Mark as DO NOT CONTACT? The AI will never message this person again.") && act(() => doNotContactAction(lead.id, "Marked by user"))}>
            <Ban /> Do not contact
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" asChild>
          <a href={`/api/leads/${lead.id}/export`}>
            <Download /> Export data (LGPD)
          </a>
        </Button>
        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDialog("delete")}>
          <Trash2 /> Delete personal data
        </Button>
      </div>

      <Dialog open={dialog === "sale"} onOpenChange={(o) => setDialog(o ? "sale" : null)}>
        <DialogContent title="Record a manual sale" description="For payments received outside RevenueOS (cash, bank transfer, PIX to another account). Recorded with source MANUAL and your name in the audit log.">
          <div className="grid gap-3">
            <Field label="Product">
              <Select
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  const p = products.find((x) => x.id === e.target.value);
                  if (p) setAmount(String(p.priceCents / 100));
                }}
              >
                <option value="">No product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {fmt(p.priceCents)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Amount received (${currency})`}>
              <Input inputMode="decimal" value={amount} placeholder="99,00" onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => {
                const cents = Math.round(Number(amount.replace(/\./g, "").replace(",", ".")) * 100);
                if (!cents || cents < 1) return toast.error("Enter the amount received.");
                act(() => manualSaleAction(workspaceId, { amountCents: cents, productId: productId || null, leadId: lead.id }), () => setDialog(null));
              }}
            >
              Record sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "checkout"} onOpenChange={(o) => { setDialog(o ? "checkout" : null); if (!o) setCheckoutUrl(null); }}>
        <DialogContent title="Send a checkout link" description="Creates a payment link with Mercado Pago / Stripe (or the demo checkout). The sale counts only after the payment webhook confirms it.">
          {checkoutUrl ? (
            <div className="grid gap-2">
              <Field label="Checkout link">
                <Input readOnly value={checkoutUrl} onFocus={(e) => e.target.select()} />
              </Field>
              <Button onClick={() => void navigator.clipboard.writeText(checkoutUrl).then(() => toast.success("Copied"))}>Copy link</Button>
            </div>
          ) : (
            <div className="grid gap-3">
              <Field label="Product">
                <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {fmt(p.priceCents)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Discount %">
                <Input type="number" min={0} max={90} value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
              {hasConversation ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={sendIt} onChange={(e) => setSendIt(e.target.checked)} /> Send it in the conversation now
                </label>
              ) : null}
            </div>
          )}
          {!checkoutUrl ? (
            <DialogFooter>
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button
                variant="primary"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await sendCheckoutAction(lead.id, productId, Number(discount) || 0, sendIt);
                    if (r.ok) {
                      toast.success(r.message);
                      setCheckoutUrl(r.data.url);
                    } else toast.error(r.error);
                    router.refresh();
                  })
                }
              >
                Create link
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(o) => setDialog(o ? "delete" : null)}>
        <DialogContent title="Delete personal data (LGPD)" description="Name, phone, e-mail, notes and message texts are erased and the lead is marked do-not-contact. Payments stay (without personal data) for accounting. This cannot be undone.">
          <DialogFooter>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="danger" loading={pending} onClick={() => act(() => anonymizeLeadAction(lead.id, "Data subject request"), () => setDialog(null))}>
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
