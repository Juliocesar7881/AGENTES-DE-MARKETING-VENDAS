import { z } from "zod";

/**
 * Converts a Zod schema into the JSON Schema subset accepted by structured
 * outputs (and understandable by any LLM when embedded in a prompt).
 * Unsupported keywords (numeric/string/array length constraints, defaults,
 * patterns) are stripped here and enforced client-side by Zod instead.
 */
const STRIP_KEYS = new Set([
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "pattern",
  "default",
  "$schema",
  "format",
  "minProperties",
  "maxProperties",
  "propertyNames",
]);

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function clean(node: Json): Json {
  if (Array.isArray(node)) return node.map(clean);
  if (node && typeof node === "object") {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(node)) {
      if (STRIP_KEYS.has(k)) continue;
      out[k] = clean(v as Json);
    }
    if (out.type === "object" || out.properties) {
      out.additionalProperties = false;
      if (!out.properties) out.properties = {};
    }
    return out;
  }
  return node;
}

export function toLlmJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { io: "input", unrepresentable: "any", target: "draft-2020-12" }) as Json;
  return clean(raw) as Record<string, unknown>;
}

/** Compact human-readable list of Zod issues, for repair prompts and UI. */
export function formatZodIssues(error: z.ZodError, max = 12): string {
  return error.issues
    .slice(0, max)
    .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}
