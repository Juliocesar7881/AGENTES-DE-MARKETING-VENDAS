import { AppError, formatZodIssues } from "@revenueos/shared";
import { estimateCostUsd, estimateTokens } from "./pricing";
import type { AIHealth, AIProvider, AIProviderOptions, ModelInfo, StructuredRequest, StructuredResult } from "./types";

export interface MockAIOptions extends AIProviderOptions {
  /** Simulated latency in ms (keeps demo realistic without slowing tests). */
  latencyMs?: number;
  /** Failure injection for tests: throw on the Nth call, or always with "timeout". */
  failWith?: "timeout" | "invalid" | null;
}

/**
 * MockAIProvider — used ONLY for DEMO workspaces and tests, never as a silent
 * fallback in LIVE mode. Each agent supplies a deterministic `mock()` generator;
 * the output is still validated against the same Zod schema as real Claude output.
 * Token usage is estimated so the demo can show what the run *would* cost.
 */
export class MockAIProvider implements AIProvider {
  readonly id = "mock" as const;
  readonly isMock = true;
  calls = 0;
  constructor(private readonly opts: MockAIOptions = {}) {}

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls++;
    const started = Date.now();
    if (this.opts.failWith === "timeout") {
      throw new AppError({ code: "AI_TIMEOUT", userMessage: "Claude took too long to respond (simulated). The job will retry.", retryable: true });
    }
    if (!req.mock) {
      throw new AppError({ code: "AI_MOCK_MISSING", userMessage: `No demo generator for task ${req.task}.` });
    }
    if (this.opts.latencyMs) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    const value = this.opts.failWith === "invalid" ? ({} as T) : req.mock();
    const parsed = req.schema.safeParse(value);
    if (!parsed.success) {
      throw new AppError({
        code: "AI_INVALID_OUTPUT",
        userMessage: "The demo generator produced invalid output.",
        details: { problems: formatZodIssues(parsed.error) },
        retryable: false,
      });
    }
    const extra = req.validate?.(parsed.data) ?? [];
    if (extra.length > 0) {
      throw new AppError({ code: "AI_INVALID_OUTPUT", userMessage: "The demo generator violated a validation rule.", details: { problems: extra } });
    }
    const inputText = req.system.map((s) => s.text).join("\n") + req.messages.map((m) => m.content).join("\n");
    const usage = {
      inputTokens: estimateTokens(inputText),
      outputTokens: estimateTokens(JSON.stringify(parsed.data)),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    const { costUsd } = estimateCostUsd(req.model, usage, this.opts.prices);
    return {
      data: parsed.data,
      usage,
      model: req.model,
      provider: this.id,
      costUsd,
      priceKnown: true,
      durationMs: Date.now() - started,
      attempts: 1,
      stopReason: "end_turn",
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: "claude-opus-5", displayName: "Claude Opus 5 (mock)" }, { id: "claude-sonnet-5" }, { id: "claude-haiku-4-5" }];
  }

  async healthCheck(): Promise<AIHealth> {
    return { ok: true, provider: this.id, message: "Mock AI (DEMO/TEST only) — no real Claude calls are made." };
  }
}
