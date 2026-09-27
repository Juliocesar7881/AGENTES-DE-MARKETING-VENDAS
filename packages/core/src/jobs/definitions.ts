import type { AgentRole, JobRunner, JobType } from "@revenueos/shared";

export type ConcurrencyClass = "render" | "ai" | "io";

export interface JobDefinition {
  type: JobType;
  runner: JobRunner;
  priority: number;
  maxAttempts: number;
  /** Lease duration; a crashed runner's job becomes claimable again after this. */
  leaseSec: number;
  concurrency: ConcurrencyClass;
  /** Paused when AI budgets are exceeded. */
  nonEssentialAI?: boolean;
  /** Contacts the outside world (stopped by the emergency stop). */
  outbound?: boolean;
  /** Pure bookkeeping, allowed during emergency stop. */
  emergencySafe?: boolean;
  agent?: AgentRole;
  /** Non-idempotent side effects: retries must check provider state first. */
  nonIdempotent?: boolean;
}

const d = (def: JobDefinition) => def;

export const JOB_DEFINITIONS: Record<JobType, JobDefinition> = {
  STRATEGY_PLAN: d({ type: "STRATEGY_PLAN", runner: "LOCAL", priority: 80, maxAttempts: 3, leaseSec: 600, concurrency: "ai", nonEssentialAI: true, agent: "STRATEGIST" }),
  CREATIVE_GENERATE: d({ type: "CREATIVE_GENERATE", runner: "LOCAL", priority: 90, maxAttempts: 3, leaseSec: 600, concurrency: "ai", nonEssentialAI: true, agent: "CREATIVE" }),
  RENDER_VIDEO: d({ type: "RENDER_VIDEO", runner: "LOCAL", priority: 100, maxAttempts: 3, leaseSec: 1800, concurrency: "render", agent: "CREATIVE" }),
  PREPARE_DELIVERY: d({ type: "PREPARE_DELIVERY", runner: "LOCAL", priority: 60, maxAttempts: 5, leaseSec: 900, concurrency: "io", outbound: true }),
  SCHEDULE_CONTENT: d({ type: "SCHEDULE_CONTENT", runner: "ANY", priority: 70, maxAttempts: 5, leaseSec: 120, concurrency: "io", agent: "GROWTH" }),
  PUBLISH_POST: d({ type: "PUBLISH_POST", runner: "ANY", priority: 20, maxAttempts: 4, leaseSec: 900, concurrency: "io", outbound: true, agent: "GROWTH", nonIdempotent: true }),
  SYNC_METRICS: d({ type: "SYNC_METRICS", runner: "ANY", priority: 150, maxAttempts: 3, leaseSec: 180, concurrency: "io", agent: "GROWTH" }),
  SALES_REPLY: d({ type: "SALES_REPLY", runner: "ANY", priority: 10, maxAttempts: 3, leaseSec: 300, concurrency: "ai", outbound: true, agent: "SALES", nonIdempotent: true }),
  FOLLOW_UP: d({ type: "FOLLOW_UP", runner: "ANY", priority: 40, maxAttempts: 2, leaseSec: 300, concurrency: "ai", outbound: true, agent: "SALES", nonIdempotent: true }),
  PERFORMANCE_REVIEW: d({ type: "PERFORMANCE_REVIEW", runner: "ANY", priority: 160, maxAttempts: 2, leaseSec: 600, concurrency: "ai", nonEssentialAI: true, agent: "STRATEGIST" }),
  WEEKLY_STRATEGY: d({ type: "WEEKLY_STRATEGY", runner: "ANY", priority: 170, maxAttempts: 2, leaseSec: 600, concurrency: "ai", nonEssentialAI: true, agent: "STRATEGIST" }),
  LEARNING_UPDATE: d({ type: "LEARNING_UPDATE", runner: "ANY", priority: 140, maxAttempts: 3, leaseSec: 300, concurrency: "io", emergencySafe: true, agent: "STRATEGIST" }),
  ATTRIBUTE_REVENUE: d({ type: "ATTRIBUTE_REVENUE", runner: "ANY", priority: 15, maxAttempts: 5, leaseSec: 120, concurrency: "io", emergencySafe: true, agent: "CUSTOMER_SUCCESS" }),
  TOKEN_HEALTH: d({ type: "TOKEN_HEALTH", runner: "ANY", priority: 180, maxAttempts: 2, leaseSec: 300, concurrency: "io" }),
  CLEANUP_LOCAL_RENDERS: d({ type: "CLEANUP_LOCAL_RENDERS", runner: "LOCAL", priority: 200, maxAttempts: 2, leaseSec: 600, concurrency: "io" }),
  CLEANUP_DELIVERY: d({ type: "CLEANUP_DELIVERY", runner: "ANY", priority: 200, maxAttempts: 3, leaseSec: 300, concurrency: "io" }),
  PROCESS_ASSET: d({ type: "PROCESS_ASSET", runner: "LOCAL", priority: 120, maxAttempts: 3, leaseSec: 300, concurrency: "io" }),
  WEBSITE_SCREENSHOT: d({ type: "WEBSITE_SCREENSHOT", runner: "LOCAL", priority: 120, maxAttempts: 2, leaseSec: 180, concurrency: "io" }),
  VALIDATE_COMPOSITION: d({ type: "VALIDATE_COMPOSITION", runner: "LOCAL", priority: 130, maxAttempts: 1, leaseSec: 900, concurrency: "render", nonEssentialAI: true, agent: "CREATIVE" }),
  SIMULATE_DAY: d({ type: "SIMULATE_DAY", runner: "ANY", priority: 50, maxAttempts: 1, leaseSec: 900, concurrency: "io" }),
  ANALYTICS_ROLLUP: d({ type: "ANALYTICS_ROLLUP", runner: "ANY", priority: 190, maxAttempts: 2, leaseSec: 300, concurrency: "io", emergencySafe: true }),
};

export function jobDefinition(type: JobType): JobDefinition {
  return JOB_DEFINITIONS[type];
}

/** Retry delay: exponential backoff with jitter (seconds). */
export function retryDelaySec(attempt: number, retryAfterSec?: number): number {
  if (retryAfterSec != null && retryAfterSec > 0) return Math.min(retryAfterSec, 3600);
  const base = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + Math.random() * 0.5));
}
