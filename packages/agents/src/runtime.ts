import type { AgentRole, ModelConfig } from "@revenueos/shared";
import type { AIProvider, ChatMessage, StructuredResult, SystemBlock } from "@revenueos/providers/ai";
import type { z } from "zod";

export interface AgentRuntime {
  ai: AIProvider;
  model: ModelConfig;
  timeoutMs?: number;
}

export interface AgentResult<T> {
  result: StructuredResult<T>;
  promptVersion: string;
  inputSummary: string;
  task: string;
  agent: AgentRole;
}

export async function runAgent<T>(
  rt: AgentRuntime,
  opts: {
    agent: AgentRole;
    task: string;
    promptVersion: string;
    system: SystemBlock[];
    messages: ChatMessage[];
    schema: z.ZodType<T>;
    schemaName: string;
    inputSummary: string;
    validate?: (v: T) => string[];
    mock: () => T;
    maxRepairs?: number;
  },
): Promise<AgentResult<T>> {
  const result = await rt.ai.generateStructured<T>({
    agent: opts.agent,
    task: opts.task,
    model: rt.model.model,
    system: opts.system,
    messages: opts.messages,
    schema: opts.schema,
    schemaName: opts.schemaName,
    maxTokens: rt.model.maxTokens,
    effort: rt.model.effort === "default" ? undefined : rt.model.effort,
    timeoutMs: rt.timeoutMs,
    validate: opts.validate,
    maxRepairs: opts.maxRepairs ?? 1,
    mock: opts.mock,
  });
  return { result, promptVersion: opts.promptVersion, inputSummary: opts.inputSummary, task: opts.task, agent: opts.agent };
}

/** Case/accent-insensitive search for forbidden words in any text. */
export function findForbidden(texts: (string | undefined | null)[], forbidden: string[]): string[] {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const hay = norm(texts.filter(Boolean).join(" \n "));
  return forbidden.filter((w) => w.trim() && new RegExp(`(^|[^a-z0-9])${norm(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(hay));
}
