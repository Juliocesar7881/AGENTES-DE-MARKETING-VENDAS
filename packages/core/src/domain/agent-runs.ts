import { agentRuns, agents, aiUsage, and, eq } from "@revenueos/database";
import type { AgentResult } from "@revenueos/agents";
import { localDateString, serializeError, startOfLocalDay, zonedToUtc, type AgentRole, type AgentStatus } from "@revenueos/shared";
import { db, now } from "../deps";
import type { Workspace } from "../providers";
import { notify } from "../records";
import { getGlobalSettings } from "../settings";
import { realAiSpend } from "./analytics";

export async function setAgentStatus(workspaceId: string, role: AgentRole, status: AgentStatus, extra: { task?: string | null; jobId?: string | null; error?: string | null } = {}): Promise<void> {
  await db()
    .update(agents)
    .set({
      status,
      currentTask: status === "WORKING" ? (extra.task ?? null) : null,
      currentJobId: status === "WORKING" ? (extra.jobId ?? null) : null,
      ...(status === "IDLE" || status === "ERROR" ? { lastRunAt: now() } : {}),
      ...(extra.error !== undefined ? { lastError: extra.error } : {}),
    })
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.role, role)));
}

export async function isAgentPaused(workspaceId: string, role: AgentRole): Promise<boolean> {
  const rows = await db()
    .select({ paused: agents.paused })
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.role, role)))
    .limit(1);
  return rows[0]?.paused ?? false;
}

/** Stores the agent run (input summary, output, model, tokens, cost, duration) and the AI usage ledger row. */
export async function recordAgentRun<T>(opts: { workspaceId: string | null; jobId: string | null; isDemo: boolean; result: AgentResult<T> }): Promise<string> {
  const r = opts.result.result;
  const [run] = await db()
    .insert(agentRuns)
    .values({
      workspaceId: opts.workspaceId,
      agentRole: opts.result.agent,
      task: opts.result.task,
      jobId: opts.jobId,
      provider: r.provider,
      model: r.model,
      promptVersion: opts.result.promptVersion,
      inputSummary: opts.result.inputSummary,
      output: r.data as unknown,
      status: "SUCCESS",
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      cacheReadTokens: r.usage.cacheReadTokens,
      cacheWriteTokens: r.usage.cacheWriteTokens,
      costUsd: r.costUsd,
      durationMs: r.durationMs,
      attempts: r.attempts,
    })
    .returning({ id: agentRuns.id });
  await db().insert(aiUsage).values({
    workspaceId: opts.workspaceId,
    jobId: opts.jobId,
    agentRunId: run!.id,
    agentRole: opts.result.agent,
    provider: r.provider,
    model: r.model,
    inputTokens: r.usage.inputTokens,
    outputTokens: r.usage.outputTokens,
    cacheReadTokens: r.usage.cacheReadTokens,
    cacheWriteTokens: r.usage.cacheWriteTokens,
    estimatedCostUsd: r.costUsd,
    isDemo: opts.isDemo || r.provider === "mock",
  });
  return run!.id;
}

export async function recordAgentFailure(opts: { workspaceId: string | null; jobId: string | null; agent: AgentRole; task: string; provider: string; model: string; promptVersion: string; error: unknown }): Promise<void> {
  const ser = serializeError(opts.error);
  await db().insert(agentRuns).values({
    workspaceId: opts.workspaceId,
    agentRole: opts.agent,
    task: opts.task,
    jobId: opts.jobId,
    provider: opts.provider,
    model: opts.model,
    promptVersion: opts.promptVersion,
    status: "ERROR",
    error: `${ser.userMessage} (${ser.code})`,
  });
}

export interface BudgetCheck {
  allowed: boolean;
  reason: string | null;
  resumeAt: Date | null;
}

/**
 * AI budget guard. Over budget → non-essential AI work pauses until the next
 * day/month. Sales replies and webhooks are never blocked by budgets.
 */
export async function checkBudget(ws: Workspace): Promise<BudgetCheck> {
  const t = now();
  const dayStart = startOfLocalDay(t, ws.timezone);
  const today = localDateString(t, ws.timezone);
  const monthStart = zonedToUtc(`${today.slice(0, 7)}-01`, "00:00", ws.timezone);
  const nextDay = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const nextMonth = zonedToUtc(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, "00:00", ws.timezone);
  if (ws.dailyAiBudgetUsd != null) {
    const spent = await realAiSpend(ws.id, dayStart);
    if (spent >= ws.dailyAiBudgetUsd) return { allowed: false, reason: `Daily AI budget of $${ws.dailyAiBudgetUsd} reached ($${spent.toFixed(2)} spent).`, resumeAt: nextDay };
  }
  if (ws.monthlyAiBudgetUsd != null) {
    const spent = await realAiSpend(ws.id, monthStart);
    if (spent >= ws.monthlyAiBudgetUsd) return { allowed: false, reason: `Monthly AI budget of $${ws.monthlyAiBudgetUsd} reached ($${spent.toFixed(2)} spent).`, resumeAt: nextMonth };
  }
  const global = await getGlobalSettings();
  if (global.globalMonthlyAiBudgetUsd != null) {
    const utcMonthStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
    const spent = await realAiSpend(null, utcMonthStart);
    if (spent >= global.globalMonthlyAiBudgetUsd) {
      return { allowed: false, reason: `Global monthly AI budget of $${global.globalMonthlyAiBudgetUsd} reached.`, resumeAt: new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1)) };
    }
  }
  return { allowed: true, reason: null, resumeAt: null };
}

export async function notifyBudget(ws: Workspace, reason: string): Promise<void> {
  await notify({
    workspaceId: ws.id,
    type: "BUDGET_EXCEEDED",
    severity: "WARNING",
    title: `AI budget reached — ${ws.name}`,
    body: `${reason} Non-essential AI tasks are paused; sales replies continue.`,
    link: `/w/${ws.slug}/settings`,
    dedupeKey: `budget:${ws.id}:${localDateString(now(), ws.timezone)}`,
  });
}
