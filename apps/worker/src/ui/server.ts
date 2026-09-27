import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { db as coreDb } from "@revenueos/core";
import { eq, isUuid, videoRenders } from "@revenueos/database";
import { createLogger } from "@revenueos/shared";
import { configDir, UI_TOKEN, type WorkerConfig } from "../config";
import { tailLogs } from "../logs";
import { setStartup, type startupStatus } from "../startup";
import { renderPanel } from "./page";

const log = createLogger({ component: "local-panel" });

export interface PanelStatus {
  workerId: string;
  name: string;
  version: string;
  online: boolean;
  paused: boolean;
  databaseOk: boolean;
  pending: number;
  rendering: number;
  renderedToday: number;
  failedToday: number;
  currentJobs: { id: string; type: string; startedAt: string }[];
  lastHeartbeatAt: string | null;
  lastError: string | null;
  config: WorkerConfig;
  health: unknown;
  startup: ReturnType<typeof startupStatus>;
}

export interface PanelController {
  status(): Promise<PanelStatus>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  updateSettings(patch: Partial<WorkerConfig>): Promise<WorkerConfig>;
  shutdown(): void;
  config(): WorkerConfig;
}

export const RUNTIME_FILE = join(configDir(), "worker.runtime.json");

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers,
  });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

/** Opens a folder or URL with the OS default handler (args array — never a shell string). */
export function openExternal(target: string): void {
  const cmd = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  try {
    const child = spawn(cmd, [target], { detached: true, stdio: "ignore", windowsHide: false });
    child.on("error", (e) => log.warn("could not open", { target, error: e.message }));
    child.unref();
  } catch (e) {
    log.warn("could not open", { target, error: e instanceof Error ? e.message : String(e) });
  }
}

