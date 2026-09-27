"use client";
import { Pause, Play, Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { requestContentAction, setWorkspaceStatusAction, simulateWorkspaceDayAction } from "@/server/actions/workspace";

export function WorkspaceHeaderActions({ ws }: { ws: { id: string; status: string; environment: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState("1");
  const [focus, setFocus] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      {ws.environment === "DEMO" ? (
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            start(async () => {
              const id = toast.loading("Simulating a day for this business…");
              const r = await simulateWorkspaceDayAction(ws.id);
              toast.dismiss(id);
              if (r.ok) toast.success(`Simulated: ${r.data.workspaces[0]?.published ?? 0} posts, ${r.data.workspaces[0]?.leads ?? 0} leads, ${r.data.workspaces[0]?.sales ?? 0} sales (DEMO)`);
              else toast.error(r.error);
              router.refresh();
            })
          }
        >
          <Sparkles /> Simulate Day
        </Button>
      ) : null}
      <Button
        size="sm"
        onClick={() =>
          start(async () => {
            const next = ws.status === "PAUSED" ? "ACTIVE" : "PAUSED";
            if (next === "PAUSED" && !confirm("Pause this business? No automatic content, publishing or sales messages until you resume.")) return;
            const r = await setWorkspaceStatusAction(ws.id, next);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
            router.refresh();
          })
        }
      >
        {ws.status === "PAUSED" ? (
          <>
            <Play /> Resume
          </>
        ) : (
          <>
            <Pause /> Pause
          </>
        )}
      </Button>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        <Plus /> New content
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Create new content" description="The Strategist plans it from this business's sales and lead data, the Creative writes the VideoSpec and the local worker renders it.">
          <div className="grid gap-4">
            <Field label="How many videos">
              <Select value={count} onChange={(e) => setCount(e.target.value)}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Focus (optional)" hint="e.g. “promote the laser whitening offer” or “answer the price objection”.">
              <Textarea value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={500} rows={3} />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await requestContentAction(ws.id, { count: Number(count), focus: focus.trim() || null });
                  if (r.ok) {
                    toast.success(r.message);
                    setOpen(false);
                    setFocus("");
                  } else toast.error(r.error);
                  router.refresh();
                })
              }
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
