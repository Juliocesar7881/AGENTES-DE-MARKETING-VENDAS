import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { env } from "@revenueos/shared/server";
import { SAMPLE_SPEC } from "../sample";
import { PUBLIC_DIR } from "./bundle";

/**
 * Render test for a candidate composition: bundles it in its own sandbox dir
 * (aliases restrict what it can import) and renders 3 stills with timeouts.
 */
export async function renderCompositionTest(dir: string, opts: { browserExecutable?: string | null; timeoutMs?: number } = {}): Promise<{ ok: boolean; message: string; frames: number }> {
  const require = createRequire(import.meta.url);
  const componentsPath = fileURLToPath(new URL("../components/index.ts", import.meta.url));
  const entry = join(dir, "entry.tsx");
  await writeFile(
    entry,
    `import { Composition, registerRoot } from "remotion";
import Candidate from "./Composition";
const spec = ${JSON.stringify(SAMPLE_SPEC)};
registerRoot(() => <Composition id="Candidate" component={Candidate as any} width={1080} height={1920} fps={30} durationInFrames={120} defaultProps={{ spec, assets: {} }} />);
`,
    "utf8",
  );
  const serveUrl = await bundle({
    entryPoint: entry,
    publicDir: PUBLIC_DIR,
    outDir: join(dir, "bundle"),
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...(config.resolve?.alias as Record<string, string>),
          "@revenueos/video-engine/components": componentsPath,
          react: dirname(require.resolve("react/package.json")),
          remotion: dirname(require.resolve("remotion/package.json")),
        },
      },
    }),
  });
  const browserExecutable = opts.browserExecutable ?? env("REMOTION_BROWSER_EXECUTABLE") ?? null;
  const composition = await selectComposition({ serveUrl, id: "Candidate", inputProps: { spec: SAMPLE_SPEC, assets: {} }, browserExecutable, timeoutInMilliseconds: opts.timeoutMs ?? 30_000, logLevel: "error" });
  let frames = 0;
  for (const frame of [0, 60, 119]) {
    await renderStill({ composition, serveUrl, frame, output: join(dir, `still-${frame}.jpeg`), imageFormat: "jpeg", scale: 0.25, inputProps: { spec: SAMPLE_SPEC, assets: {} }, browserExecutable, timeoutInMilliseconds: opts.timeoutMs ?? 30_000, logLevel: "error" });
    frames++;
  }
  return { ok: true, message: `Rendered ${frames} test frames without errors`, frames };
}