function tokenOk(req: IncomingMessage): boolean {
  const given = Buffer.from(String(req.headers["x-worker-token"] ?? ""));
  const expected = Buffer.from(UI_TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Local control panel on 127.0.0.1. Protections: binds to loopback only,
 * validates Host (blocks DNS rebinding), requires a per-process token for every
 * action (so other websites cannot drive it), and only serves render files
 * registered in the database that live inside the render folder.
 */
export async function startPanel(ctrl: PanelController): Promise<{ server: Server; url: string }> {
  const cfg = ctrl.config();
  let port = cfg.uiPort;
  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const server = createServer(async (req, res) => {
    try {
      const host = String(req.headers.host ?? "");
      if (!allowedHosts().has(host)) return send(res, 421, { error: "invalid host" });
      const url = new URL(req.url ?? "/", `http://${host}`);
      const origin = req.headers.origin ? String(req.headers.origin) : null;
      const selfOrigin = `http://${host}`;
      const dashboardOrigin = originOf(ctrl.config().dashboardUrl);

      // Render files for the dashboard's preview player (only when viewing on this same computer).
      if (req.method === "GET" && url.pathname.startsWith("/renders/")) {
        const id = url.pathname.slice("/renders/".length);
        if (!isUuid(id)) return send(res, 404, { error: "not found" });
        const [r] = await coreDb().select({ localPath: videoRenders.localPath, localDeletedAt: videoRenders.localDeletedAt }).from(videoRenders).where(eq(videoRenders.id, id)).limit(1);
        const root = resolve(ctrl.config().renderDir) + sep;
        const file = r?.localPath ? resolve(r.localPath) : null;
        if (!file || r?.localDeletedAt || !file.startsWith(root) || !existsSync(file)) return send(res, 404, { error: "not found" });
        const size = statSync(file).size;
        const cors: Record<string, string> = dashboardOrigin ? { "access-control-allow-origin": dashboardOrigin, vary: "Origin" } : {};
        const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
        if (range) {
          const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          if (start >= size || start > end) return send(res, 416, { error: "range" }, { "content-range": `bytes */${size}` });
          res.writeHead(206, { ...cors, "content-type": "video/mp4", "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1), "cache-control": "private, max-age=300" });
          createReadStream(file, { start, end }).pipe(res);
          return;
        }
        res.writeHead(200, { ...cors, "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": String(size), "cache-control": "private, max-age=300" });
        createReadStream(file).pipe(res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        return send(res, 200, renderPanel(UI_TOKEN), { "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'", "x-frame-options": "DENY" });
      }
      if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });

      if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });
      if (origin && origin !== selfOrigin) return send(res, 403, { error: "cross-origin requests are not allowed" });
      if (!tokenOk(req)) return send(res, 401, { error: "missing or invalid token" });

      if (req.method === "GET" && url.pathname === "/api/status") return send(res, 200, await ctrl.status());
      if (req.method === "GET" && url.pathname === "/api/logs") return send(res, 200, { lines: tailLogs(Math.min(1000, Number(url.searchParams.get("lines") ?? 300))) });
      if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });

      switch (url.pathname) {
        case "/api/pause":
          await ctrl.pause();
          return send(res, 200, { ok: true });
        case "/api/resume":
          await ctrl.resume();
          return send(res, 200, { ok: true });
        case "/api/open-folder": {
          const dir = ctrl.config().renderDir;
          mkdirSync(dir, { recursive: true });
          openExternal(dir);
          return send(res, 200, { ok: true });
        }
        case "/api/open-dashboard": {
          const target = ctrl.config().dashboardUrl;
          if (!/^https?:\/\//i.test(target)) return send(res, 400, { error: "dashboard URL must be http(s)" });
          openExternal(target);
          return send(res, 200, { ok: true });
        }
        case "/api/settings": {
          const body = await readJson(req);
          const patch: Partial<WorkerConfig> = {};
          if (typeof body.renderDir === "string" && body.renderDir.trim()) patch.renderDir = resolve(body.renderDir.trim());
          if (body.renderConcurrency !== undefined) patch.renderConcurrency = Number(body.renderConcurrency);
          if (body.aiConcurrency !== undefined) patch.aiConcurrency = Number(body.aiConcurrency);
          if (typeof body.dashboardUrl === "string" && /^https?:\/\//i.test(body.dashboardUrl)) patch.dashboardUrl = body.dashboardUrl.replace(/\/$/, "");
          if (typeof body.uploadPreviews === "boolean") patch.uploadPreviews = body.uploadPreviews;
          if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
          return send(res, 200, await ctrl.updateSettings(patch));
        }
        case "/api/startup": {
          const body = await readJson(req);
          return send(res, 200, setStartup(Boolean(body.enabled)));
        }
        case "/api/shutdown":
          send(res, 200, { ok: true });
          setTimeout(() => ctrl.shutdown(), 100);
          return;
        default:
          return send(res, 404, { error: "not found" });
      }
    } catch (e) {
      log.error("panel request failed", { error: e instanceof Error ? e.message : String(e) });
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    }
  });

  // Try the configured port, then the next few (another worker or app may hold it).
  for (let attempt = 0; attempt < 10; attempt++) {
    const ok = await new Promise<boolean>((resolveListen) => {
      server.once("error", () => resolveListen(false));
      server.listen(port, "127.0.0.1", () => resolveListen(true));
    });
    if (ok) break;
    port++;
  }
  if (!server.listening) throw new Error(`Could not start the local panel on ports ${cfg.uiPort}-${port}`);
  const url = `http://127.0.0.1:${port}`;
  writeRuntimeFile({ url, port, token: UI_TOKEN, pid: process.pid });
  return { server, url };
}

/** Lets the Windows tray icon talk to this process. User-profile file, owner-only permissions. */
function writeRuntimeFile(data: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(RUNTIME_FILE), { recursive: true });
    writeFileSync(RUNTIME_FILE, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
  } catch (e) {
    log.warn("could not write runtime file", { error: e instanceof Error ? e.message : String(e) });
  }
}

export function removeRuntimeFile(): void {
  rmSync(RUNTIME_FILE, { force: true });
}
