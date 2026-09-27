import { AppError, LEAD_STAGE_ORDER, type ContentStatus, type LeadStage, type SocialPostStatus } from "@revenueos/shared";

/** Content pipeline: IDEA → … → PUBLISHED, with FAILED/ARCHIVED exits and explicit recovery paths. */
export const CONTENT_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  IDEA: ["PLANNING", "SCRIPTING", "GENERATING", "FAILED", "ARCHIVED"],
  PLANNING: ["SCRIPTING", "GENERATING", "FAILED", "ARCHIVED"],
  SCRIPTING: ["GENERATING", "READY_TO_RENDER", "FAILED", "ARCHIVED"],
  GENERATING: ["READY_TO_RENDER", "FAILED", "ARCHIVED", "GENERATING"],
  READY_TO_RENDER: ["RENDERING", "GENERATING", "FAILED", "ARCHIVED"],
  RENDERING: ["RENDERED", "READY_TO_RENDER", "FAILED", "ARCHIVED"],
  RENDERED: ["READY", "READY_TO_RENDER", "FAILED", "ARCHIVED"],
  READY: ["SCHEDULED", "READY_TO_RENDER", "GENERATING", "PUBLISHING", "FAILED", "ARCHIVED"],
  SCHEDULED: ["PUBLISHING", "READY", "READY_TO_RENDER", "PUBLISHED", "FAILED", "ARCHIVED"],
  PUBLISHING: ["PUBLISHED", "SCHEDULED", "FAILED"],
  PUBLISHED: ["ARCHIVED"],
  FAILED: ["IDEA", "GENERATING", "READY_TO_RENDER", "READY", "SCHEDULED", "ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionContent(from: ContentStatus, to: ContentStatus): boolean {
  return from === to || CONTENT_TRANSITIONS[from].includes(to);
}

export function assertContentTransition(from: ContentStatus, to: ContentStatus): void {
  if (!canTransitionContent(from, to)) {
    throw new AppError({ code: "INVALID_TRANSITION", userMessage: `Content cannot move from ${from} to ${to}.`, httpStatus: 409 });
  }
}

/** Social post publishing state machine. DRAFT is final and never shown as public. */
export const POST_TRANSITIONS: Record<SocialPostStatus, SocialPostStatus[]> = {
  QUEUED: ["UPLOADING", "PROCESSING", "PUBLISHED", "DRAFT", "FAILED", "CANCELLED"],
  UPLOADING: ["PROCESSING", "PUBLISHED", "DRAFT", "FAILED", "QUEUED"],
  PROCESSING: ["PUBLISHED", "DRAFT", "FAILED", "PROCESSING"],
  PUBLISHED: [],
  DRAFT: ["PUBLISHED"],
  FAILED: ["QUEUED", "CANCELLED"],
  CANCELLED: ["QUEUED"],
};

export function canTransitionPost(from: SocialPostStatus, to: SocialPostStatus): boolean {
  return from === to || POST_TRANSITIONS[from].includes(to);
}

/** Leads only move forward automatically; LOST/WON are explicit. Humans can move freely via the CRM. */
export function nextLeadStage(current: LeadStage, suggested: LeadStage, opts: { automatic: boolean }): LeadStage {
  if (!opts.automatic) return suggested;
  if (current === "WON" || current === "LOST") return current;
  if (suggested === "WON") return current; // revenue requires a confirmed payment, never the AI's word
  if (suggested === "LOST") return current;
  return LEAD_STAGE_ORDER[suggested] > LEAD_STAGE_ORDER[current] ? suggested : current;
}
