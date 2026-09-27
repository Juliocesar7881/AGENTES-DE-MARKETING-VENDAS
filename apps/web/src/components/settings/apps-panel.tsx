"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PlatformIcon } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { INTEGRATION_STATUS } from "@/lib/status";
import { removeGlobalIntegrationAction, savePlatformAppAction } from "@/server/actions/connections";
import { CopyField } from "@/components/connections/copy-field";

export interface AppView {
  platform: "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "YOUTUBE";
  key: "instagram" | "meta" | "tiktok" | "google";
  title: string;
  idLabel: string;
  secretLabel: string;
  portal: string;
  status: string | null;
  clientId: string | null;
  hasSecret: boolean;
  fromEnv: boolean;
  audited?: boolean;
  redirectUri: string;
}

export function AppsPanel({ apps }: { apps: AppView[] }) {
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-[13px] text-muted-foreground">
        Each platform requires a developer app you create once (free). Businesses then connect their own accounts with OAuth. Secrets are encrypted and never displayed again.{" "}
        <Link href="/help/connections" className="text-primary hover:underline">
          Step-by-step guides
        </Link>
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {apps.map((a) => (
          <AppCard key={a.platform} app={a} />
        ))}
      </div>
    </div>
  );
}

function AppCard({ app }: { app: AppView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [clientId, setClientId] = useState(app.clientId ?? "");
  const [secret, setSecret] = useState("");
  const [audited, setAudited] = useState(Boolean(app.audited));
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <PlatformIcon platform={app.platform} size={28} />
          <div>
            <CardTitle>{app.title}</CardTitle>
            <CardDescription>
              <a href={app.portal} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {app.portal.replace(/^https:\/\//, "")}
              </a>
            </CardDescription>
          </div>
        </div>
        {app.fromEnv ? <Badge tone="success">from .env</Badge> : app.status ? <StatusBadge map={INTEGRATION_STATUS} value={app.status} /> : <Badge>Not configured</Badge>}
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await savePlatformAppAction(app.platform, { clientId, clientSecret: secret || undefined, ...(app.platform === "TIKTOK" ? { audited } : {}) });
              if (r.ok) {
                toast.success(r.message);
                setSecret("");
              } else toast.error(r.error);
              router.refresh();
            });
          }}
        >
          <CopyField label="OAuth redirect URI (paste in the developer portal)" value={app.redirectUri} />
          <Field label={app.idLabel}>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} required />
          </Field>
          <Field label={app.secretLabel} hint={app.hasSecret ? "Saved. Leave empty to keep the current secret." : undefined}>
            <Input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </Field>
          {app.platform === "TIKTOK" ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={audited} onChange={(e) => setAudited(e.target.checked)} /> My app passed TikTok&apos;s audit (public posting allowed)
            </label>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" loading={pending}>
              Save
            </Button>
            {app.status ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() =>
                  confirm("Remove this developer app? Connected accounts will stop refreshing tokens.") &&
                  start(async () => {
                    const r = await removeGlobalIntegrationAction(app.key);
                    if (r.ok) toast.success(r.message);
                    else toast.error(r.error);
                    router.refresh();
                  })
                }
              >
                Remove
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
