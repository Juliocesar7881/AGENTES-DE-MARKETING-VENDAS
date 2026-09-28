import type { TransitionKind } from "@revenueos/shared/video-spec";
import { clamp01 } from "./layout";

/*
 * Scene transition choreography (pure — no Remotion import, unit-tested).
 *
 * Rule: text never vanishes from one frame to the next. At every scene change
 * the outgoing content visibly LEAVES (moves, fades or is wiped away over
 * several frames) and the incoming content ARRIVES — and they never sit on top
 * of each other at full strength:
 *   • slide-left / slide-up  → push: both move together, side by side (no overlap)
 *   • wipe                   → one shared edge hides the old and reveals the new
 *   • fade / zoom / blur     → "dip": the old leaves first, then the new arrives
 *   • none                   → a very short dip instead of a single-frame pop
 */

export const MIN_TRANSITION_SEC = 0.45;
const NONE_TRANSITION_SEC = 0.2;
/** Fraction of the window used by the outgoing half of a "dip" (the incoming half mirrors it). */
const DIP_SPLIT = 0.55;

export interface TransitionVisual {
  opacity: number;
  transform?: string;
  filter?: string;
  clipPath?: string;
}

export interface ScenePlacement<S = unknown> {
  scene: S;
  index: number;
  /** First frame the scene is mounted (includes the incoming transition window). */
  from: number;
  duration: number;
  /** Frames of the incoming window at the start of the placement. */
  inWindow: number;
  /** Frames of the outgoing window at the end of the placement. */
  outWindow: number;
  inType: TransitionKind;
  outType: TransitionKind;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Cubic in-out easing (same feel as the templates' EASE_IN_OUT). */
export function easeInOut(x: number): number {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Transition window length in frames for a boundary between two scenes. */
export function transitionFrames(kind: TransitionKind, requestedSec: number | undefined, fps: number, prevSceneSec: number, nextSceneSec: number): number {
  const wanted = kind === "none" ? NONE_TRANSITION_SEC : Math.max(MIN_TRANSITION_SEC, requestedSec ?? MIN_TRANSITION_SEC);
  // Never eat more than 40% of the shorter neighbour (fast cuts stay fast), never below 6 frames.
  const cap = 0.4 * Math.min(prevSceneSec, nextSceneSec);
  const sec = Math.min(wanted, Math.max(cap, 0.2));
  return Math.max(6, Math.round(sec * fps));
}

export function placeScenes<S extends { start: number; duration: number }>(
  scenes: S[],
  transitions: { afterScene: number; type: TransitionKind; durationSec?: number }[],
  fps: number,
  totalFrames: number,
  defaultTransition: TransitionKind,
): ScenePlacement<S>[] {
  const byAfter = new Map(transitions.map((t) => [t.afterScene, t]));
  // Window per boundary i (between scene i and i+1), centred on the cut.
  const windows = scenes.slice(0, -1).map((s, i) => {
    const t = byAfter.get(i) ?? { type: defaultTransition, durationSec: MIN_TRANSITION_SEC };
    return { type: t.type, frames: transitionFrames(t.type, t.durationSec, fps, s.duration, scenes[i + 1]!.duration) };
  });
  return scenes.map((scene, i) => {
    const start = Math.round(scene.start * fps);
    const end = i === scenes.length - 1 ? totalFrames : Math.round((scene.start + scene.duration) * fps);
    const win = i > 0 ? windows[i - 1]! : null;
    const wout = i < scenes.length - 1 ? windows[i]! : null;
    const before = win ? Math.floor(win.frames / 2) : 0;
    const after = wout ? Math.ceil(wout.frames / 2) : 0;
    const from = Math.max(0, start - before);
    return {
      scene,
      index: i,
      from,
      duration: Math.max(1, end + after - from),
      inWindow: win ? start - from + Math.ceil(win.frames / 2) : 0,
      outWindow: wout ? wout.frames : 0,
      inType: win?.type ?? "none",
      outType: wout?.type ?? "none",
    };
  });
}

/**
 * Visual state of a scene inside a transition window.
 * p: 0 → start of the window, 1 → end. dir "out" = the scene that is leaving.
 * `unit` scales blur radii to the video size.
 */
export function transitionVisual(kind: TransitionKind, p: number, dir: "in" | "out", unit = 1): TransitionVisual {
  const e = easeInOut(p);
  switch (kind) {
    case "slide-left":
      // Push: outgoing moves left out of frame while the incoming follows from the right.
      return dir === "out" ? { opacity: 1, transform: `translateX(${-e * 100}%)` } : { opacity: 1, transform: `translateX(${(1 - e) * 100}%)` };
    case "slide-up":
      return dir === "out" ? { opacity: 1, transform: `translateY(${-e * 100}%)` } : { opacity: 1, transform: `translateY(${(1 - e) * 100}%)` };
    case "wipe":
      // One shared edge moving left → right: old content is hidden exactly where the new one appears.
      return dir === "out" ? { opacity: 1, clipPath: `inset(0 0 0 ${e * 100}%)` } : { opacity: 1, clipPath: `inset(0 ${(1 - e) * 100}% 0 0)` };
    case "zoom": {
      if (dir === "out") {
        const k = smoothstep(0, DIP_SPLIT, p);
        return { opacity: 1 - k, transform: `scale(${1 + 0.16 * k})` };
      }
      const k = smoothstep(1 - DIP_SPLIT, 1, p);
      return { opacity: k, transform: `scale(${0.9 + 0.1 * k})` };
    }
    case "blur": {
      if (dir === "out") {
        const k = smoothstep(0, DIP_SPLIT, p);
        return { opacity: 1 - k, filter: `blur(${k * 22 * unit}px)` };
      }
      const k = smoothstep(1 - DIP_SPLIT, 1, p);
      return { opacity: k, filter: `blur(${(1 - k) * 22 * unit}px)` };
    }
    case "fade":
    case "none":
    default: {
      if (dir === "out") {
        const k = smoothstep(0, DIP_SPLIT, p);
        return { opacity: 1 - k, transform: `translateY(${-k * 3}%)` };
      }
      const k = smoothstep(1 - DIP_SPLIT, 1, p);
      return { opacity: k, transform: `translateY(${(1 - k) * 3}%)` };
    }
  }
}

/** Style for a placement at a frame relative to its own start (identity outside transition windows). */
export function placementVisual(pl: Pick<ScenePlacement, "duration" | "inWindow" | "outWindow" | "inType" | "outType">, frame: number, unit = 1): TransitionVisual | null {
  // Both scenes of a boundary sample the same progress at the same absolute frame (mid-frame),
  // so pushes and wipes stay perfectly in sync (no gap, no overlap).
  if (pl.inWindow > 0 && frame < pl.inWindow) return transitionVisual(pl.inType, (frame + 0.5) / pl.inWindow, "in", unit);
  const k = frame - (pl.duration - pl.outWindow);
  if (pl.outWindow > 0 && k >= 0) return transitionVisual(pl.outType, (k + 0.5) / pl.outWindow, "out", unit);
  return null;
}

/* ---------------------------- captions band ---------------------------- */

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Share of the caption's words already on screen in the scene text (headline/body). */
export function captionOverlap(caption: string, sceneText: string): number {
  const c = words(caption);
  if (c.length === 0) return 1;
  const s = new Set(words(sceneText));
  return c.filter((w) => s.has(w)).length / c.length;
}

/**
 * Captions shown in the subtitle band: drops captions that repeat the text the
 * scene already shows (no duplicated sentences on screen) and closes short gaps
 * between consecutive captions so the band does not blink between phrases.
 */
export function planCaptions<C extends { start: number; end: number; text: string }>(captions: C[], scenes: { start: number; duration: number; headline?: string | null; body?: string | null }[], bridgeSec = 0.4): C[] {
  const kept = captions
    .filter((c) => {
      const scene = scenes.find((s) => c.start >= s.start - 0.05 && c.start < s.start + s.duration);
      if (!scene) return true;
      return captionOverlap(c.text, `${scene.headline ?? ""} ${scene.body ?? ""}`) < 0.6;
    })
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ ...c }));
  for (let i = 0; i < kept.length - 1; i++) {
    const gap = kept[i + 1]!.start - kept[i]!.end;
    if (gap > 0 && gap <= bridgeSec) kept[i]!.end = kept[i + 1]!.start;
  }
  return kept;
}
