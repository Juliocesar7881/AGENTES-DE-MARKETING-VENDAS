import { CircleAlert, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { embeddedDataDir } from "@revenueos/database";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { installState } from "@/server/install";
import { InstallWizard } from "./install-wizard";

export const metadata: Metadata = { title: "Install" };
export const dynamic = "force-dynamic";

const REQUIRED_ENV = [
  ["DATABASE_URL", "Postgres connection string (Supabase transaction pooler on Vercel)"],
  ["APP_ENCRYPTION_KEY", "32 random bytes, base64 — encrypts stored credentials"],
  ["APP_URL", "Public URL of this dashboard"],
  ["CRON_SECRET", "Protects /api/cron/tick"],
  ["STORAGE_DRIVER", "supabase (plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)"],
] as const;

export default async function InstallPage() {
  const s = await installState();
  if (s.installed) redirect("/login");

  return (
    <div className="min-h-dvh bg-background">
      <div className="bg-grid pointer-events-none fixed inset-0 [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_60%)]" />
      <div className="relative mx-auto flex max-w-3xl flex-col px-4 py-10">
        <Logo className="mb-8" />
        {s.ready ? (
          <div className="rounded-2xl border border-border bg-card p-8 shadow-card">
            <CircleCheck className="mb-3 size-8 text-success" />
            <h1 className="text-xl font-semibold tracking-[-0.02em]">RevenueOS is installed</h1>
            <p className="mt-1 text-sm text-muted-foreground">Database, security policies and encryption key are ready. The last step is the administrator account — it controls integrations, AI and the local worker.</p>
            <Button asChild variant="primary" size="lg" className="mt-6">
              <Link href="/signup">Create the admin account</Link>
            </Button>
          </div>
        ) : !s.writable ? (
          <div className="rounded-2xl border border-border bg-card p-8 shadow-card">
            <CircleAlert className="mb-3 size-8 text-warning" />
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Configure the environment variables</h1>
            <p className="mt-1 text-sm text-muted-foreground">This server cannot write its own configuration (for example on Vercel). Add these variables in your hosting provider, redeploy, then open this page again. Step by step: docs/deploy.md.</p>
            <ul className="mt-5 space-y-2 text-[13px]">
              {REQUIRED_ENV.map(([k, d]) => (
                <li key={k} className="flex items-start gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">{k}</code>
                  <span className="text-muted-foreground">{d}</span>
                </li>
              ))}
            </ul>
            {s.databaseError ? <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Database: {s.databaseError}</p> : null}
          </div>
        ) : (
          <InstallWizard
            envFile={s.envFile ?? ".env"}
            embeddedDir={embeddedDataDir()}
            hasKey={s.encryptionKey}
            previous={s.databaseConfigured ? { error: s.databaseError, embedded: s.embedded, needsMigration: s.databaseReachable && s.migrationsApplied < s.migrationsTotal } : null}
          />
        )}
      </div>
    </div>
  );
}
