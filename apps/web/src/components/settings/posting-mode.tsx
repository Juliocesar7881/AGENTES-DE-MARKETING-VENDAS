"use client";
import { Clock, Plus, Rocket, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PostingModeValue = "smart" | "fixed" | "asap";

const OPTIONS: { id: PostingModeValue; icon: typeof Sparkles; title: string; text: string; badge?: string }[] = [
  { id: "smart", icon: Sparkles, title: "Smart times", badge: "Recommended", text: "Posts ~15 min before your audience's peak on each network, and learns from your own views, clicks and leads." },
  { id: "fixed", icon: Clock, title: "Fixed times", text: "Always at the times you choose." },
  { id: "asap", icon: Rocket, title: "As soon as ready", text: "Each video goes out a few minutes after it is rendered (within the daily limit)." },
];

export function PostingModePicker({ mode, onMode, times, onTimes }: { mode: PostingModeValue; onMode: (m: PostingModeValue) => void; times: string[]; onTimes: (t: string[]) => void }) {
  const [newTime, setNewTime] = useState("12:00");
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <button key={o.id} type="button" aria-pressed={mode === o.id} onClick={() => onMode(o.id)} className={cn("rounded-lg border p-3 text-left transition", mode === o.id ? "border-primary bg-primary-soft" : "border-border hover:border-border-strong")}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <o.icon className={cn("size-4", mode === o.id ? "text-primary" : "text-muted-foreground")} />
              {o.badge ? <Badge tone="success">{o.badge}</Badge> : null}
            </div>
            <div className="text-[13px] font-semibold">{o.title}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{o.text}</div>
          </button>
        ))}
      </div>
      {mode === "fixed" ? (
        <div className="flex flex-wrap items-center gap-2">
          {times.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">
              {t}
              <button type="button" onClick={() => onTimes(times.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="h-8 w-28" aria-label="New posting time" />
          <Button type="button" size="xs" onClick={() => newTime && !times.includes(newTime) && onTimes([...times, newTime].sort())}>
            <Plus /> Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export interface TimingInsightsView {
  learned: boolean;
  observations: number;
  segment: string | null;
  windows: { dayType: "weekday" | "weekend"; hour: number; score: number; learned: boolean }[];
  upcoming: { localDate: string; localTime: string; status: string }[];
}

const hh = (h: number) => `${String(h).padStart(2, "0")}h`;

/** What the smart scheduler found for this business. */
export function TimingInsights({ data, mode }: { data: TimingInsightsView; mode: PostingModeValue }) {
  const max = Math.max(...data.windows.map((w) => w.score), 0.01);
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">Best windows</span>
        {data.learned ? <Badge tone="success">learned from {data.observations} posts</Badge> : <Badge>typical peaks{data.segment ? ` · ${data.segment}` : ""} — learning after ~8 posts</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["weekday", "weekend"] as const).map((dt) => (
          <div key={dt}>
            <div className="mb-1 text-muted-foreground">{dt === "weekday" ? "Mon–Fri" : "Sat–Sun"}</div>
            <div className="grid gap-1">
              {data.windows
                .filter((w) => w.dayType === dt)
                .map((w) => (
                  <div key={w.hour} className="flex items-center gap-2">
                    <span className="w-16 font-mono">
                      {hh(w.hour)}–{hh(w.hour + 1)}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round((w.score / max) * 100)}%` }} />
                    </span>
                    {w.learned ? <span className="text-success">your data</span> : null}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
      {mode !== "asap" && data.upcoming.length ? (
        <div>
          <span className="text-muted-foreground">Next slots: </span>
          {data.upcoming.slice(0, 6).map((u) => (
            <span key={`${u.localDate}${u.localTime}`} className="mr-2 font-mono">
              {u.localDate.slice(5).split("-").reverse().join("/")} {u.localTime}
              {u.status === "FILLED" ? "•" : ""}
            </span>
          ))}
        </div>
      ) : null}
      <p className="text-muted-foreground">Each network is fine-tuned within ±90 min of the slot to its own peak. • = already has a video.</p>
    </div>
  );
}
