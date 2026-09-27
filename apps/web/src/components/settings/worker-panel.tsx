"use client";
import { ExternalLink, Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Badge, Dot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ago } from "@/lib/utils";
import { workerPauseAction } from "@/server/actions/global";
import type { WorkerStatus } from "@/server/queries";

export function WorkerPanel({ workers, isAdmin }: { workers: WorkerStatus[]; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <div className="space-y-4">
        {workers.length === 0 ? (
          <Card>
            <CardContent className="pt-5 text-[13px] text-muted-foreground">No worker has connected yet. Follow the steps on the right.</CardContent>
          </Card>
        ) : null}
        {workers.map((w) => {
          const health = w.health as Record<string, { ok: boolean; detail: string } | string>;
          return (
            <Card key={w.id}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Dot tone={!w.online ? "danger" : w.paused ? "warning" : "success"} pulse={w.online && w.currentJobs.length > 0} />
                  <div>
                    <CardTitle>{w.name}</CardTitle>
                    <CardDescription>
                      {w.id} · v{w.version} · {w.platform}
                    </CardDescription>
                  </div>
                </div>
                <Badge tone={!w.online ? "danger" : w.paused ? "warning" : "success"}>{!w.online ? `offline · ${ago(w.lastHeartbeatAt)}` : w.paused ? "paused" : "online"}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    ["Pending", String((w.stats as { pending?: number }).pending ?? 0)],
                    ["Running", String(w.currentJobs.length)],
                    ["Rendered today", String((w.stats as { renderedToday?: number }).renderedToday ?? 0)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-border p-2">
                      <div className="text-[11px] text-muted-foreground">{k}</div>
                      <div className="tabular text-lg font-semibold">{v}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-1 text-[12px]">
                  {Object.entries(health)
                    .filter(([k, v]) => k !== "checkedAt" && typeof v === "object")
                    .map(([k, v]) => {
                      const c = v as { ok: boolean; detail: string };
                      return (
                        <div key={k} className="flex justify-between gap-3">
                          <span className="text-muted-foreground capitalize">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                          <span className={c.ok ? "" : "text-warning"}>{c.detail}</span>
                        </div>
                      );
                    })}
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">render folder</span>
                    <span className="font-mono">{String((w.stats as { renderDir?: string }).renderDir ?? "—")}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isAdmin && w.online ? (
                    <Button
                      size="sm"
                      loading={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await workerPauseAction(w.id, !w.paused);
                          if (r.ok) toast.success(r.message);
                          else toast.error(r.error);
                          router.refresh();
                        })
                      }
                    >
                      {w.paused ? (
                        <>
                          <Play /> Resume worker
                        </>
                      ) : (
                        <>
                          <Pause /> Pause worker
                        </>
                      )}
                    </Button>
                  ) : null}
                  {w.localUiUrl ? (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={w.localUiUrl} target="_blank" rel="noopener noreferrer">
                        Local panel <ExternalLink />
                      </a>
                    </Button>
                  ) : null}
                </div>
                {w.localUiUrl ? <p className="text-[11px] text-subtle">The local panel only opens on the computer running the worker.</p> : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Install the worker on Windows</CardTitle>
            <CardDescription>Renders videos with Remotion + FFmpeg on your PC (no cloud GPU), runs AI jobs and uploads deliveries.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-4 text-[13px]">
            <li>
              Install <strong>Node.js 20 LTS+</strong> and download this repository to the PC (e.g. <code className="font-mono">C:\RevenueOS</code>).
            </li>
            <li>
              Double-click <code className="font-mono">setup-worker.bat</code>. It checks dependencies, installs packages (FFmpeg comes with Remotion), asks for the database connection and stores secrets encrypted with Windows DPAPI, then runs a real test render.
            </li>
            <li>
              Start it with <code className="font-mono">start-worker.bat</code>. A tray icon and a local panel (<code className="font-mono">127.0.0.1:4417</code>) show status, pause/resume, render folder and logs.
            </li>
            <li>Optional: enable “Start with Windows” in the local panel (a visible, removable entry in Task Manager → Startup apps).</li>
          </ol>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Renders go to <code className="font-mono">D:\RevenueOS\renders</code> when a D: drive exists, otherwise <code className="font-mono">%USERPROFILE%\RevenueOS\renders</code>. When the PC is off, jobs stay queued and run when it comes back.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
