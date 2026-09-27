"use client";
import type { VideoSpec } from "@revenueos/shared/video-spec";
import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { saveSpecAction } from "@/server/actions/content";

/** Text-level editing of the VideoSpec (validated server-side, saved as a new version, then re-rendered). */
export function SpecEditor({ contentId, spec, readOnly }: { contentId: string; spec: VideoSpec; readOnly?: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<VideoSpec>(spec);
  const [json, setJson] = useState(() => JSON.stringify(spec, null, 2));
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(draft) !== JSON.stringify(spec);

  const setScene = (i: number, patch: Partial<VideoSpec["scenes"][number]>) => setDraft((d) => ({ ...d, scenes: d.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const save = (value: unknown) =>
    start(async () => {
      const r = await saveSpecAction(contentId, value);
      if (r.ok) {
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.error);
    });

  return (
    <Tabs defaultValue="scenes">
      <div className="mb-3 flex items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="scenes">Scenes</TabsTrigger>
          <TabsTrigger value="json">VideoSpec JSON</TabsTrigger>
        </TabsList>
        {!readOnly ? (
          <Button size="sm" variant="primary" disabled={!dirty} loading={pending} onClick={() => save(draft)}>
            <Save /> Save & re-render
          </Button>
        ) : null}
      </div>
      <TabsContent value="scenes" className="space-y-3">
        <Field label="Hook (first 2 seconds)">
          <Input value={draft.hook.text} disabled={readOnly} maxLength={140} onChange={(e) => setDraft((d) => ({ ...d, hook: { ...d.hook, text: e.target.value } }))} />
        </Field>
        {draft.scenes.map((s, i) => (
          <div key={s.id} className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Badge tone="primary">{s.type}</Badge>
              <span className="tabular">
                {s.start.toFixed(1)}s → {(s.start + s.duration).toFixed(1)}s
              </span>
              <span>· {s.animation ?? "auto"}</span>
            </div>
            <div className="grid gap-2">
              <Input value={s.headline ?? ""} disabled={readOnly} placeholder="Headline" maxLength={120} onChange={(e) => setScene(i, { headline: e.target.value || undefined })} />
              {s.body !== undefined || !readOnly ? <Textarea value={s.body ?? ""} disabled={readOnly} placeholder="Body text (optional)" rows={2} maxLength={220} onChange={(e) => setScene(i, { body: e.target.value || undefined })} /> : null}
              {s.bullets?.length ? (
                <Textarea value={s.bullets.join("\n")} disabled={readOnly} rows={Math.min(5, s.bullets.length)} onChange={(e) => setScene(i, { bullets: e.target.value.split("\n").filter(Boolean).slice(0, 5) })} />
              ) : null}
            </div>
          </div>
        ))}
        <Field label="Call to action">
          <Input value={draft.cta.text} disabled={readOnly} maxLength={60} onChange={(e) => setDraft((d) => ({ ...d, cta: { ...d.cta, text: e.target.value } }))} />
        </Field>
      </TabsContent>
      <TabsContent value="json">
        <Textarea value={json} onChange={(e) => setJson(e.target.value)} disabled={readOnly} rows={22} className="font-mono text-[11px]" spellCheck={false} />
        {!readOnly ? (
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              loading={pending}
              onClick={() => {
                try {
                  save(JSON.parse(json));
                } catch {
                  toast.error("Invalid JSON");
                }
              }}
            >
              Validate & save JSON
            </Button>
          </div>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
