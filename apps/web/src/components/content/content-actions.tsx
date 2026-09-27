"use client";
import { Archive, CalendarClock, CalendarX, Check, Download, RefreshCw, Rocket, Send, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/server/action";
import { approveContentAction, archiveAction, publishNowAction, regenerateAction, regenerateHookAction, rerenderAction, scheduleContentAction, unscheduleAction } from "@/server/actions/content";

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ContentActions({ id, status, approvalStatus, hasSpec, downloadUrl, isDemo }: { id: string; status: string; approvalStatus: string; hasSpec: boolean; downloadUrl: string | null; isDemo: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + 3600_000)));
  const [feedback, setFeedback] = useState("");

  const act = (fn: () => Promise<ActionResult<unknown>>, confirmText?: string) =>
    start(async () => {
      if (confirmText && !confirm(confirmText)) return;
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Done");
      else toast.error(r.error);
      router.refresh();
    });

  const canPublish = ["READY", "SCHEDULED", "FAILED"].includes(status) && hasSpec;
  const published = status === "PUBLISHED" || status === "PUBLISHING";
  return (
    <div className="flex flex-wrap gap-2">
      {approvalStatus === "PENDING" ? (
        <Button variant="success" size="sm" loading={pending} onClick={() => act(() => approveContentAction(id))}>
          <Check /> Approve
        </Button>
      ) : null}
      {!published && ["READY", "SCHEDULED"].includes(status) ? (
        <Button size="sm" variant={status === "READY" ? "primary" : "secondary"} onClick={() => setScheduleOpen(true)}>
          <CalendarClock /> {status === "SCHEDULED" ? "Reschedule" : "Schedule"}
        </Button>
      ) : null}
      {canPublish && !published ? (
        <Button size="sm" loading={pending} onClick={() => act(() => publishNowAction(id), isDemo ? "Publish now to the DEMO (simulated) accounts?" : "Publish now to the connected social accounts? This posts publicly.")}>
          <Send /> Publish now
        </Button>
      ) : null}
      {status === "SCHEDULED" ? (
        <Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => unscheduleAction(id))}>
          <CalendarX /> Unschedule
        </Button>
      ) : null}
      {hasSpec && !published ? (
        <Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => rerenderAction(id))}>
          <RefreshCw /> Re-render
        </Button>
      ) : null}
      {!published ? (
        <>
          <Button size="sm" variant="ghost" loading={pending} disabled={!hasSpec} onClick={() => act(() => regenerateHookAction(id))}>
            <Wand2 /> New hook
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRegenOpen(true)}>
            <Rocket /> Regenerate
          </Button>
        </>
      ) : null}
      {downloadUrl ? (
        <Button size="sm" variant="ghost" asChild>
          <a href={downloadUrl} download>
            <Download /> MP4
          </a>
        </Button>
      ) : null}
      {status !== "ARCHIVED" && !published ? (
        <Button size="sm" variant="ghost" loading={pending} onClick={() => act(() => archiveAction(id), "Archive this content? It will not be published.")}>
          <Archive /> Archive
        </Button>
      ) : null}

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent title={status === "SCHEDULED" ? "Reschedule" : "Schedule"} description="Pick a time, or use the next open slot from this business's posting schedule.">
          <Field label="Date and time (your local time)">
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <DialogFooter>
            {status === "READY" ? (
              <Button
                loading={pending}
                onClick={() => {
                  setScheduleOpen(false);
                  act(() => scheduleContentAction(id, null));
                }}
              >
                Next open slot
              </Button>
            ) : null}
            <Button
              variant="primary"
              loading={pending}
              onClick={() => {
                setScheduleOpen(false);
                act(() => scheduleContentAction(id, new Date(when).toISOString()));
              }}
            >
              Schedule at this time
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent title="Regenerate this video" description="The Creative agent writes a new script and VideoSpec (the current version stays in the history).">
          <Field label="What should change? (optional)" hint="e.g. “shorter, focus on the price objection, use a testimonial”">
            <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} maxLength={1000} />
          </Field>
          <DialogFooter>
            <Button onClick={() => setRegenOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => {
                setRegenOpen(false);
                act(() => regenerateAction(id, feedback));
              }}
            >
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
