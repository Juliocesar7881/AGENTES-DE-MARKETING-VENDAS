import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import ts from "typescript";

/**
 * ADVANCED CREATIVE sandbox. Claude-proposed Remotion compositions are never
 * executed directly. They go through:
 *  1. static analysis (import whitelist, forbidden APIs, size limit)
 *  2. lint rules (determinism, default export)
 *  3. typecheck in an isolated worker thread with memory + time limits
 *  4. a render test in headless Chrome (bounded frames + timeout)
 * Only then can a human approve the composition for use.
 */

export const ALLOWED_IMPORTS = new Set(["react", "remotion", "@revenueos/video-engine/components"]);
const FORBIDDEN_IDENTIFIERS = new Set([
  "process",
  "globalThis",
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "navigator",
  "setTimeout",
  "setInterval",
  "Worker",
  "SharedWorker",
  "importScripts",
  "eval",
  "Function",
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "Buffer",
  "location",
  "opener",
  "parent",
  "top",
  "postMessage",
]);
const MAX_CODE_BYTES = 30_000;

export interface SandboxIssue {
  stage: "static" | "lint" | "typecheck" | "render";
  message: string;
  line?: number;
}

export interface StaticReport {
  ok: boolean;
  issues: SandboxIssue[];
  imports: string[];
}

export function staticAnalyze(code: string): StaticReport {
  const issues: SandboxIssue[] = [];
  const imports: string[] = [];
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) issues.push({ stage: "static", message: `Code exceeds ${MAX_CODE_BYTES} bytes` });
  const sf = ts.createSourceFile("Composition.tsx", code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let hasDefaultExport = false;
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const m = node.moduleSpecifier.text;
      imports.push(m);
      if (!ALLOWED_IMPORTS.has(m)) issues.push({ stage: "static", message: `Import "${m}" is not in the dependency whitelist`, line: lineOf(node) });
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) issues.push({ stage: "static", message: "Re-exports are not allowed", line: lineOf(node) });
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) issues.push({ stage: "static", message: "Dynamic import() is not allowed", line: lineOf(node) });
    if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
      const parent = node.parent;
      const isPropertyName = parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
      const isKey = parent && (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node;
      if (!isPropertyName && !isKey) issues.push({ stage: "static", message: `Use of forbidden API "${node.text}"`, line: lineOf(node) });
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "dangerouslySetInnerHTML") {
      issues.push({ stage: "static", message: "dangerouslySetInnerHTML is not allowed", line: lineOf(node) });
    }
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(sf) === "Math" && node.name.text === "random") {
      issues.push({ stage: "lint", message: "Math.random() breaks deterministic rendering — use random(seed) from remotion", line: lineOf(node) });
    }
    if (ts.isExportAssignment(node)) hasDefaultExport = true;
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) hasDefaultExport = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!hasDefaultExport) issues.push({ stage: "lint", message: "The module must `export default` a React component" });
  const syntax = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  for (const d of syntax) issues.push({ stage: "static", message: `Syntax: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}` });
  return { ok: issues.length === 0, issues, imports };
}

const TYPECHECK_WORKER = `
const { workerData, parentPort } = require("node:worker_threads");
const ts = require(workerData.tsPath);
const options = {
  jsx: ts.JsxEmit.ReactJSX, strict: true, noEmit: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true, esModuleInterop: true, types: [], baseUrl: workerData.dir,
  paths: workerData.paths,
};
const host = ts.createCompilerHost(options);
const program = ts.createProgram([workerData.file], options, host);
const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file && d.file.fileName === workerData.file);
parentPort.postMessage(diags.slice(0, 20).map((d) => ({
  line: d.file ? d.file.getLineAndCharacterOfPosition(d.start || 0).line + 1 : undefined,
  message: ts.flattenDiagnosticMessageText(d.messageText, "\\n"),
})));
`;

export async function typecheckComposition(code: string, workDir: string, timeoutMs = 60_000): Promise<SandboxIssue[]> {
  await mkdir(workDir, { recursive: true });
  const file = join(workDir, "Composition.tsx");
  await writeFile(file, code, "utf8");
  const require = createRequire(import.meta.url);
  const tsPath = require.resolve("typescript");
  const componentsPath = fileURLToPath(new URL("../components/index.ts", import.meta.url));
  const reactTypes = dirname(require.resolve("@types/react/package.json"));
  const remotionDir = dirname(require.resolve("remotion/package.json"));
  const paths: Record<string, string[]> = {
    "@revenueos/video-engine/components": [componentsPath],
    react: [join(reactTypes, "index.d.ts")],
    "react/jsx-runtime": [join(reactTypes, "jsx-runtime.d.ts")],
    remotion: [remotionDir],
  };
  return new Promise((resolve) => {
    const worker = new Worker(TYPECHECK_WORKER, {
      eval: true,
      workerData: { tsPath, file, dir: workDir, paths },
      resourceLimits: { maxOldGenerationSizeMb: 768, maxYoungGenerationSizeMb: 64 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve([{ stage: "typecheck", message: `Typecheck timed out after ${timeoutMs}ms` }]);
    }, timeoutMs);
    worker.on("message", (diags: { line?: number; message: string }[]) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(diags.map((d) => ({ stage: "typecheck" as const, message: d.message, line: d.line })));
    });
    worker.on("error", (e) => {
      clearTimeout(timer);
      resolve([{ stage: "typecheck", message: `Typecheck crashed: ${e.message}` }]);
    });
  });
}

export interface SandboxReport {
  ok: boolean;
  static: StaticReport;
  typecheck: SandboxIssue[];
  render: { ok: boolean; message: string; frames?: number } | null;
  checkedAt: string;
}

/**
 * Full validation pipeline. `renderTest` is injected by the worker (it needs a
 * Remotion bundle with the candidate composition); when omitted the report
 * stops after typecheck and the composition cannot be approved.
 */
export async function validateComposition(
  code: string,
  sandboxRoot: string,
  id: string,
  renderTest?: (dir: string) => Promise<{ ok: boolean; message: string; frames?: number }>,
): Promise<SandboxReport> {
  const dir = join(sandboxRoot, id.replace(/[^a-zA-Z0-9_-]/g, ""));
  const stat = staticAnalyze(code);
  let typecheck: SandboxIssue[] = [];
  let render: SandboxReport["render"] = null;
  try {
    if (stat.ok) typecheck = await typecheckComposition(code, dir);
    if (stat.ok && typecheck.length === 0 && renderTest) {
      render = await renderTest(dir).catch((e: unknown) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    }
  } finally {
    if (!(stat.ok && typecheck.length === 0 && render?.ok)) await rm(dir, { recursive: true, force: true });
  }
  return { ok: stat.ok && typecheck.length === 0 && Boolean(render?.ok), static: stat, typecheck, render, checkedAt: new Date().toISOString() };
}
