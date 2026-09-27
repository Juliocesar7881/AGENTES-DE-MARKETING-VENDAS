import { Easing, interpolate, spring } from "remotion";

export * from "./color";
export * from "./layout";

/* ------------------------------ motion ------------------------------ */

export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

export type MotionPreset = "smooth" | "snappy" | "slow";

export const SPRINGS: Record<MotionPreset, { damping: number; mass: number; stiffness: number }> = {
  smooth: { damping: 200, mass: 1, stiffness: 100 },
  snappy: { damping: 14, mass: 0.6, stiffness: 180 },
  slow: { damping: 200, mass: 2.2, stiffness: 60 },
};

export function enter(frame: number, fps: number, delay = 0, preset: MotionPreset = "smooth", durationInFrames?: number): number {
  return spring({ frame: frame - delay, fps, config: SPRINGS[preset], durationInFrames });
}

export function fadeInOut(frame: number, total: number, inFrames = 8, outFrames = 8): number {
  return interpolate(frame, [0, inFrames, Math.max(inFrames + 1, total - outFrames), total], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export function progress(frame: number, start: number, end: number, easing = EASE_OUT): number {
  return interpolate(frame, [start, end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
}
