import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
};

export interface AssetServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Ephemeral static server bound to 127.0.0.1 that exposes ONE directory to the
 * headless browser during a render. Path traversal is rejected; only known
 * media types are served.
 */
export async function startAssetServer(rootDir: string): Promise<AssetServer> {
  const root = resolve(rootDir);
  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const full = resolve(root, rel);
      const ext = extname(full).toLowerCase();
      if (!full.startsWith(root + sep) || !MIME[ext]) {
        res.writeHead(404).end();
        return;
      }
      const s = await stat(full);
      res.writeHead(200, {
        "content-type": MIME[ext]!,
        "content-length": s.size,
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(ext === ".svg" ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } : {}),
      });
      createReadStream(full).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
