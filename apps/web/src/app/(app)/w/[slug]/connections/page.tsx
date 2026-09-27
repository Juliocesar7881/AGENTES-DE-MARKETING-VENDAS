import { integrationOverview, socialAccountSummary, webhookUrls, whatsappVerifyToken } from "@revenueos/core";
import { ConnectionsPanel } from "@/components/connections/connections-panel";
import { requireWorkspace } from "@/server/session";

export default async function ConnectionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, ws } = await requireWorkspace(slug);
  const [social, integrations] = await Promise.all([socialAccountSummary(ws.id), integrationOverview(ws.id)]);
  return (
    <ConnectionsPanel
      workspace={{ id: ws.id, slug: ws.slug, environment: ws.environment, targetPlatforms: ws.targetPlatforms }}
      accounts={social.accounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        username: a.username,
        displayName: a.displayName,
        status: a.status,
        isDemo: a.isDemo,
        scopes: a.scopes,
        lastValidatedAt: a.lastValidatedAt?.toISOString() ?? null,
        lastError: a.lastError,
        tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null,
        actionRequired: a.actionRequired,
        enabled: a.enabled,
      }))}
      appConfigured={social.appConfigured}
      integrations={integrations.map((i) => ({ key: i.key, status: i.status, config: i.config, lastTestedAt: i.lastTestedAt?.toISOString() ?? null, testResult: i.testResult as { ok?: boolean; message?: string } | null, credentials: i.credentials.map((c) => ({ type: c.type, last4: c.last4 })) }))}
      webhooks={webhookUrls(ws.id)}
      verifyToken={whatsappVerifyToken()}
      isAdmin={user.isAdmin}
    />
  );
}
