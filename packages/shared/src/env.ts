import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * RevenueOS keeps ONE .env at the repository root, shared by the dashboard,
 * the worker and the scripts. This loader finds it (walking up to the folder
 * with pnpm-workspace.yaml) and fills only variables that are not already set,
 * so real environment variables (Vercel, CI, Windows DPAPI launcher) always win.
 * It is called lazily wherever configuration is read, which also survives
 * frameworks that reset process.env during hot reload.
 */
let cachedRoot: string | null | undefined;

export function findRepoRoot(start = process.cwd()): string | null {
  if (cachedRoot !== undefined) return cachedRoot;
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return (cachedRoot = dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return (cachedRoot = null);
}

export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]!] = v;
  }
  return out;
}

/** Loads <root>/.env and <root>/.env.local into process.env without overriding existing values. */
export function ensureRootEnv(): void {
  const root = findRepoRoot();
  if (!root) return;
  for (const file of [".env.local", ".env"]) {
    const p = join(root, file);
    if (!existsSync(p)) continue;
    try {
      for (const [k, v] of Object.entries(parseDotEnv(readFileSync(p, "utf8")))) {
        if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
      }
    } catch {
      /* unreadable env file: ignore */
    }
  }
}

/** Reads an env var, loading the root .env first if it is missing. */
export function env(name: string): string | undefined {
  if (!process.env[name]) ensureRootEnv();
  return process.env[name] || undefined;
}
