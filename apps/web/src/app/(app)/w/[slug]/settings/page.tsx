import { timingInsights } from "@revenueos/core";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { requireWorkspace } from "@/server/session";

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { ws } = await requireWorkspace(slug);
  const timing = await timingInsights(ws).catch(() => null);
  return (
    <WorkspaceSettings
      data={{
        id: ws.id,
        name: ws.name,
        industry: ws.industry,
        website: ws.website,
        description: ws.description,
        color: ws.color,
        whatsappNumber: ws.whatsappNumber,
        currency: ws.currency,
        timezone: ws.timezone,
        postsPerDay: ws.postsPerDay,
        postingSchedule: ws.postingSchedule,
        postingMode: ws.postingMode,
        targetReadyBuffer: ws.targetReadyBuffer,
        maxContentGeneratedPerDay: ws.maxContentGeneratedPerDay,
        maxContentPublishedPerDay: ws.maxContentPublishedPerDay,
        targetPlatforms: ws.targetPlatforms,
        operatingMode: ws.operatingMode,
        salesSettings: ws.salesSettings,
        retention: ws.retention,
        dailyAiBudgetUsd: ws.dailyAiBudgetUsd,
        monthlyAiBudgetUsd: ws.monthlyAiBudgetUsd,
        environment: ws.environment,
      }}
      timing={timing}
    />
  );
}
