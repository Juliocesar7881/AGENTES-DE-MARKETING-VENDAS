#!/usr/bin/env node
/** `pnpm dev`: runs the dashboard (Next.js) and the local worker together with prefixed output. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const next = [join(root, "apps", "web", "node_modules", "next", "dist", "bin", "next"), join(root, "node_modules", "next", "dist", "bin", "next")].find(existsSync);
const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!next || !existsSync(tsx)) {
  console.error("Dependencies are missing — run: pnpm install && pnpm setup");
  process.exit(1);
}
if (!existsSync(join(root, ".env"))) {
  console.error("No .env found — run: pnpm setup");
  process.exit(1);
}

const procs = [
  { name: "web", color: "\x1b[35m", args: [next, "dev", "--port", process.env.PORT ?? "3000"], cwd: join(root, "apps", "web") },
  { name: "worker", color: "\x1b[36m", args: [tsx, "watch", "--clear-screen=false", join(root, "apps", "worker", "src", "index.ts"), "--no-tray"], cwd: root },
];

const children = procs.map((p) => {
  const child = spawn(process.execPath, p.args, { cwd: p.cwd, env: { ...process.env, FORCE_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = `${p.color}[${p.name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) out.write(prefix + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 3000).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
