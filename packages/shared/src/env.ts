import { accessSync, constants as fsConstants, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * RevenueOS keeps ONE .env at the repository root, shared by the dashboard,
 * the worker and the scripts. This loader finds it (walking up to the folder
 * with pnpm-workspace.yaml) and fills only variables that are not already set (an
 * explicitly empty variable counts as set, so it can disable a .env value),
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
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(["\\])/g, "$1");
    else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]!] = v;
  }
  return out;
}

/**
 * The configuration file this installation uses: REVENUEOS_ENV_FILE when set
 * (tests, custom layouts), otherwise <repository root>/.env.
 */
export function envFilePath(): string | null {
  if (process.env.REVENUEOS_ENV_FILE) return resolve(/*turbopackIgnore: true*/ process.env.REVENUEOS_ENV_FILE);
  const root = findRepoRoot();
  return root ? join(/*turbopackIgnore: true*/ root, ".env") : null;
}

/** Loads the env file (and <root>/.env.local) into process.env without overriding existing values. */
export function ensureRootEnv(): void {
  const main = envFilePath();
  const root = findRepoRoot();
  const files = process.env.REVENUEOS_ENV_FILE ? [main] : [root ? join(/*turbopackIgnore: true*/ root, ".env.local") : null, main];
  for (const p of files) {
    if (!p || !existsSync(/*turbopackIgnore: true*/ p)) continue;
    try {
      for (const [k, v] of Object.entries(parseDotEnv(readFileSync(/*turbopackIgnore: true*/ p, "utf8")))) {
        if (process.env[k] === undefined) process.env[k] = v;
      }
    } catch {
      /* unreadable env file: ignore */
    }
  }
}

function formatEnvValue(v: string): string {
  if (/[\s#"'\\]/.test(v)) return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return v;
}

/**
 * Sets keys in the env file, keeping every other line (comments included).
 * Creates the file from .env.example when missing. Written atomically with
 * owner-only permissions. Also applies the values to process.env.
 */
export function updateEnvFile(values: Record<string, string>): string {
  const path = envFilePath();
  if (!path) throw new Error("Cannot locate the configuration file (.env).");
  let text = "";
  if (existsSync(/*turbopackIgnore: true*/ path)) text = readFileSync(/*turbopackIgnore: true*/ path, "utf8");
  else {
    const root = findRepoRoot();
    const example = root ? join(/*turbopackIgnore: true*/ root, ".env.example") : null;
    if (example && existsSync(/*turbopackIgnore: true*/ example)) text = readFileSync(/*turbopackIgnore: true*/ example, "utf8");
  }
  const appended: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) throw new Error(`Invalid variable name ${k}`);
    if (/[\r\n]/.test(v)) throw new Error(`Invalid value for ${k}`);
    const line = `${k}=${formatEnvValue(v)}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, () => line);
    else appended.push(line);
    process.env[k] = v;
  }
  if (appended.length) text = `${text.replace(/\s*$/, "")}\n\n# ── Set by the RevenueOS installer ──\n${appended.join("\n")}\n`;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(/*turbopackIgnore: true*/ tmp, text, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
  return path;
}

/** True when the env file can be written (false on read-only/serverless hosts). */
export function envFileWritable(): boolean {
  if (process.env.VERCEL) return false;
  const path = envFilePath();
  if (!path) return false;
  try {
    accessSync(existsSync(/*turbopackIgnore: true*/ path) ? path : dirname(path), fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Reads an env var, loading the root .env first if it is missing. */
export function env(name: string): string | undefined {
  if (!process.env[name]) ensureRootEnv();
  return process.env[name] || undefined;
}
