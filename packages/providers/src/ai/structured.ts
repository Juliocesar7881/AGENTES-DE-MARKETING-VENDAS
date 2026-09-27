import type { z } from "zod";
import { formatZodIssues } from "@revenueos/shared";

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; problems: string };

/** Extracts a JSON object from model text. With native structured outputs the text is already pure JSON. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fallback for prompt-mode providers: take the outermost JSON object.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1]! : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
    return JSON.parse(candidate);
  }
}

export function parseStructured<T>(text: string, schema: z.ZodType<T>, validate?: (v: T) => string[]): ParseOutcome<T> {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    return { ok: false, problems: "- (root): the response was not valid JSON" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: formatZodIssues(parsed.error) };
  const extra = validate?.(parsed.data) ?? [];
  if (extra.length > 0) return { ok: false, problems: extra.map((p) => `- ${p}`).join("\n") };
  return { ok: true, value: parsed.data };
}

export function repairInstruction(problems: string): string {
  return [
    "Your previous JSON did not pass validation. Fix ONLY these problems and return the complete corrected JSON object.",
    "Do not add commentary.",
    "Problems:",
    problems,
  ].join("\n");
}
