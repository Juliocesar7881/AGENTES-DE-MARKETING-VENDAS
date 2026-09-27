import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";

const here = dirname(fileURLToPath(import.meta.url));
export const ENGINE_ROOT = resolve(here, "..", "..");
export const ENTRY_POINT = join(ENGINE_ROOT, "src", "remotion", "index.ts");
export const PUBLIC_DIR = join(ENGINE_ROOT, "public");

async function hashTree(dirs: string[]): Promise<string> {
  const h = createHash("sha256");
  async function walk(dir: string): Promise<void> {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "render") continue;
        await walk(p);
      } else {
        const s = await stat(p);
        h.update(`${p}:${s.size}:${s.mtimeMs}`);
      }
    }
  }
  for (const d of dirs) await walk(d);
  return h.digest("hex").slice(0, 16);
}

let inflight: Promise<string> | null = null;
let current: { hash: string; serveUrl: string } | null = null;

/**
 * Bundles the Remotion project once and reuses it until sources change
 * (hash of engine + shared sources). Returns the local serve URL/directory.
 */
export async function getBundle(opts: { cacheDir: string; extraEntryDirs?: string[]; onProgress?: (p: number) => void }): Promise<string> {
  const sharedDir = resolve(ENGINE_ROOT, "..", "shared", "src");
  const dirs = [join(ENGINE_ROOT, "src"), PUBLIC_DIR, sharedDir, ...(opts.extraEntryDirs ?? [])];
  const hash = await hashTree(dirs);
  if (current?.hash === hash && existsSync(current.serveUrl)) return current.serveUrl;
  if (inflight) return inflight;
  inflight = (async () => {
    const outDir = join(opts.cacheDir, `bundle-${hash}`);
    if (existsSync(join(outDir, "index.html"))) {
      current = { hash, serveUrl: outDir };
      return outDir;
    }
    await mkdir(opts.cacheDir, { recursive: true });
    const serveUrl = await bundle({
      entryPoint: ENTRY_POINT,
      publicDir: PUBLIC_DIR,
      outDir,
      onProgress: (p) => opts.onProgress?.(p),
      enableCaching: true,
    });
    await writeFile(join(outDir, ".revenueos-bundle"), hash);
    // keep the cache small: remove older bundles
    for (const e of await readdir(opts.cacheDir)) {
      if (e.startsWith("bundle-") && e !== `bundle-${hash}`) await rm(join(opts.cacheDir, e), { recursive: true, force: true });
    }
    current = { hash, serveUrl };
    return serveUrl;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
