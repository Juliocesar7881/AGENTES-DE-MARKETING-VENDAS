import type { Metadata } from "next";
import { emergencyStatus } from "@revenueos/core";
import { AutopilotMatrix } from "@/components/autopilot/autopilot-matrix";
import { PageHeader } from "@/components/ui/misc";
import { listWorkspaces, requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Autopilot" };

export default async function AutopilotPage() {
  const user = await requireUser();
  const [list, emergency] = await Promise.all([listWorkspaces(), emergencyStatus()]);
  return (
    <>
      <PageHeader title="Autopilot" description="Choose, per business, what the agents may do without asking. You can stop everything at any time." />
      <AutopilotMatrix
        canLift={user.isAdmin}
        emergency={{ active: emergency.active, at: emergency.at }}
        rows={list.map((w) => ({ id: w.id, name: w.name, slug: w.slug, color: w.color, environment: w.environment, status: w.status, mode: w.operatingMode, permissions: w.autopilotPermissions }))}
      />
    </>
  );
}
