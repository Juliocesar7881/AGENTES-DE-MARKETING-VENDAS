import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SoundtrackMood } from "@revenueos/shared/video-spec";

/**
 * Synthesizes an ORIGINAL, royalty-free ambient pad (16-bit PCM WAV) so videos
 * can have gentle music without any copyrighted material. Deterministic per seed.
 */
const CHORDS: Record<Exclude<SoundtrackMood, "none">, number[][]> = {
  upbeat: [[261.63, 329.63, 392.0], [293.66, 369.99, 440.0], [329.63, 415.3, 493.88], [293.66, 369.99, 440.0]],
  calm: [[220.0, 261.63, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]],
  epic: [[146.83, 220.0, 293.66], [130.81, 196.0, 261.63], [116.54, 174.61, 233.08], [130.81, 196.0, 261.63]],
  corporate: [[261.63, 329.63, 392.0], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]],
  playful: [[329.63, 392.0, 493.88], [349.23, 440.0, 523.25], [392.0, 493.88, 587.33], [349.23, 440.0, 523.25]],
};

export async function generateAmbientTrack(outFile: string, durationSec: number, mood: SoundtrackMood, seed = 1): Promise<string> {
  const sampleRate = 44100;
  const n = Math.ceil(durationSec * sampleRate);
  const chords = CHORDS[mood === "none" ? "calm" : mood];
  const barSec = mood === "upbeat" || mood === "playful" ? 2 : 3;
  const data = Buffer.alloc(44 + n * 4);
  const tempo = mood === "upbeat" || mood === "playful" ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const chord = chords[Math.floor(t / barSec + seed) % chords.length]!;
    const barPos = (t % barSec) / barSec;
    const env = Math.min(1, barPos * 6) * (1 - Math.max(0, barPos - 0.85) * 4);
    let s = 0;
    chord.forEach((f, k) => {
      s += Math.sin(2 * Math.PI * f * t + k) * 0.18 + Math.sin(2 * Math.PI * f * 2 * t) * 0.04;
    });
    // soft pulse
    const pulse = 0.75 + 0.25 * Math.sin(2 * Math.PI * tempo * t);
    const fade = Math.min(1, t / 1.5, (durationSec - t) / 1.5);
    const v = Math.max(-1, Math.min(1, s * env * pulse * fade * 0.6));
    const sample = Math.round(v * 32767);
    data.writeInt16LE(sample, 44 + i * 4);
    data.writeInt16LE(sample, 44 + i * 4 + 2);
  }
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + n * 4, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 4, 28);
  data.writeUInt16LE(4, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(n * 4, 40);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, data);
  return outFile;
}
