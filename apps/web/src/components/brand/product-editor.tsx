"use client";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PRODUCT_TYPES } from "@revenueos/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { saveProductAction } from "@/server/actions/workspace";

export interface ProductData {
  id?: string;
  name: string;
  description: string;
  type: string;
  priceCents: number;
  currency: string;
  benefits: string[];
  features: string[];
  faq: { q: string; a: string }[];
  limitations: string[];
  offer: string;
  checkoutUrl: string | null;
  support: string;
  terms: string;
  active: boolean;
}

const EMPTY: ProductData = { name: "", description: "", type: "SERVICE", priceCents: 0, currency: "BRL", benefits: [], features: [], faq: [], limitations: [], offer: "", checkoutUrl: null, support: "", terms: "", active: true };
const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export function ProductsManager({ workspaceId, products, currency }: { workspaceId: string; products: ProductData[]; currency: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ProductData | null>(null);
  const [price, setPrice] = useState("");
  const [pending, start] = useTransition();
  const fmt = (c: number, cur: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(c / 100);
  const open = (p: ProductData | null) => {
    const v = p ?? { ...EMPTY, currency };
    setEditing(v);
    setPrice(v.priceCents ? (v.priceCents / 100).toFixed(2).replace(".", ",") : "");
  };
  const set = <K extends keyof ProductData>(k: K, v: ProductData[K]) => setEditing((e) => (e ? { ...e, [k]: v } : e));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="max-w-2xl text-xs text-muted-foreground">The Sales Agent only quotes prices, benefits and terms written here — an answer with an unknown price is blocked before it is sent.</p>
        <Button size="sm" variant="primary" onClick={() => open(null)}>
          <Plus /> Add product
        </Button>
      </div>
      {products.length === 0 ? <EmptyState title="No products yet" description="Add what you sell so content can promote it and the Sales Agent can answer and send checkout links." /> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => (
          <Card key={p.id} className={p.active ? "" : "opacity-60"}>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Badge>{p.type.toLowerCase()}</Badge>
                    {!p.active ? <Badge tone="warning">inactive</Badge> : null}
                  </div>
                </div>
                <div className="tabular text-lg font-semibold">{fmt(p.priceCents, p.currency)}</div>
              </div>
              <p className="mt-2 line-clamp-3 text-[13px] text-muted-foreground">{p.description}</p>
              {p.offer ? <p className="mt-2 text-[12px] text-success">Offer: {p.offer}</p> : null}
              <div className="mt-3 flex items-center justify-between text-[11px] text-subtle">
                <span>
                  {p.benefits.length} benefits · {p.faq.length} FAQ
                </span>
                <Button size="xs" onClick={() => open(p)}>
                  <Pencil /> Edit
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? (
          <DialogContent wide title={editing.id ? `Edit ${editing.name}` : "New product"} description="Product Knowledge used by the Strategist, Creative and Sales agents.">
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_160px_140px]">
                <Field label="Name">
                  <Input value={editing.name} onChange={(e) => set("name", e.target.value)} maxLength={120} />
                </Field>
                <Field label="Type">
                  <Select value={editing.type} onChange={(e) => set("type", e.target.value)}>
                    {PRODUCT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.toLowerCase()}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={`Price (${editing.currency})`}>
                  <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="99,00" />
                </Field>
              </div>
              <Field label="Description">
                <Textarea value={editing.description} onChange={(e) => set("description", e.target.value)} rows={3} maxLength={3000} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Benefits" hint="one per line">
                  <Textarea value={editing.benefits.join("\n")} onChange={(e) => set("benefits", lines(e.target.value))} rows={4} />
                </Field>
                <Field label="Features / what's included" hint="one per line">
                  <Textarea value={editing.features.join("\n")} onChange={(e) => set("features", lines(e.target.value))} rows={4} />
                </Field>
              </div>
              <Field label="FAQ" hint="One per line: question | answer">
                <Textarea
                  value={editing.faq.map((f) => `${f.q} | ${f.a}`).join("\n")}
                  onChange={(e) =>
                    set(
                      "faq",
                      lines(e.target.value)
                        .map((l) => l.split("|"))
                        .filter((p) => p.length >= 2)
                        .map(([q, ...a]) => ({ q: q!.trim(), a: a.join("|").trim() })),
                    )
                  }
                  rows={4}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Limitations / what it is NOT" hint="one per line — the agent will not promise these">
                  <Textarea value={editing.limitations.join("\n")} onChange={(e) => set("limitations", lines(e.target.value))} rows={3} />
                </Field>
                <div className="grid gap-3">
                  <Field label="Current offer">
                    <Input value={editing.offer} onChange={(e) => set("offer", e.target.value)} maxLength={500} />
                  </Field>
                  <Field label="Support">
                    <Input value={editing.support} onChange={(e) => set("support", e.target.value)} maxLength={500} />
                  </Field>
                </div>
              </div>
              <Field label="Terms / policies">
                <Textarea value={editing.terms} onChange={(e) => set("terms", e.target.value)} rows={2} maxLength={2000} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={editing.active} onChange={(e) => set("active", e.target.checked)} /> Active (can be promoted and sold)
              </label>
            </div>
            <DialogFooter>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                variant="primary"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const cents = Math.round(Number(price.replace(/\./g, "").replace(",", ".")) * 100);
                    if (!Number.isFinite(cents) || cents < 0) return void toast.error("Enter a valid price.");
                    const { id, ...rest } = editing;
                    const r = await saveProductAction(workspaceId, { ...rest, priceCents: cents, checkoutUrl: rest.checkoutUrl || "" }, id ?? null);
                    if (r.ok) {
                      toast.success(r.message);
                      setEditing(null);
                      router.refresh();
                    } else toast.error(r.error);
                  })
                }
              >
                Save product
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

