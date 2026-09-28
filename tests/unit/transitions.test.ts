import { describe, expect, it } from "vitest";
import { TRANSITIONS, type TransitionKind } from "@revenueos/shared/video-spec";
import { placeScenes, placementVisual, planCaptions, transitionVisual } from "@revenueos/video-engine";

const FPS = 30;
const scenes = [
  { start: 0, duration: 2.2 },
  { start: 2.2, duration: 3 },
  { start: 5.2, duration: 1.2 },
  { start: 6.4, duration: 3.6 },
];
const total = Math.round(10 * FPS);

function num(re: RegExp, s: string | undefined): number {
  const m = s?.match(re);
  return m ? Number(m[1]) : 0;
}

/** Visual of the outgoing and incoming scene at every absolute frame of every boundary. */
function boundaryFrames(kind: TransitionKind) {
  const pls = placeScenes(scenes, [], FPS, total, kind);
  const out: { a: ReturnType<typeof placementVisual>; b: ReturnType<typeof placementVisual> }[][] = [];
  for (let i = 0; i < pls.length - 1; i++) {
    const A = pls[i]!;
    const B = pls[i + 1]!;
    const frames = [];
    for (let f = B.from; f < A.from + A.duration; f++) frames.push({ a: placementVisual(A, f - A.from), b: placementVisual(B, f - B.from) });
    out.push(frames);
  }
  return { pls, out };
}

describe("scene transitions never make text vanish abruptly", () => {
  it.each(TRANSITIONS)("%s: both scenes share the same window, which lasts long enough to be seen", (kind) => {
    const { pls, out } = boundaryFrames(kind);
    for (let i = 0; i < pls.length - 1; i++) {
      const A = pls[i]!;
      const B = pls[i + 1]!;
      expect(A.from + A.duration - B.from).toBe(A.outWindow); // same absolute frames
      expect(B.inWindow).toBe(A.outWindow);
      expect(A.outWindow).toBeGreaterThanOrEqual(6);
      if (kind !== "none") expect(A.outWindow).toBeGreaterThanOrEqual(Math.min(Math.round(0.45 * FPS), Math.round(0.4 * 1.2 * FPS)));
      expect(out[i]!.every((f) => f.a && f.b)).toBe(true);
    }
  });

  it.each(TRANSITIONS)("%s: the outgoing scene leaves gradually and is gone at the end", (kind) => {
    const { out } = boundaryFrames(kind);
    for (const frames of out) {
      const visible = frames.map(({ a }) => {
        const tx = Math.abs(num(/translate[XY]\((-?[\d.]+)%\)/, a!.transform));
        const clip = num(/inset\(0 0 0 ([\d.]+)%\)/, a!.clipPath);
        // Share of the outgoing content still visible: opacity × (not pushed out) × (not wiped).
        return a!.opacity * (1 - Math.min(100, tx) / 100) * (1 - clip / 100);
      });
      expect(visible[0]).toBeGreaterThan(0.9);
      expect(visible[visible.length - 1]).toBeLessThan(0.05);
      for (let k = 1; k < visible.length; k++) {
        expect(visible[k]!).toBeLessThanOrEqual(visible[k - 1]! + 1e-9); // monotonic
        expect(visible[k - 1]! - visible[k]!).toBeLessThan(0.5); // never a one-frame drop
      }
    }
  });

  it.each(["fade", "zoom", "blur", "none"] as const)("%s: old and new text are never both strongly visible", (kind) => {
    const { out } = boundaryFrames(kind);
    for (const frames of out) for (const { a, b } of frames) expect(Math.min(a!.opacity, b!.opacity)).toBeLessThan(0.35);
  });

  it("push transitions move both scenes together (side by side, no overlap)", () => {
    for (const kind of ["slide-left", "slide-up"] as const) {
      for (const frames of boundaryFrames(kind).out) {
        for (const { a, b } of frames) {
          const ta = num(/translate[XY]\((-?[\d.]+)%\)/, a!.transform);
          const tb = num(/translate[XY]\((-?[\d.]+)%\)/, b!.transform);
          expect(tb - ta).toBeCloseTo(100, 6);
        }
      }
    }
  });

  it("wipe uses one shared edge: the old content is hidden exactly where the new appears", () => {
    for (const frames of boundaryFrames("wipe").out) {
      for (const { a, b } of frames) {
        const hiddenOld = num(/inset\(0 0 0 ([\d.]+)%\)/, a!.clipPath);
        const hiddenNew = num(/inset\(0 ([\d.]+)% 0 0\)/, b!.clipPath);
        expect(hiddenOld + hiddenNew).toBeCloseTo(100, 6);
      }
    }
  });

  it("outside transition windows scenes are fully visible and untouched", () => {
    const pls = placeScenes(scenes, [], FPS, total, "zoom");
    const pl = pls[1]!;
    expect(placementVisual(pl, pl.inWindow + 3)).toBeNull();
    expect(transitionVisual("zoom", 1, "in").opacity).toBeCloseTo(1, 6);
  });
});

describe("subtitle band", () => {
  const sc = [
    { start: 0, duration: 3, headline: "Cansado de rotina corrida e pouco tempo de qualidade?", body: null },
    { start: 3, duration: 3, headline: "Tudo começou com não saber se a escola desenvolve o potencial", body: null },
    { start: 6, duration: 4, headline: "Agende uma visita", body: null },
  ];

  it("does not repeat a sentence that the scene already shows", () => {
    const caps = planCaptions(
      [
        { start: 0.1, end: 2.9, text: "Cansado de rotina corrida e pouco tempo de qualidade?" },
        { start: 3.05, end: 5.9, text: "Tudo começou com não saber se a escola desenvolve o…" },
        { start: 6.05, end: 9.9, text: "Vagas limitadas para março — fale com a gente no WhatsApp" },
      ],
      sc,
    );
    expect(caps.map((c) => c.text)).toEqual(["Vagas limitadas para março — fale com a gente no WhatsApp"]);
  });

  it("closes short gaps so the band does not blink between phrases", () => {
    const caps = planCaptions(
      [
        { start: 0.1, end: 1.5, text: "primeira frase diferente" },
        { start: 1.65, end: 2.9, text: "segunda frase diferente" },
        { start: 4, end: 5, text: "terceira frase depois de pausa longa" },
      ],
      [{ start: 0, duration: 10, headline: "outro assunto", body: null }],
    );
    expect(caps[0]!.end).toBe(1.65);
    expect(caps[1]!.end).toBe(2.9); // a real pause (1.1s) stays a pause
  });
});
