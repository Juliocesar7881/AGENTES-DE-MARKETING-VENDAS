import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Minimal .env loader (root .env, then .env.local). Existing env vars win. */
export function loadEnv(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  for (const file of [".env", ".env.local"]) {
    const p = join(root, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1]!;
      let value = m[2]!;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, "");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
