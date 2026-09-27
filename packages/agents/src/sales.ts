import { findUnknownPrices, SalesReplyOutputSchema, type ConversationMemory, type LeadStage, type SalesReplyOutput } from "@revenueos/shared";
import { renderBusinessBlock, type BusinessContext, type ProductContext } from "./context";
import { mockSalesReply } from "./mock/sales";
import { SALES_PROMPT_VERSION, SALES_SYSTEM } from "./prompts/sales.v1";
import { runAgent, type AgentResult, type AgentRuntime } from "./runtime";

export interface SalesInput {
  business: BusinessContext;
  products: ProductContext[];
  lead: { id: string; name: string; stage: LeadStage; productId: string | null; source: string | null; score: number };
  memory: ConversationMemory;
  /** Only the most recent messages; older context lives in `memory`. */
  messages: { sender: "LEAD" | "AI" | "HUMAN" | "SYSTEM"; body: string; at: string }[];
  rules: { maxDiscountPct: number; allowCheckout: boolean };
  /** Present when this run is a follow-up (no new inbound message). */
  followUp?: { attempt: number; hoursSinceLastContact: number } | null;
}

export const EMPTY_MEMORY: ConversationMemory = { summary: "", facts: [], needs: [], objections: [], budget: null, intent: "OTHER", lastState: "" };

export function validateSalesReply(v: SalesReplyOutput, input: SalesInput): string[] {
  const problems: string[] = [];
  const ids = new Set(input.products.map((p) => p.id));
  if (v.requestCheckout) {
    if (!ids.has(v.requestCheckout.productId)) problems.push(`requestCheckout.productId must be one of ${[...ids].join(", ")}`);
    if (v.requestCheckout.discountPct > input.rules.maxDiscountPct) problems.push(`discountPct must be ≤ ${input.rules.maxDiscountPct}`);
    if (!input.rules.allowCheckout) problems.push("checkout is disabled for this business: requestCheckout must be null");
  }
  const unknown = findUnknownPrices(v.reply, input.products.map((p) => p.priceCents), input.rules.maxDiscountPct);
  if (unknown.length) problems.push(`reply quotes prices not present in Product Knowledge: ${unknown.map((c) => (c / 100).toFixed(2)).join(", ")}`);
  if (/https?:\/\//i.test(v.reply)) problems.push("reply must not contain links; the system appends the official checkout link");
  if (v.intent !== "OPT_OUT" && !v.handoffToHuman && v.reply.trim().length === 0) problems.push("reply cannot be empty unless intent is OPT_OUT or handing off");
  return problems;
}

/** Sales Agent: context = this workspace's products + this lead's summary and last messages only. */
export function salesReply(rt: AgentRuntime, input: SalesInput): Promise<AgentResult<SalesReplyOutput>> {
  const transcript = input.messages.map((m) => `[${m.at}] ${m.sender === "LEAD" ? "LEAD" : m.sender === "HUMAN" ? "HUMAN AGENT" : "YOU"}: ${m.body}`).join("\n");
  return runAgent(rt, {
    agent: "SALES",
    task: input.followUp ? "sales.follow_up" : "sales.reply",
    promptVersion: SALES_PROMPT_VERSION,
    system: [
      { text: SALES_SYSTEM },
      { text: renderBusinessBlock(input.business), cache: true },
    ],
    messages: [
      {
        role: "user",
        content: [
          `# Rules for this business`,
          `Max discount: ${input.rules.maxDiscountPct}%. Checkout allowed: ${input.rules.allowCheckout ? "yes" : "no"}.`,
          `# Lead`,
          `Name: ${input.lead.name || "unknown"}; stage: ${input.lead.stage}; score: ${input.lead.score}; interested product: ${input.lead.productId ?? "unknown"}; source: ${input.lead.source ?? "unknown"}`,
          `# Conversation memory (summary of older messages)`,
          JSON.stringify(input.memory),
          `# Recent messages`,
          transcript || "(no messages yet)",
          input.followUp
            ? `# Task\nWrite a short, respectful follow-up (#${input.followUp.attempt}) — ${Math.round(input.followUp.hoursSinceLastContact)}h since the last contact. Add value (answer a likely doubt or restate the key benefit), never pressure. If the conversation already ended or the lead declined, return an empty reply with handoffToHuman=false and intent OTHER.`
            : `# Task\nReply to the lead's last message.`,
        ].join("\n\n"),
      },
    ],
    schema: SalesReplyOutputSchema,
    schemaName: "sales_reply",
    inputSummary: `lead ${input.lead.id.slice(0, 8)} stage ${input.lead.stage}; ${input.messages.length} msgs${input.followUp ? " (follow-up)" : ""}`,
    validate: (v) => validateSalesReply(v, input),
    mock: () => mockSalesReply(input),
  });
}
