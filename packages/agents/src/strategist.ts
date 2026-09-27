import {
  PerformanceReviewOutputSchema,
  StrategyPlanOutputSchema,
  WeeklyStrategyOutputSchema,
  type PerformanceReviewOutput,
  type Platform,
  type StrategyPlanOutput,
  type WeeklyStrategyOutput,
} from "@revenueos/shared";
import { renderBusinessBlock, renderPerformance, renderTemplateCatalog, type BusinessContext, type PerformanceContext } from "./context";
import { mockPerformanceReview, mockWeeklyStrategy } from "./mock/review";
import { mockStrategyPlan } from "./mock/strategist";
import { REVIEW_PROMPT_VERSION, REVIEW_SYSTEM, WEEKLY_PROMPT_VERSION, WEEKLY_SYSTEM } from "./prompts/review.v1";
import { STRATEGIST_PROMPT_VERSION, STRATEGIST_SYSTEM } from "./prompts/strategist.v1";
import { findForbidden, runAgent, type AgentResult, type AgentRuntime } from "./runtime";

export interface PlanOptions {
  count: number;
  seed: string;
  /** Extra instruction from a human ("focus on product X this week"). */
  focus?: string | null;
}

/**
 * Strategist: ONE structured call plans several contents at once (batching
 * keeps cost down). Uses performance data so the next plan learns from results.
 */
export function planContent(rt: AgentRuntime, ctx: BusinessContext, perf: PerformanceContext, opts: PlanOptions): Promise<AgentResult<StrategyPlanOutput>> {
  const productIds = new Set(ctx.products.map((p) => p.id));
  const allowedPlatforms = new Set<Platform>(ctx.workspace.targetPlatforms.length ? ctx.workspace.targetPlatforms : ["MOCK"]);
  return runAgent(rt, {
    agent: "STRATEGIST",
    task: "strategy.plan",
    promptVersion: STRATEGIST_PROMPT_VERSION,
    system: [
      { text: STRATEGIST_SYSTEM, cache: false },
      { text: `${renderTemplateCatalog()}\n\n${renderBusinessBlock(ctx)}`, cache: true },
    ],
    messages: [
      {
        role: "user",
        content: [
          renderPerformance(perf, ctx.workspace.currency),
          `# Request`,
          `Plan exactly ${opts.count} new content brief(s) for the next posting slots.`,
          `Allowed targetPlatforms: ${[...allowedPlatforms].join(", ")}.`,
          opts.focus ? `Human focus for this plan: ${opts.focus}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: StrategyPlanOutputSchema,
    schemaName: "strategy_plan",
    inputSummary: `plan ${opts.count} briefs; ${perf.recentContents.length} recent contents; ${perf.insights.length} insights`,
    validate: (v) => {
      const problems: string[] = [];
      if (v.briefs.length !== opts.count) problems.push(`briefs must contain exactly ${opts.count} items (got ${v.briefs.length})`);
      v.briefs.forEach((b, i) => {
        if (ctx.products.length > 0 && (!b.productId || !productIds.has(b.productId))) problems.push(`briefs.${i}.productId must be one of: ${[...productIds].join(", ")}`);
        if (ctx.products.length === 0 && b.productId) problems.push(`briefs.${i}.productId must be null (no products)`);
        const bad = b.targetPlatforms.filter((p) => !allowedPlatforms.has(p));
        if (bad.length) problems.push(`briefs.${i}.targetPlatforms contains unsupported ${bad.join(", ")}`);
        const forbidden = findForbidden([b.hook, b.cta, b.keyMessage, b.title], ctx.brand.forbiddenWords);
        if (forbidden.length) problems.push(`briefs.${i} uses forbidden words: ${forbidden.join(", ")}`);
      });
      return problems;
    },
    mock: () => mockStrategyPlan(ctx, perf, opts.count, opts.seed),
  });
}

export function performanceReview(rt: AgentRuntime, ctx: BusinessContext, perf7: PerformanceContext, perf30: PerformanceContext): Promise<AgentResult<PerformanceReviewOutput>> {
  return runAgent(rt, {
    agent: "STRATEGIST",
    task: "strategy.performance_review",
    promptVersion: REVIEW_PROMPT_VERSION,
    system: [
      { text: REVIEW_SYSTEM },
      { text: renderBusinessBlock(ctx), cache: true },
    ],
    messages: [{ role: "user", content: `${renderPerformance(perf7, ctx.workspace.currency)}\n\n---\n\n${renderPerformance(perf30, ctx.workspace.currency)}` }],
    schema: PerformanceReviewOutputSchema,
    schemaName: "performance_review",
    inputSummary: `review 7d/30d: ${perf30.recentContents.length} contents`,
    mock: () => mockPerformanceReview(ctx, perf30),
  });
}

export function weeklyStrategy(rt: AgentRuntime, ctx: BusinessContext, perf30: PerformanceContext): Promise<AgentResult<WeeklyStrategyOutput>> {
  return runAgent(rt, {
    agent: "STRATEGIST",
    task: "strategy.weekly",
    promptVersion: WEEKLY_PROMPT_VERSION,
    system: [
      { text: WEEKLY_SYSTEM },
      { text: renderBusinessBlock(ctx), cache: true },
    ],
    messages: [{ role: "user", content: renderPerformance(perf30, ctx.workspace.currency) }],
    schema: WeeklyStrategyOutputSchema,
    schemaName: "weekly_strategy",
    inputSummary: `weekly strategy: ${perf30.totals.contents} contents / 30d`,
    mock: () => mockWeeklyStrategy(ctx, perf30),
  });
}
