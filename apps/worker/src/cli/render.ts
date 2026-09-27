/**
 * Render a VideoSpec locally without the queue (debugging / template work):
 *   pnpm render --sample [--template BOLD_HOOK] [--format 9:16|1:1|16:9] [--out ./out.mp4] [--scale 0.5]
 *   pnpm render path/to/spec.json --out ./out.mp4
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FORMAT_DIMENSIONS, normalizeVideoSpecTiming, serializeError, TEMPLATE_IDS, VIDEO_FORMATS, VideoSpecSchema, type TemplateId, type VideoFormat, type VideoSpec } from "@revenueos/shared";
import { SAMPLE_SPEC } from "@revenueos/video-engine";
import { renderVideo, validateVideo } from "@revenueos/video-engine/render";
import { loadDotEnv, loadWorkerConfig } from "../config";

loadDotEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const cfg = loadWorkerConfig();
  const file = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !(all[i - 1]?.startsWith("--") && all[i - 1] !== "--sample"));
  let spec: VideoSpec;
  if (process.argv.includes("--sample") || !file) {
    spec = structuredClone(SAMPLE_SPEC);
    const template = arg("template");
    if (template) {
      if (!(TEMPLATE_IDS as readonly string[]).includes(template)) throw new Error(`Unknown template. Use one of: ${TEMPLATE_IDS.join(", ")}`);
      spec.templateId = template as TemplateId;
    }
    const format = arg("format");
    if (format) {
      if (!(VIDEO_FORMATS as readonly string[]).includes(format)) throw new Error(`--format must be one of ${VIDEO_FORMATS.join(", ")}`);
      spec.format = format as VideoFormat;
      spec.width = FORMAT_DIMENSIONS[spec.format].width;
      spec.height = FORMAT_DIMENSIONS[spec.format].height;
    }
  } else {
    const parsed = VideoSpecSchema.safeParse(normalizeVideoSpecTiming(JSON.parse(await readFile(resolve(file), "utf8"))));
    if (!parsed.success) throw new Error(`Invalid VideoSpec:\n${parsed.error.issues.map((i) => ` - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
    spec = parsed.data;
  }
  const scale = Number(arg("scale") ?? 1);
  const out = resolve(arg("out") ?? join(cfg.renderDir, "manual", `${spec.templateId.toLowerCase()}-${Date.now()}.mp4`));
  process.stdout.write(`Rendering ${spec.templateId} ${spec.width}x${spec.height} ${spec.duration}s → ${out}\n`);
  let lastPct = -1;
  const r = await renderVideo({
    spec,
    outFile: out,
    thumbnailFile: out.replace(/\.mp4$/, ".jpg"),
    cacheDir: join(cfg.cacheDir, "remotion-bundle"),
    scale: scale > 0 && scale <= 1 ? scale : 1,
    onProgress: (p) => {
      const pct = Math.round(p.progress * 100);
      if (p.stage === "render" && pct % 10 === 0 && pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`  ${pct}%\n`);
      }
    },
  });
  const checks = await validateVideo(out, r.probe, { width: Math.round(spec.width * scale), height: Math.round(spec.height * scale), durationSec: spec.duration, maxFileSizeBytes: 250 * 1024 * 1024, requireAudio: false }, { deepIntegrity: true });
  for (const c of checks) process.stdout.write(`  ${c.status === "pass" ? "✔" : c.status === "warn" ? "!" : "✖"} ${c.message}\n`);
  process.stdout.write(`Done in ${(r.renderMs / 1000).toFixed(1)}s — ${(r.probe.fileSize / 1e6).toFixed(2)} MB\n`);
  if (checks.some((c) => c.status === "fail")) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write(`Render failed: ${serializeError(e).message}\n`);
  process.exitCode = 1;
});
