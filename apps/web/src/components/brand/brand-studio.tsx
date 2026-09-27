"use client";
import { Camera, Globe, ImageUp, Save, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AVAILABLE_FONTS } from "@revenueos/shared/video-spec";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { analyzeWebsiteAction, deleteAssetAction, screenshotAction, updateWorkspaceSection } from "@/server/actions/workspace";
import { cn } from "@/lib/utils";

export interface BrandKitData {
  businessName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontHeading: string;
  fontBody: string;
  tone: string;
  style: string;
  voice: string;
  handle: string | null;
  website: string | null;
  description: string;
  targetAudience: string;
  keywords: string[];
  forbiddenWords: string[];
  ctaPreferences: string[];
  logoAssetId: string | null;
}

export interface AssetItem {
  id: string;
  kind: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  thumb: string | null;
  url: string | null;
}

const COLORS: [keyof BrandKitData, string][] = [
  ["primaryColor", "Primary"],
  ["secondaryColor", "Secondary"],
  ["accentColor", "Accent"],
  ["backgroundColor", "Background"],
  ["textColor", "Text"],
];

const list = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function BrandStudio({ workspaceId, kit, assets, website }: { workspaceId: string; kit: BrandKitData; assets: AssetItem[]; website: string | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState(kit);
  const [pending, start] = useTransition();
  const [url, setUrl] = useState(website ?? kit.website ?? "");
  const [analysis, setAnalysis] = useState<null | { name: string | null; description: string | null; colors: string[]; headings: string[]; prices: string[]; aiSummary: string | null; aiError: string | null }>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof BrandKitData>(k: K, v: BrandKitData[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () =>
    start(async () => {
      const r = await updateWorkspaceSection(workspaceId, "brand", { ...draft, handle: draft.handle || null, website: draft.website || null });
      if (r.ok) toast.success("Brand Kit saved — new videos use it");
      else toast.error(r.error);
      router.refresh();
    });

  const upload = async (files: FileList | File[]) => {
    setUploading(true);
    let ok = 0;
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.set("workspaceId", workspaceId);
      fd.set("file", f);
      const r = await fetch("/api/uploads", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (r.ok) ok++;
      else toast.error(`${f.name}: ${j.error ?? "upload failed"}`);
    }
    setUploading(false);
    if (ok) toast.success(`${ok} file${ok > 1 ? "s" : ""} uploaded`);
    router.refresh();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Brand Kit</CardTitle>
              <CardDescription>Every video, caption and sales message follows this identity.</CardDescription>
            </div>
            <Button variant="primary" size="sm" loading={pending} onClick={save} disabled={JSON.stringify(draft) === JSON.stringify(kit)}>
              <Save /> Save
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Business name">
                <Input value={draft.businessName} onChange={(e) => set("businessName", e.target.value)} maxLength={80} />
              </Field>
              <Field label="Social handle">
                <Input value={draft.handle ?? ""} placeholder="@yourbrand" onChange={(e) => set("handle", e.target.value)} maxLength={60} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {COLORS.map(([k, label]) => (
                <Field key={k} label={label}>
                  <div className="flex items-center gap-2 rounded-md border border-input bg-card px-2 py-1.5">
                    <input type="color" value={String(draft[k])} onChange={(e) => set(k, e.target.value as never)} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={`${label} color`} />
                    <input value={String(draft[k])} onChange={(e) => set(k, e.target.value as never)} className="w-full bg-transparent font-mono text-xs outline-none" maxLength={7} />
                  </div>
                </Field>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Heading font">
                <Select value={draft.fontHeading} onChange={(e) => set("fontHeading", e.target.value)}>
                  {AVAILABLE_FONTS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Body font">
                <Select value={draft.fontBody} onChange={(e) => set("fontBody", e.target.value)}>
                  {AVAILABLE_FONTS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tone of voice" hint="e.g. acolhedor, direto e confiável">
                <Input value={draft.tone} onChange={(e) => set("tone", e.target.value)} maxLength={200} />
              </Field>
              <Field label="Visual style">
                <Input value={draft.style} onChange={(e) => set("style", e.target.value)} maxLength={200} />
              </Field>
            </div>
            <Field label="Voice guidelines" hint="How the brand speaks; the Creative and Sales agents follow this.">
              <Textarea value={draft.voice} onChange={(e) => set("voice", e.target.value)} rows={3} maxLength={1000} />
            </Field>
            <Field label="What the business does">
              <Textarea value={draft.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={2000} />
            </Field>
            <Field label="Target audience">
              <Textarea value={draft.targetAudience} onChange={(e) => set("targetAudience", e.target.value)} rows={2} maxLength={1000} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Keywords" hint="comma separated">
                <Textarea value={draft.keywords.join(", ")} onChange={(e) => set("keywords", list(e.target.value))} rows={3} />
              </Field>
              <Field label="Forbidden words" hint="never used in videos or messages">
                <Textarea value={draft.forbiddenWords.join(", ")} onChange={(e) => set("forbiddenWords", list(e.target.value))} rows={3} />
              </Field>
              <Field label="Preferred CTAs">
                <Textarea value={draft.ctaPreferences.join(", ")} onChange={(e) => set("ctaPreferences", list(e.target.value))} rows={3} />
              </Field>
            </div>
            <Field label="Logo">
              <Select value={draft.logoAssetId ?? ""} onChange={(e) => set("logoAssetId", e.target.value || null)}>
                <option value="">No logo (brand name chip)</option>
                {assets
                  .filter((a) => a.mimeType.startsWith("image/"))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.filename} ({a.kind.toLowerCase()})
                    </option>
                  ))}
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Assets</CardTitle>
              <CardDescription>Logos, product photos, screenshots, short clips (PNG, JPG, WebP, SVG ≤ 15 MB · MP4/MOV ≤ 300 MB · MP3/WAV/M4A ≤ 30 MB). Files are type-checked by content, not just extension.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
              }}
              className={cn("mb-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 py-6 text-center transition-colors", dragOver && "border-primary bg-primary-soft/50")}
            >
              <ImageUp className="mb-2 size-5 text-muted-foreground" />
              <p className="text-sm">Drop files here or</p>
              <Button size="sm" className="mt-2" loading={uploading} onClick={() => fileRef.current?.click()}>
                Choose files
              </Button>
              <input ref={fileRef} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/svg+xml,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/mp4" onChange={(e) => e.target.files && void upload(e.target.files)} />
            </div>
            {assets.length === 0 ? <p className="text-center text-sm text-muted-foreground">No assets yet. Videos use the brand colors and typography until you add some.</p> : null}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {assets.map((a) => (
                <div key={a.id} className="group overflow-hidden rounded-lg border border-border">
                  <div className="relative grid aspect-square place-items-center bg-muted">
                    {a.thumb ?? (a.mimeType.startsWith("image/") ? a.url : null) ? <img src={(a.thumb ?? a.url)!} alt={a.filename} className="size-full object-contain" loading="lazy" /> : <span className="text-xs text-muted-foreground">{a.mimeType.split("/")[0]}</span>}
                    <button
                      className="absolute top-1.5 right-1.5 hidden rounded bg-black/60 p-1 text-white group-hover:block"
                      aria-label={`Delete ${a.filename}`}
                      onClick={() =>
                        confirm(`Delete ${a.filename}?`) &&
                        start(async () => {
                          const r = await deleteAssetAction(workspaceId, a.id);
                          if (r.ok) toast.success(r.message);
                          else toast.error(r.error);
                          router.refresh();
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <div className="p-2">
                    <div className="truncate text-[12px] font-medium">{a.filename}</div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{a.kind.toLowerCase()}</span>
                      {a.status !== "READY" ? <Badge tone="warning">{a.status.toLowerCase()}</Badge> : <span>{(a.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="overflow-hidden">
          <div className="relative aspect-[9/12] p-6" style={{ background: `radial-gradient(120% 70% at 20% 0%, ${draft.primaryColor}55, transparent 60%), ${draft.backgroundColor}` }}>
            <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${draft.primaryColor}33`, color: draft.textColor }}>
              {draft.handle || draft.businessName}
            </span>
            <div className="mt-10 text-3xl leading-none font-extrabold uppercase" style={{ fontFamily: `"${draft.fontHeading}", Inter, sans-serif`, color: draft.textColor }}>
              Seu gancho <span style={{ color: draft.accentColor }}>aqui</span>
            </div>
            <div className="mt-3 text-sm" style={{ fontFamily: `"${draft.fontBody}", Inter, sans-serif`, color: draft.textColor, opacity: 0.8 }}>
              {draft.description.slice(0, 90) || "Preview of your video identity"}
            </div>
            <div className="absolute right-6 bottom-6 left-6 rounded-xl px-4 py-3 text-center text-sm font-bold" style={{ background: draft.primaryColor, color: draft.backgroundColor }}>
              {draft.ctaPreferences[0] ?? "Fale no WhatsApp"}
            </div>
          </div>
          <CardContent className="pt-3 text-[11px] text-muted-foreground">Quick identity preview. Actual templates adapt contrast automatically for readability.</CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Website analyzer</CardTitle>
              <CardDescription>Reads public pages only (private/local addresses are blocked).</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourbusiness.com" />
              <Button
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await analyzeWebsiteAction(url, workspaceId);
                    if (r.ok) setAnalysis({ name: r.data.name, description: r.data.description, colors: r.data.colors, headings: r.data.headings, prices: r.data.prices, aiSummary: r.data.ai ? `${r.data.ai.industry} · ${r.data.ai.description} Audience: ${r.data.ai.targetAudience}. Tone: ${r.data.ai.tone}.` : null, aiError: r.data.aiError });
                    else toast.error(r.error);
                  })
                }
              >
                <Globe /> Analyze
              </Button>
            </div>
            {analysis ? (
              <div className="space-y-3 text-[13px]">
                {analysis.name ? <div className="font-medium">{analysis.name}</div> : null}
                {analysis.description ? <p className="text-muted-foreground">{analysis.description}</p> : null}
                {analysis.colors.length ? (
                  <div>
                    <div className="mb-1 text-[11px] text-muted-foreground">Colors found</div>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.colors.slice(0, 8).map((c) => (
                        <span key={c} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">
                          <span className="size-3 rounded-sm" style={{ background: c }} />
                          {c}
                        </span>
                      ))}
                    </div>
                    <Button
                      size="xs"
                      className="mt-2"
                      onClick={() => {
                        const [p, s, a] = analysis.colors;
                        setDraft((d) => ({ ...d, primaryColor: p ?? d.primaryColor, secondaryColor: s ?? d.secondaryColor, accentColor: a ?? d.accentColor, description: d.description || analysis.description || "" }));
                        toast.info("Applied to the Brand Kit — review and save");
                      }}
                    >
                      <Wand2 /> Apply to Brand Kit
                    </Button>
                  </div>
                ) : null}
                {analysis.prices.length ? <div className="text-[12px]">Prices seen: {analysis.prices.slice(0, 6).join(" · ")}</div> : null}
                {analysis.aiSummary ? <div className="rounded-lg bg-muted/60 p-2 text-[12px]">{analysis.aiSummary}</div> : analysis.aiError ? <div className="text-[11px] text-muted-foreground">AI summary unavailable: {analysis.aiError}</div> : null}
              </div>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={!url}
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await screenshotAction(workspaceId, url);
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.error);
                })
              }
            >
              <Camera /> Capture screenshot (worker)
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
