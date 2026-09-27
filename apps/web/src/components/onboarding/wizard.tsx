"use client";
import { ArrowLeft, ArrowRight, Check, Globe, Plus, Rocket, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AVAILABLE_FONTS } from "@revenueos/shared/video-spec";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { analyzeWebsiteAction, createBusinessAction } from "@/server/actions/workspace";

interface ProductDraft {
  name: string;
  price: string;
  type: string;
  description: string;
  benefits: string;
  offer: string;
}

const STEPS = ["Business", "Website", "Audience", "Offer", "Products", "Brand", "Channels", "Sales & mode", "Review", "Launch"];
const lines = (s: string) =>
  s
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

export function OnboardingWizard({ isDemoUser }: { isDemoUser: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [d, setD] = useState({
    name: "",
    industry: "",
    website: "",
    description: "",
    targetAudience: "",
    problems: "",
    goals: "",
    valueProposition: "",
    differentiators: "",
    products: [{ name: "", price: "", type: "SERVICE", description: "", benefits: "", offer: "" }] as ProductDraft[],
    primaryColor: "#6D5BFF",
    secondaryColor: "#22D3EE",
    accentColor: "#FFB547",
    backgroundColor: "#0B0F14",
    textColor: "#F5F7FA",
    fontHeading: "Montserrat",
    fontBody: "Inter",
    tone: "próximo, confiante e claro",
    handle: "",
    keywords: "",
    forbiddenWords: "",
    targetPlatforms: ["INSTAGRAM", "TIKTOK", "YOUTUBE"] as string[],
    postsPerDay: 2,
    postingSchedule: ["09:00", "18:00"],
    timezone: "America/Sao_Paulo",
    whatsappNumber: "",
    operatingMode: "ASSISTED" as "MANUAL" | "ASSISTED" | "AUTOPILOT",
  });
  const [analysis, setAnalysis] = useState<{ colors: string[]; name: string | null; description: string | null } | null>(null);
  const [newTime, setNewTime] = useState("12:00");
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }));
  const setProduct = (i: number, patch: Partial<ProductDraft>) => set("products", d.products.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const validProducts = d.products.filter((p) => p.name.trim().length >= 2);
  const canNext = [d.name.trim().length >= 2, true, d.targetAudience.trim().length > 0, true, validProducts.length > 0 && validProducts.every((p) => Number(p.price.replace(",", ".")) >= 0 && p.price !== ""), true, d.targetPlatforms.length > 0 && d.postingSchedule.length >= 1, true, true, true][step];

  const submit = () =>
    start(async () => {
      const r = await createBusinessAction({
        name: d.name,
        industry: d.industry,
        website: d.website || null,
        description: d.description,
        environment: "LIVE",
        timezone: d.timezone,
        postsPerDay: d.postsPerDay,
        postingSchedule: d.postingSchedule,
        targetPlatforms: d.targetPlatforms,
        operatingMode: d.operatingMode,
        whatsappNumber: d.whatsappNumber || null,
        color: d.primaryColor,
        audience: { targetAudience: d.targetAudience, problems: lines(d.problems), goals: lines(d.goals), valueProposition: d.valueProposition, differentiators: lines(d.differentiators) },
        brand: { primaryColor: d.primaryColor, secondaryColor: d.secondaryColor, accentColor: d.accentColor, backgroundColor: d.backgroundColor, textColor: d.textColor, fontHeading: d.fontHeading, fontBody: d.fontBody, tone: d.tone, handle: d.handle || undefined, keywords: lines(d.keywords), forbiddenWords: lines(d.forbiddenWords) },
        products: validProducts.map((p) => ({ name: p.name.trim(), description: p.description, priceCents: Math.round(Number(p.price.replace(/\./g, "").replace(",", ".")) * 100), type: p.type, benefits: lines(p.benefits), offer: p.offer })),
      });
      if (r.ok) {
        toast.success("Business created — connect its accounts next");
        router.push(`/w/${r.data.slug}/connections`);
      } else toast.error(r.error);
    });

  if (isDemoUser) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm">
          You are exploring the demo account. <strong>Create your own account</strong> (sign out → Create account) to add real businesses — the demo businesses stay separate and clearly labeled.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <ol className="space-y-1">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button disabled={i > step} onClick={() => setStep(i)} className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px]", i === step ? "bg-muted font-medium" : "text-muted-foreground disabled:opacity-50")}>
              <span className={cn("grid size-5 place-items-center rounded-full border text-[10px]", i < step ? "border-success bg-success text-white" : i === step ? "border-primary text-primary" : "border-border")}>{i < step ? <Check className="size-3" /> : i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="text-xs text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </div>
          {step === 0 ? (
            <>
              <h2 className="text-lg font-semibold">Tell us about the business</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Business name">
                  <Input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Clínica Sorriso" autoFocus />
                </Field>
                <Field label="Industry">
                  <Input value={d.industry} onChange={(e) => set("industry", e.target.value)} placeholder="e.g. odontologia" />
                </Field>
              </div>
              <Field label="What do you sell, to whom?">
                <Textarea value={d.description} onChange={(e) => set("description", e.target.value)} rows={3} />
              </Field>
            </>
          ) : null}
          {step === 1 ? (
            <>
              <h2 className="text-lg font-semibold">Website (optional)</h2>
              <p className="text-sm text-muted-foreground">We read the public page to suggest colors, description and prices. Private or local addresses are blocked.</p>
              <div className="flex gap-2">
                <Input value={d.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" />
                <Button
                  loading={pending}
                  disabled={!d.website}
                  onClick={() =>
                    start(async () => {
                      const r = await analyzeWebsiteAction(d.website);
                      if (!r.ok) return void toast.error(r.error);
                      setAnalysis({ colors: r.data.colors, name: r.data.name, description: r.data.description });
                      setD((x) => ({
                        ...x,
                        description: x.description || r.data.ai?.description || r.data.description || "",
                        targetAudience: x.targetAudience || r.data.ai?.targetAudience || "",
                        industry: x.industry || r.data.ai?.industry || "",
                        primaryColor: r.data.colors[0] ?? x.primaryColor,
                        secondaryColor: r.data.colors[1] ?? x.secondaryColor,
                        accentColor: r.data.colors[2] ?? x.accentColor,
                      }));
                      toast.success("Suggestions applied — review them in the next steps");
                    })
                  }
                >
                  <Globe /> Analyze
                </Button>
              </div>
              {analysis ? (
                <div className="rounded-lg border border-border p-3 text-[13px]">
                  <div className="font-medium">{analysis.name}</div>
                  <div className="text-muted-foreground">{analysis.description}</div>
                  <div className="mt-2 flex gap-1.5">
                    {analysis.colors.slice(0, 6).map((c) => (
                      <span key={c} className="size-5 rounded" style={{ background: c }} title={c} />
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          {step === 2 ? (
            <>
              <h2 className="text-lg font-semibold">Audience</h2>
              <Field label="Who is the ideal customer?">
                <Textarea value={d.targetAudience} onChange={(e) => set("targetAudience", e.target.value)} rows={2} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Their problems / pains" hint="one per line">
                  <Textarea value={d.problems} onChange={(e) => set("problems", e.target.value)} rows={4} />
                </Field>
                <Field label="What they want" hint="one per line">
                  <Textarea value={d.goals} onChange={(e) => set("goals", e.target.value)} rows={4} />
                </Field>
              </div>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <h2 className="text-lg font-semibold">Offer</h2>
              <Field label="Value proposition" hint="Why buy from you, in one sentence">
                <Textarea value={d.valueProposition} onChange={(e) => set("valueProposition", e.target.value)} rows={2} />
              </Field>
              <Field label="Differentiators" hint="one per line">
                <Textarea value={d.differentiators} onChange={(e) => set("differentiators", e.target.value)} rows={4} />
              </Field>
            </>
          ) : null}
          {step === 4 ? (
            <>
              <h2 className="text-lg font-semibold">Products</h2>
              <p className="text-sm text-muted-foreground">The Sales Agent only quotes these prices. You can add details (FAQ, terms) later in Products.</p>
              {d.products.map((p, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-border p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_130px_150px_auto]">
                    <Input value={p.name} onChange={(e) => setProduct(i, { name: e.target.value })} placeholder="Product or service" />
                    <Input value={p.price} onChange={(e) => setProduct(i, { price: e.target.value })} placeholder="Price (R$)" inputMode="decimal" />
                    <Select value={p.type} onChange={(e) => setProduct(i, { type: e.target.value })}>
                      {["SERVICE", "APPOINTMENT", "DIGITAL", "COURSE", "SUBSCRIPTION", "PHYSICAL"].map((t) => (
                        <option key={t} value={t}>
                          {t.toLowerCase()}
                        </option>
                      ))}
                    </Select>
                    <Button variant="ghost" size="icon" aria-label="Remove product" disabled={d.products.length === 1} onClick={() => set("products", d.products.filter((_, j) => j !== i))}>
                      <Trash2 />
                    </Button>
                  </div>
                  <Textarea value={p.description} onChange={(e) => setProduct(i, { description: e.target.value })} rows={2} placeholder="Description" />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Textarea value={p.benefits} onChange={(e) => setProduct(i, { benefits: e.target.value })} rows={2} placeholder="Benefits (one per line)" />
                    <Input value={p.offer} onChange={(e) => setProduct(i, { offer: e.target.value })} placeholder="Current offer (optional)" />
                  </div>
                </div>
              ))}
              <Button size="sm" onClick={() => set("products", [...d.products, { name: "", price: "", type: "SERVICE", description: "", benefits: "", offer: "" }])}>
                <Plus /> Add product
              </Button>
            </>
          ) : null}
          {step === 5 ? (
            <>
              <h2 className="text-lg font-semibold">Brand</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(["primaryColor", "secondaryColor", "accentColor", "backgroundColor", "textColor"] as const).map((k) => (
                  <Field key={k} label={k.replace("Color", "")}>
                    <input type="color" value={d[k]} onChange={(e) => set(k, e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-card" />
                  </Field>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Heading font">
                  <Select value={d.fontHeading} onChange={(e) => set("fontHeading", e.target.value)}>
                    {AVAILABLE_FONTS.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Body font">
                  <Select value={d.fontBody} onChange={(e) => set("fontBody", e.target.value)}>
                    {AVAILABLE_FONTS.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Handle">
                  <Input value={d.handle} onChange={(e) => set("handle", e.target.value)} placeholder="@yourbrand" />
                </Field>
              </div>
              <Field label="Tone of voice">
                <Input value={d.tone} onChange={(e) => set("tone", e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Keywords">
                  <Textarea value={d.keywords} onChange={(e) => set("keywords", e.target.value)} rows={2} />
                </Field>
                <Field label="Forbidden words">
                  <Textarea value={d.forbiddenWords} onChange={(e) => set("forbiddenWords", e.target.value)} rows={2} placeholder="e.g. garantido, cura, milagre" />
                </Field>
              </div>
            </>
          ) : null}
          {step === 6 ? (
            <>
              <h2 className="text-lg font-semibold">Channels & schedule</h2>
              <Field label="Publish to">
                <div className="flex flex-wrap gap-4">
                  {["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK"].map((p) => (
                    <label key={p} className="flex items-center gap-1.5 text-sm">
                      <Checkbox checked={d.targetPlatforms.includes(p)} onChange={(e) => set("targetPlatforms", e.target.checked ? [...d.targetPlatforms, p] : d.targetPlatforms.filter((x) => x !== p))} />
                      {p.charAt(0) + p.slice(1).toLowerCase()}
                    </label>
                  ))}
                </div>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Videos per day">
                  <Select value={d.postsPerDay} onChange={(e) => set("postsPerDay", Number(e.target.value))}>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Time zone">
                  <Select value={d.timezone} onChange={(e) => set("timezone", e.target.value)}>
                    {["America/Sao_Paulo", "America/Manaus", "America/Recife", "America/Fortaleza", "America/Cuiaba", "America/New_York", "Europe/Lisbon", "UTC"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Posting times">
                <div className="flex flex-wrap items-center gap-2">
                  {d.postingSchedule.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">
                      {t}
                      <button onClick={() => set("postingSchedule", d.postingSchedule.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="h-8 w-28" />
                  <Button size="xs" onClick={() => !d.postingSchedule.includes(newTime) && set("postingSchedule", [...d.postingSchedule, newTime].sort())}>
                    <Plus /> Add
                  </Button>
                </div>
              </Field>
              <p className="text-xs text-muted-foreground">RevenueOS keeps 4 videos ready ahead of time and never generates more than 4 per day (editable later).</p>
            </>
          ) : null}
          {step === 7 ? (
            <>
              <h2 className="text-lg font-semibold">Sales & autonomy</h2>
              <Field label="WhatsApp number for leads (with country code)" hint="Tracked links in your videos open a chat with this number. Connect the WhatsApp Cloud API later so the Sales Agent can reply.">
                <Input value={d.whatsappNumber} onChange={(e) => set("whatsappNumber", e.target.value)} placeholder="5511999999999" inputMode="tel" />
              </Field>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    ["MANUAL", "Manual", "You click every action."],
                    ["ASSISTED", "Assisted (recommended)", "AI creates and replies; you approve posts and checkout links."],
                    ["AUTOPILOT", "Autopilot", "AI acts alone within limits you set."],
                  ] as const
                ).map(([m, label, desc]) => (
                  <button key={m} onClick={() => set("operatingMode", m)} className={cn("rounded-lg border p-3 text-left", d.operatingMode === m ? "border-primary bg-primary-soft" : "border-border hover:border-border-strong")}>
                    <div className="text-sm font-semibold">{label}</div>
                    <div className="mt-1 text-[12px] text-muted-foreground">{desc}</div>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {step === 8 ? (
            <>
              <h2 className="text-lg font-semibold">Review</h2>
              <dl className="grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-[160px_1fr]">
                <dt className="text-muted-foreground">Business</dt>
                <dd>
                  {d.name} · {d.industry}
                </dd>
                <dt className="text-muted-foreground">Audience</dt>
                <dd>{d.targetAudience}</dd>
                <dt className="text-muted-foreground">Products</dt>
                <dd>{validProducts.map((p) => `${p.name} (R$ ${p.price})`).join(", ")}</dd>
                <dt className="text-muted-foreground">Brand</dt>
                <dd className="flex items-center gap-1.5">
                  {[d.primaryColor, d.secondaryColor, d.accentColor, d.backgroundColor].map((c) => (
                    <span key={c} className="size-4 rounded" style={{ background: c }} />
                  ))}
                  {d.fontHeading} / {d.fontBody}
                </dd>
                <dt className="text-muted-foreground">Publishing</dt>
                <dd>
                  {d.postsPerDay}/day at {d.postingSchedule.join(", ")} on {d.targetPlatforms.join(", ").toLowerCase()}
                </dd>
                <dt className="text-muted-foreground">Mode</dt>
                <dd>
                  <Badge tone="primary">{d.operatingMode}</Badge>
                </dd>
              </dl>
            </>
          ) : null}
          {step === 9 ? (
            <div className="py-6 text-center">
              <Rocket className="mx-auto mb-3 size-8 text-primary" />
              <h2 className="text-lg font-semibold">Ready to launch {d.name}</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">We will create the business with its five agents. Next you connect its social accounts, payments and WhatsApp — nothing is published until they are connected.</p>
              <Button variant="primary" size="lg" className="mt-5" loading={pending} onClick={submit}>
                <Rocket /> Create business
              </Button>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-border pt-4">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
              <ArrowLeft /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
                {step === 1 && !d.website ? "Skip" : "Continue"} <ArrowRight />
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
