"use client";
import { Player } from "@remotion/player";
import type { VideoSpec } from "@revenueos/shared/video-spec";
import { RevenueOSVideo } from "@revenueos/video-engine";
import { MonitorPlay, Clapperboard } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function VideoPreview({ spec, assets, videoUrl, localUrl, poster }: { spec: VideoSpec | null; assets: Record<string, string>; videoUrl: string | null; localUrl: string | null; poster: string | null }) {
  const src = videoUrl ?? localUrl;
  const [mode, setMode] = useState<"render" | "live">(src ? "render" : "live");
  const [localFailed, setLocalFailed] = useState(false);
  const aspect = spec ? `${spec.width} / ${spec.height}` : "9 / 16";
  return (
    <div>
      <div className="mb-2 flex items-center gap-1 rounded-lg border border-border bg-muted/60 p-0.5">
        <button onClick={() => setMode("render")} disabled={!src} className={cn("flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] font-medium text-muted-foreground disabled:opacity-40", mode === "render" && "bg-card text-foreground shadow-card")}>
          <Clapperboard className="size-3.5" /> Rendered MP4
        </button>
        <button onClick={() => setMode("live")} disabled={!spec} className={cn("flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] font-medium text-muted-foreground disabled:opacity-40", mode === "live" && "bg-card text-foreground shadow-card")}>
          <MonitorPlay className="size-3.5" /> Live preview
        </button>
      </div>
      <div className="relative mx-auto w-full overflow-hidden rounded-xl bg-black shadow-pop ring-1 ring-border" style={{ aspectRatio: aspect, maxHeight: "72vh" }}>
        {mode === "render" && src ? (
          localFailed && !videoUrl ? (
            <div className="grid size-full place-items-center p-6 text-center text-sm text-white/70">The rendered file lives on the worker computer. Open this page on that computer (with the worker running) or enable “Upload preview copies” in the worker settings.</div>
          ) : (
            <video key={src} src={src} poster={poster ?? undefined} controls playsInline className="size-full object-contain" onError={() => setLocalFailed(true)} />
          )
        ) : spec ? (
          <Player
            component={RevenueOSVideo}
            inputProps={{ spec, assets, fontBaseUrl: "/video-fonts" }}
            durationInFrames={Math.max(1, Math.round(spec.duration * spec.fps))}
            fps={spec.fps}
            compositionWidth={spec.width}
            compositionHeight={spec.height}
            style={{ width: "100%", height: "100%" }}
            controls
            loop
          />
        ) : (
          <div className="grid size-full place-items-center text-sm text-white/60">No VideoSpec yet — the Creative agent is working.</div>
        )}
      </div>
      {mode === "live" ? <p className="mt-2 text-center text-[11px] text-subtle">Live preview renders the VideoSpec in your browser (generated soundtrack only in the MP4).</p> : null}
    </div>
  );
}
