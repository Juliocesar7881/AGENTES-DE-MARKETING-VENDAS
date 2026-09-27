import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, toLlmJsonSchema } from "@revenueos/shared";
import { addUsage, estimateCostUsd, ZERO_USAGE } from "./pricing";
import { parseStructured, repairInstruction } from "./structured";
import type { AIHealth, AIProvider, AIProviderOptions, ModelInfo, StructuredRequest, StructuredResult, TokenUsage } from "./types";

/**
 * OfficialClaudeLocalProvider — uses the official Claude Code CLI in headless
 * print mode (`claude -p --output-format json`), authenticated however the local
 * CLI is authenticated (API key or the user's own Claude login). No browser
 * automation, no cookies, no private endpoints: only the documented CLI flags.
 * All built-in tools are disabled (`--tools ""`), so the model can only answer.
 * Available on the local worker only.
 */
export class ClaudeCodeCLIProvider implements AIProvider {
  readonly id = "claude-code-cli" as const;
  readonly isMock = false;
  constructor(
    private readonly cliPath: string = process.env.CLAUDE_CLI_PATH || "claude",
    private readonly opts: AIProviderOptions = {},
  ) {
    if (/\.(cmd|bat)$/i.test(cliPath)) {
      throw new AppError({
        code: "AI_CLI_UNSUPPORTED_PATH",
        userMessage: "Point CLAUDE_CLI_PATH to claude.exe (native installer) or to the CLI's .js entry file, not a .cmd shim.",
      });
    }
  }

  private run(args: string[], stdin: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      const isJs = /\.(c|m)?js$/i.test(this.cliPath);
      const cmd = isJs ? process.execPath : this.cliPath;
      const finalArgs = isJs ? [this.cliPath, ...args] : args;
      const child = spawn(cmd, finalArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
        env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new AppError({ code: "AI_TIMEOUT", userMessage: "Claude Code CLI timed out.", retryable: true }));
      }, timeoutMs);
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(
          new AppError({
            code: "AI_CLI_NOT_FOUND",
            userMessage: "Claude Code CLI was not found on this machine. Install it or set CLAUDE_CLI_PATH in the worker settings.",
            message: e.message,
          }),
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
      child.stdin.end(stdin, "utf8");
    });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();
    const dir = await mkdtemp(join(tmpdir(), "revenueos-claude-"));
    const schema = JSON.stringify(toLlmJsonSchema(req.schema));
    const systemFile = join(dir, "system.md");
    await writeFile(
      systemFile,
      [...req.system.map((b) => b.text), `Return ONLY one JSON object that validates against this JSON Schema:\n${schema}`].join("\n\n"),
      "utf8",
    );
    let usage: TokenUsage = { ...ZERO_USAGE };
    let reportedCost = 0;
    let transcript = req.messages.map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}:\n${m.content}`).join("\n\n");
    let lastProblems = "";
    try {
      for (let attempt = 1; attempt <= (req.maxRepairs ?? 1) + 1; attempt++) {
        const args = [
          "-p",
          "--output-format",
          "json",
          "--model",
          req.model,
          "--system-prompt-file",
          systemFile,
          "--tools",
          "",
          "--no-session-persistence",
          "--strict-mcp-config",
        ];
        const { stdout, stderr, code } = await this.run(args, transcript, req.timeoutMs ?? this.opts.timeoutMs ?? 300_000);
        let envelope: {
          result?: string;
          is_error?: boolean;
          structured_output?: unknown;
          total_cost_usd?: number;
          usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
        };
        try {
          envelope = JSON.parse(stdout);
        } catch {
          throw new AppError({
            code: "AI_CLI_OUTPUT",
            userMessage: "Claude Code CLI returned an unexpected response. Make sure you are logged in (`claude` → /login).",
            details: { code, stderr: stderr.slice(0, 2000) },
            retryable: true,
          });
        }
        if (envelope.is_error) {
          throw new AppError({
            code: "AI_CLI_ERROR",
            userMessage: "Claude Code CLI reported an error. Check the local login/subscription and the model name.",
            details: { result: envelope.result?.slice(0, 2000) },
            retryable: true,
          });
        }
        usage = addUsage(usage, {
          inputTokens: envelope.usage?.input_tokens ?? 0,
          outputTokens: envelope.usage?.output_tokens ?? 0,
          cacheReadTokens: envelope.usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: envelope.usage?.cache_creation_input_tokens ?? 0,
        });
        reportedCost += envelope.total_cost_usd ?? 0;
        const text = envelope.structured_output != null ? JSON.stringify(envelope.structured_output) : (envelope.result ?? "");
        const outcome = parseStructured(text, req.schema, req.validate);
        if (outcome.ok) {
          const est = estimateCostUsd(req.model, usage, this.opts.prices);
          return {
            data: outcome.value,
            usage,
            model: req.model,
            provider: this.id,
            costUsd: reportedCost > 0 ? reportedCost : est.costUsd,
            priceKnown: reportedCost > 0 || est.priceKnown,
            durationMs: Date.now() - started,
            attempts: attempt,
            stopReason: null,
          };
        }
        lastProblems = outcome.problems;
        transcript += `\n\nASSISTANT:\n${text}\n\nUSER:\n${repairInstruction(lastProblems)}`;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    throw new AppError({
      code: "AI_INVALID_OUTPUT",
      userMessage: "Claude returned output that did not pass validation after a repair attempt.",
      details: { problems: lastProblems },
      retryable: true,
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: "opus" }, { id: "sonnet" }, { id: "haiku" }, { id: "fable" }];
  }

  async healthCheck(): Promise<AIHealth> {
    try {
      const { stdout, code } = await this.run(["--version"], "", 20_000);
      return code === 0
        ? { ok: true, provider: this.id, message: `Claude Code CLI found (${stdout.trim()}).` }
        : { ok: false, provider: this.id, message: "Claude Code CLI did not run correctly." };
    } catch (e) {
      return { ok: false, provider: this.id, message: e instanceof AppError ? e.userMessage : String(e) };
    }
  }
}
