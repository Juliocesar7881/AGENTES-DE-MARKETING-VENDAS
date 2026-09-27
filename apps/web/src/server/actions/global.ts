"use server";
import { revalidatePath } from "next/cache";
import { decideApproval, requestWorkerPause, retryJob, setEmergencyStop, simulateDay } from "@revenueos/core";
import { approvalRequests, eq, jobs, withUser } from "@revenueos/database";
import { AuthorizationError } from "@revenueos/shared";
import { run } from "../action";
import { markNotificationsRead } from "../queries";
import { kick } from "../runner";
import { listWorkspaces, requireUser } from "../session";

export async function emergencyStopAction(on: boolean) {
  return run(async () => {
    const user = await requireUser();
    const r = await setEmergencyStop(on, user.id);
    revalidatePath("/", "layout");
    return r;
  }, on ? "Emergency stop activated" : "Automation resumed");
}

/** DEMO only: runs the real pipeline end-to-end on the user's DEMO workspaces. */
export async function simulateDayAction(workspaceIds?: string[]) {
  return run(async () => {
    const user = await requireUser();
    const demo = (await listWorkspaces()).filter((w) => w.environment === "DEMO" && (!workspaceIds || workspaceIds.includes(w.id)));
    if (!demo.length) throw new AuthorizationError("Simulate Day only runs on DEMO businesses.");
    const report = await simulateDay({ workspaceIds: demo.map((w) => w.id), contentsPerWorkspace: 2, userId: user.id });
    revalidatePath("/", "layout");
    return report;
  });
}

export async function markNotificationsReadAction(ids: string[] | "all") {
  return run(async () => {
    await markNotificationsRead(ids);
    return null;
  });
}

export async function decideApprovalAction(approvalId: string, decision: "APPROVED" | "REJECTED", note?: string) {
  return run(async () => {
    const user = await requireUser();
    // RLS read proves membership of the approval's workspace.
    const [a] = await withUser(user.id, (tx) => tx.select({ id: approvalRequests.id, ws: approvalRequests.workspaceId }).from(approvalRequests).where(eq(approvalRequests.id, approvalId)).limit(1));
    if (!a) throw new AuthorizationError("Approval not found.");
    await decideApproval(approvalId, decision, user.id, note);
    kick([a.ws]);
    revalidatePath("/", "layout");
    return null;
  }, decision === "APPROVED" ? "Approved" : "Rejected");
}

export async function retryJobAction(jobId: string) {
  return run(async () => {
    const user = await requireUser();
    const [j] = await withUser(user.id, (tx) => tx.select({ id: jobs.id, ws: jobs.workspaceId }).from(jobs).where(eq(jobs.id, jobId)).limit(1));
    if (!j) throw new AuthorizationError("Job not found.");
    await retryJob(jobId);
    if (j.ws) kick([j.ws]);
    revalidatePath("/jobs");
    return null;
  }, "Job queued again");
}

export async function workerPauseAction(workerId: string, paused: boolean) {
  return run(async () => {
    const user = await requireUser();
    await requestWorkerPause(workerId, paused, user.id);
    revalidatePath("/", "layout");
    return null;
  }, paused ? "Pause sent — applied at the next heartbeat" : "Resume sent");
}
