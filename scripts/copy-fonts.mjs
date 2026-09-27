#!/usr/bin/env node
// Copies the OFL-licensed @fontsource font files used by the video templates into
// the Remotion public dir (packages/video-engine/public/fonts) and the web app
// (apps/web/public/video-fonts) so renders and previews work fully offline.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = join(root, "packages", "video-engine");
const targets = [join(engineDir, "public", "fonts"), join(root, "apps", "web", "public", "video-fonts")];

const FONTS = {
  inter: [400, 500, 600, 700, 800],
  montserrat: [400, 600, 700, 800],
  poppins: [400, 600, 700, 800],
  "bebas-neue": [400],
  "playfair-display": [400, 600, 700],
  "space-grotesk": [400, 600, 700],
  "dm-sans": [400, 600, 700],
  "archivo-black": [400],
  sora: [400, 600, 700, 800],
  manrope: [400, 600, 700, 800],
};

let require;
try {
  require = createRequire(join(engineDir, "package.json"));
} catch {
  process.exit(0);
}

let copied = 0;
for (const target of targets) mkdirSync(target, { recursive: true });
for (const [pkg, weights] of Object.entries(FONTS)) {
  let pkgDir;
  try {
    pkgDir = dirname(require.resolve(`@fontsource/${pkg}/package.json`));
  } catch {
    continue; // not installed yet (first install pass)
  }
  const filesDir = join(pkgDir, "files");
  if (!existsSync(filesDir)) continue;
  const files = readdirSync(filesDir);
  for (const w of weights) {
    const name = `${pkg}-latin-${w}-normal.woff2`;
    if (!files.includes(name)) continue;
    for (const target of targets) {
      copyFileSync(join(filesDir, name), join(target, name));
    }
    copied++;
  }
}
if (copied > 0) console.info(`[copy-fonts] ${copied} font files ready for Remotion and previews.`);
