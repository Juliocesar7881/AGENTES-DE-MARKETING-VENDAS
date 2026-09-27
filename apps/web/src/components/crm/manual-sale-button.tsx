"use client";
import { CircleDollarSign } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { manualSaleAction } from "@/server/actions/crm";

export function ManualSaleButton({ workspaceId, currency, products }: { workspaceId: string; currency: string; products: { id: string; name: string; priceCents: number }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const fmt = (c: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(c / 100);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <CircleDollarSign /> Record manual sale
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Record a manual sale" description="Only for money actually received outside RevenueOS. Stored with source MANUAL, your name and an audit entry — never mixed with confirmed webhook payments.">
          <div className="grid gap-3">
            <Field label="Product">
              <Select
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  const p = products.find((x) => x.id === e.target.value);
                  if (p) setAmount(String(p.priceCents / 100).replace(".", ","));
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
            <Field label={`Amount (${currency})`}>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="99,00" />
            </Field>
            <Field label="Note">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. paid in cash at the clinic" />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const cents = Math.round(Number(amount.replace(/\./g, "").replace(",", ".")) * 100);
                  if (!cents) return void toast.error("Enter the amount received.");
                  const r = await manualSaleAction(workspaceId, { amountCents: cents, productId: productId || null, note: note || null });
                  if (r.ok) {
                    toast.success(r.message);
                    setOpen(false);
                    router.refresh();
                  } else toast.error(r.error);
                })
              }
            >
              Record sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
