import Anthropic from "@anthropic-ai/sdk";
import { AppError, toLlmJsonSchema } from "@revenueos/shared";
import { addUsage, estimateCostUsd, ZERO_USAGE } from "./pricing";
import { parseStructured, repairInstruction } from "./structured";
import type { AIHealth, AIProvider, AIProviderOptions, ModelInfo, StructuredRequest, StructuredResult, TokenUsage } from "./types";

/**
 * Official Anthropic API provider (TypeScript SDK).
 * - Structured outputs via `output_config.format` (JSON schema) + Zod validation
 *   with a bounded repair loop.
 * - Prompt caching on stable system blocks (`cache_control: ephemeral`).
 * - Streaming + finalMessage() to avoid HTTP timeouts on long generations.
 */
export class AnthropicAPIProvider implements AIProvider {
  readonly id = "anthropic" as const;
  readonly isMock = false;
  private client: Anthropic;
  private opts: AIProviderOptions;

  constructor(apiKey: string, opts: AIProviderOptions & { baseURL?: string } = {}) {
    if (!apiKey) {
      throw new AppError({
        code: "AI_NOT_CONFIGURED",
        userMessage: "Claude is not connected. Add your Anthropic API key in Settings → AI.",
      });
    }
    this.opts = opts;
    this.client = new Anthropic({ apiKey, baseURL: opts.baseURL, timeout: opts.timeoutMs ?? 180_000, maxRetries: 2 });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();
    const caching = this.opts.promptCaching !== false;
    const system: Anthropic.TextBlockParam[] = req.system.map((b) => ({
      type: "text",
      text: b.text,
      ...(caching && b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
    const schema = toLlmJsonSchema(req.schema);
    const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
    let usage: TokenUsage = { ...ZERO_USAGE };
    let useNativeFormat = true;
    const maxRepairs = req.maxRepairs ?? 1;
    let lastProblems = "";
    let stopReason: string | null = null;

    for (let attempt = 1; attempt <= maxRepairs + 1; attempt++) {
      let msg: Anthropic.Message;
      try {
        const params: Anthropic.MessageCreateParamsNonStreaming = {
          model: req.model,
          max_tokens: req.maxTokens,
          system,
          messages,
          ...(useNativeFormat || req.effort
            ? {
                output_config: {
                  ...(useNativeFormat ? { format: { type: "json_schema" as const, schema } } : {}),
                  ...(req.effort ? { effort: req.effort } : {}),
                },
              }
            : {}),
        };
        if (!useNativeFormat) {
          params.system = [
            ...system,
            { type: "text", text: `Respond with a single JSON object matching this JSON Schema (no prose):\n${JSON.stringify(schema)}` },
          ];
        }
        msg = await this.client.messages.stream(params, { timeout: req.timeoutMs ?? this.opts.timeoutMs ?? 180_000 }).finalMessage();
      } catch (e) {
        if (useNativeFormat && e instanceof Anthropic.BadRequestError && /output_config|json_schema|format/i.test(e.message)) {
          // Model without structured-output support: fall back to schema-in-prompt + Zod validation.
          useNativeFormat = false;
          attempt--;
          continue;
        }
        throw mapAnthropicError(e);
      }
      usage = addUsage(usage, {
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
      });
      stopReason = msg.stop_reason;
      if (msg.stop_reason === "refusal") {
        throw new AppError({
          code: "AI_REFUSAL",
          userMessage: "Claude declined to generate this content. Review the brief, brand rules or product description.",
          details: { stopDetails: (msg as unknown as { stop_details?: unknown }).stop_details ?? null },
        });
      }
      const text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (msg.stop_reason === "max_tokens") {
        lastProblems = "- (root): output was cut off by max_tokens; produce a more concise response";
      } else {
        const outcome = parseStructured(text, req.schema, req.validate);
        if (outcome.ok) {
          const { costUsd, priceKnown } = estimateCostUsd(req.model, usage, this.opts.prices);
          return {
            data: outcome.value,
            usage,
            model: msg.model ?? req.model,
            provider: this.id,
            costUsd,
            priceKnown,
            durationMs: Date.now() - started,
            attempts: attempt,
            stopReason,
          };
        }
        lastProblems = outcome.problems;
      }
      messages.push({ role: "assistant", content: msg.content });
      messages.push({ role: "user", content: repairInstruction(lastProblems) });
    }
    throw new AppError({
      code: "AI_INVALID_OUTPUT",
      userMessage: "Claude returned output that did not pass validation after a repair attempt. The job will be retried.",
      details: { problems: lastProblems, stopReason },
      retryable: true,
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    try {
      for await (const m of this.client.models.list({ limit: 100 })) {
        out.push({ id: m.id, displayName: m.display_name });
      }
    } catch (e) {
      throw mapAnthropicError(e);
    }
    return out;
  }

  async healthCheck(model?: string): Promise<AIHealth> {
    try {
      const models = await this.listModels();
      const found = model ? models.some((m) => m.id === model) : true;
      return {
        ok: true,
        provider: this.id,
        message: found ? `Authenticated. ${models.length} models available.` : `Authenticated, but model "${model}" was not listed for this key.`,
        details: { models: models.map((m) => m.id) },
      };
    } catch (e) {
      const err = e instanceof AppError ? e : mapAnthropicError(e);
      return { ok: false, provider: this.id, message: err.userMessage };
    }
  }
}

export function mapAnthropicError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Anthropic.AuthenticationError) {
    return new AppError({ code: "AI_AUTH", userMessage: "Anthropic rejected the API key. Update it in Settings → AI.", httpStatus: 401, cause: e });
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new AppError({ code: "AI_PERMISSION", userMessage: "This Anthropic key is not allowed to use the selected model.", httpStatus: 403, cause: e });
  }
  if (e instanceof Anthropic.NotFoundError) {
    return new AppError({ code: "AI_MODEL_NOT_FOUND", userMessage: "The configured Claude model does not exist for this key. Pick another model in Settings → AI.", httpStatus: 404, cause: e });
  }
  if (e instanceof Anthropic.RateLimitError) {
    const ra = Number(e.headers?.get?.("retry-after") ?? NaN);
    return new AppError({
      code: "AI_RATE_LIMIT",
      userMessage: "Anthropic rate limit reached. The job will retry automatically.",
      retryable: true,
      retryAfterSec: Number.isFinite(ra) ? ra : 60,
      httpStatus: 429,
      cause: e,
    });
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new AppError({ code: "AI_TIMEOUT", userMessage: "Claude took too long to respond. The job will retry automatically.", retryable: true, cause: e });
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new AppError({ code: "AI_NETWORK", userMessage: "Could not reach the Anthropic API. Check the internet connection.", retryable: true, cause: e });
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new AppError({ code: "AI_BAD_REQUEST", userMessage: "Anthropic rejected the request. See details.", message: e.message, httpStatus: 400, cause: e });
  }
  if (e instanceof Anthropic.APIError) {
    return new AppError({
      code: "AI_API_ERROR",
      userMessage: `Anthropic API error (${e.status ?? "unknown"}). The job will retry.`,
      message: e.message,
      retryable: (e.status ?? 500) >= 500,
      cause: e,
    });
  }
  return new AppError({
    code: "AI_UNEXPECTED",
    userMessage: "Unexpected error while calling Claude.",
    message: e instanceof Error ? e.message : String(e),
    retryable: true,
    cause: e,
  });
}
