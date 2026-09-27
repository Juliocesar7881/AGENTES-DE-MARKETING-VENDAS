export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

type Map = Record<string, { label: string; tone: Tone }>;

export const CONTENT_STATUS: Map = {
  IDEA: { label: "Idea", tone: "neutral" },
  PLANNING: { label: "Planning", tone: "neutral" },
  SCRIPTING: { label: "Scripting", tone: "info" },
  GENERATING: { label: "Generating", tone: "info" },
  READY_TO_RENDER: { label: "Ready to render", tone: "info" },
  RENDERING: { label: "Rendering", tone: "primary" },
  RENDERED: { label: "Rendered", tone: "primary" },
  READY: { label: "Ready", tone: "success" },
  SCHEDULED: { label: "Scheduled", tone: "primary" },
  PUBLISHING: { label: "Publishing", tone: "warning" },
  PUBLISHED: { label: "Published", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

export const POST_STATUS: Map = {
  QUEUED: { label: "Queued", tone: "neutral" },
  UPLOADING: { label: "Uploading", tone: "info" },
  PROCESSING: { label: "Processing", tone: "info" },
  PUBLISHED: { label: "Published", tone: "success" },
  DRAFT: { label: "Sent to drafts", tone: "warning" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const LEAD_STAGE: Map = {
  NEW: { label: "New", tone: "neutral" },
  CONTACTED: { label: "Contacted", tone: "info" },
  ENGAGED: { label: "Engaged", tone: "primary" },
  QUALIFIED: { label: "Qualified", tone: "warning" },
  CHECKOUT: { label: "Checkout", tone: "warning" },
  WON: { label: "Won", tone: "success" },
  LOST: { label: "Lost", tone: "danger" },
};

export const JOB_STATUS: Map = {
  QUEUED: { label: "Queued", tone: "neutral" },
  RUNNING: { label: "Running", tone: "primary" },
  COMPLETED: { label: "Completed", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  RETRYING: { label: "Retrying", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  WAITING_APPROVAL: { label: "Waiting approval", tone: "warning" },
  PAUSED: { label: "Paused", tone: "warning" },
};

export const AGENT_STATUS: Map = {
  IDLE: { label: "Idle", tone: "neutral" },
  WORKING: { label: "Working", tone: "primary" },
  WAITING: { label: "Waiting", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
  PAUSED: { label: "Paused", tone: "warning" },
};

export const PAYMENT_STATUS: Map = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "danger" },
};

export const INTEGRATION_STATUS: Map = {
  NOT_CONFIGURED: { label: "Not connected", tone: "neutral" },
  CONNECTED: { label: "Connected", tone: "success" },
  READY: { label: "Ready", tone: "success" },
  NEEDS_ACTION: { label: "Action required", tone: "warning" },
  ERROR: { label: "Error", tone: "danger" },
  EXPIRED: { label: "Expired", tone: "danger" },
  REVOKED: { label: "Disconnected", tone: "neutral" },
};

export const MODE: Map = {
  MANUAL: { label: "Manual", tone: "neutral" },
  ASSISTED: { label: "Assisted", tone: "info" },
  AUTOPILOT: { label: "Autopilot", tone: "success" },
};

export const AGENT_LABEL: Record<string, { name: string; description: string }> = {
  STRATEGIST: { name: "Strategist", description: "Plans content from sales, revenue and lead data" },
  CREATIVE: { name: "Creative", description: "Writes scripts, hooks and motion-design VideoSpecs" },
  GROWTH: { name: "Growth", description: "Schedules, publishes and tracks performance" },
  SALES: { name: "Sales", description: "Replies to leads, qualifies and sends checkout" },
  CUSTOMER_SUCCESS: { name: "Customer Success", description: "Confirms payments, attribution and onboarding" },
};

export function statusOf(map: Map, key: string | null | undefined): { label: string; tone: Tone } {
  if (!key) return { label: "—", tone: "neutral" };
  return map[key] ?? { label: key.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), tone: "neutral" };
}
