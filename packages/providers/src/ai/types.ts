import type { z } from "zod";
import type { AgentRole, AIProviderId, ModelPrice } from "@revenueos/shared";

export interface SystemBlock {
  text: string;
  /** Mark stable, reusable prefixes (system prompt, brand kit, template catalog) for prompt caching. */
  cache?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface StructuredRequest<T> {
  agent: AgentRole;
  /** Short task label, e.g. "strategy.plan". */
  task: string;
  model: string;
  system: SystemBlock[];
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
  /** Additional client-side validation beyond the schema (e.g. brand rules). Return a list of problems. */
  validate?: (value: T) => string[];
  /** Number of repair round-trips allowed when the output is invalid. */
  maxRepairs?: number;
  /** Deterministic generator used ONLY by the MockAIProvider (demo/test). */
  mock?: () => T;
}

export interface StructuredResult<T> {
  data: T;
  usage: TokenUsage;
  model: string;
  provider: AIProviderId;
  costUsd: number;
  priceKnown: boolean;
  durationMs: number;
  attempts: number;
  stopReason: string | null;
}

export interface ModelInfo {
  id: string;
  displayName?: string;
}

export interface AIHealth {
  ok: boolean;
  provider: AIProviderId;
  message: string;
  details?: Record<string, unknown>;
}

export interface AIProvider {
  readonly id: AIProviderId;
  readonly isMock: boolean;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  listModels(): Promise<ModelInfo[]>;
  healthCheck(model?: string): Promise<AIHealth>;
}

export interface AIProviderOptions {
  prices?: Record<string, ModelPrice>;
  timeoutMs?: number;
  promptCaching?: boolean;
}
