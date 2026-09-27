"use client";
import { CircleAlert, ExternalLink, Link2, Plug, RefreshCw, Unplug } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PlatformIcon, platformLabel } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { INTEGRATION_STATUS } from "@/lib/status";
import { ago } from "@/lib/utils";
import type { ActionResult } from "@/server/action";
import { disconnectSocialAction, removeWorkspaceIntegrationAction, savePaymentAction, saveWhatsAppAction, testPaymentAction, testSocialAction, testWhatsAppAction } from "@/server/actions/connections";
import { CopyField } from "./copy-field";

export interface SocialAccountView {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  status: string;
  isDemo: boolean;
  scopes: string[];
  lastValidatedAt: string | null;
  lastError: string | null;
  tokenExpiresAt: string | null;
  actionRequired: { reason: string; steps: string[]; links: { label: string; url: string }[]; missingScopes?: string[] } | null;
  enabled: boolean;
}

export interface IntegrationView {
  key: string;
  status: string;
  config: Record<string, unknown>;
  lastTestedAt: string | null;
  testResult: { ok?: boolean; message?: string } | null;
  credentials: { type: string; last4: string | null }[];
}

const PLATFORM_NOTES: Record<string, string> = {
  INSTAGRAM: "Professional (Business/Creator) account. Publishes Reels via the Instagram API with Instagram Login.",
  FACEBOOK: "Facebook Page Reels via Facebook Login for Business.",
  TIKTOK: "Content Posting API. Until TikTok audits your app, posts are private (SELF_ONLY) — or sent to the TikTok inbox as drafts.",
  YOUTUBE: "YouTube Shorts via the YouTube Data API. Videos are marked as AI-altered content.",
};

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<ActionResult<unknown>>, ok?: (d: unknown) => string | null) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        const msg = ok ? ok(r.data) : (r.message ?? "Done");
        if (msg) toast.success(msg);
      } else toast.error(r.error);
      router.refresh();
    });
  return { pending, act };
}

export function ConnectionsPanel(props: {
  workspace: { id: string; slug: string; environment: string; targetPlatforms: string[] };
  accounts: SocialAccountView[];
  appConfigured: Record<string, boolean>;
  integrations: IntegrationView[];
  webhooks: { whatsapp: string; instagram: string; mercadopago: string; stripe: string };
  verifyToken: string;
  isAdmin: boolean;
}) {
  const { workspace: ws } = props;
  const demo = ws.environment === "DEMO";
  const { pending, act } = useAct();
  const integ = (k: string) => props.integrations.find((i) => i.key === k) ?? null;

  return (
    <div className="space-y-6">
      {demo ? (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-[13px]">
          <CircleAlert className="mt-0.5 size-4 text-info" />
          <div>
            <div className="font-medium text-foreground">This is a DEMO business</div>
            <div className="text-muted-foreground">It uses simulated Instagram/TikTok/YouTube accounts, WhatsApp and payments — nothing is published or charged for real. Create a LIVE business (New business) to connect real accounts.</div>
          </div>
        </div>
      ) : null}

      <section>
        <h2 className="mb-1 text-sm font-semibold">Social accounts</h2>
        <p className="mb-3 text-xs text-muted-foreground">Connected with each platform&apos;s official OAuth — RevenueOS never asks for your social passwords. Tokens are encrypted at rest and never shown again.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK"].map((p) => {
            const accs = props.accounts.filter((a) => a.platform === p && a.enabled);
            const configured = props.appConfigured[p] ?? false;
            return (
              <Card key={p}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <PlatformIcon platform={p} size={28} />
                    <div>
                      <CardTitle>{platformLabel(p)}</CardTitle>
                      <CardDescription className="max-w-sm">{PLATFORM_NOTES[p]}</CardDescription>
                    </div>
                  </div>
                  {ws.targetPlatforms.includes(p) ? <Badge tone="primary">target</Badge> : null}
                </CardHeader>
                <CardContent className="space-y-3">
                  {accs.map((a) => (
                    <div key={a.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium">@{a.username}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {a.isDemo ? "simulated account" : `checked ${ago(a.lastValidatedAt)}`}
                            {a.tokenExpiresAt && !a.isDemo ? ` · token expires ${ago(a.tokenExpiresAt)}` : ""}
                          </div>
                        </div>
                        <StatusBadge map={INTEGRATION_STATUS} value={a.status} />
                      </div>
                      {a.actionRequired ? (
                        <div className="mt-2 rounded-md border border-warning/30 bg-warning-soft p-2.5 text-[12px]">
                          <div className="font-semibold text-warning">ACTION REQUIRED</div>
                          <div className="mt-0.5">{a.actionRequired.reason}</div>
                          {a.actionRequired.steps.length ? (
                            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
                              {a.actionRequired.steps.map((s) => (
                                <li key={s}>{s}</li>
                              ))}
                            </ol>
                          ) : null}
                          {a.actionRequired.links.map((l) => (
                            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="mt-1 mr-3 inline-flex items-center gap-1 text-primary hover:underline">
                              {l.label} <ExternalLink className="size-3" />
                            </a>
                          ))}
                        </div>
                      ) : a.lastError && a.status !== "CONNECTED" ? (
                        <div className="mt-2 text-[12px] text-danger">{a.lastError}</div>
                      ) : null}
                      <div className="mt-2 flex gap-1.5">
                        <Button size="xs" loading={pending} onClick={() => act(() => testSocialAction(a.id), (d) => { const x = d as { status: string; error: string | null; reason: string | null }; return x.status === "CONNECTED" ? "Connection OK: authenticated, permissions, account and publishing" : `Status: ${x.status.toLowerCase().replace("_", " ")} — ${x.error ?? x.reason ?? "see card"}`; })}>
                          <RefreshCw /> Test connection
                        </Button>
                        {!a.isDemo ? (
                          <>
                            <Button size="xs" variant="ghost" asChild>
                              <a href={`/api/oauth/${p.toLowerCase()}/start?workspaceId=${ws.id}`}>
                                <Link2 /> Reconnect
                              </a>
                            </Button>
                            <Button size="xs" variant="ghost" className="text-danger" loading={pending} onClick={() => confirm(`Disconnect @${a.username}? Scheduled posts to ${platformLabel(p)} will fail until you reconnect.`) && act(() => disconnectSocialAction(a.id))}>
                              <Unplug /> Disconnect
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {!demo ? (
                    configured ? (
                      <Button asChild variant={accs.length ? "ghost" : "primary"} size="sm">
                        <a href={`/api/oauth/${p.toLowerCase()}/start?workspaceId=${ws.id}`}>
                          <Plug /> {accs.length ? "Connect another account" : `Connect ${platformLabel(p)}`}
                        </a>
                      </Button>
                    ) : (
                      <div className="rounded-md border border-dashed border-border p-3 text-[12px] text-muted-foreground">
                        The {platformLabel(p)} developer app is not configured yet.{" "}
                        {props.isAdmin ? (
                          <Link href="/settings?tab=integrations" className="text-primary hover:underline">
                            Add it in Settings → Integrations
                          </Link>
                        ) : (
                          "Ask the administrator to add it."
                        )}{" "}
                        ·{" "}
                        <Link href={`/help/connections#${p.toLowerCase()}`} className="text-primary hover:underline">
                          Step-by-step guide
                        </Link>
                      </div>
                    )
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {!demo ? (
        <>
          <WhatsAppCard workspaceId={ws.id} integ={integ("whatsapp")} webhook={props.webhooks.whatsapp} verifyToken={props.verifyToken} />
          <section>
            <h2 className="mb-1 text-sm font-semibold">Payments</h2>
            <p className="mb-3 text-xs text-muted-foreground">Mercado Pago is used first when both are connected. Revenue is recorded only after the provider&apos;s signed webhook and an official status query.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <PaymentCard workspaceId={ws.id} provider="MERCADOPAGO" integ={integ("mercadopago")} webhook={props.webhooks.mercadopago} />
              <PaymentCard workspaceId={ws.id} provider="STRIPE" integ={integ("stripe")} webhook={props.webhooks.stripe} />
            </div>
          </section>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Instagram Direct messages</CardTitle>
                <CardDescription>Requires the instagram_business_manage_messages permission on your Instagram app (Advanced Access for accounts you don&apos;t own). Subscribe the webhook below to the “messages” field.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <CopyField label="Callback URL" value={props.webhooks.instagram} />
              <CopyField label="Verify token" value={props.verifyToken} />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function WhatsAppCard({ workspaceId, integ, webhook, verifyToken }: { workspaceId: string; integ: IntegrationView | null; webhook: string; verifyToken: string }) {
  const { pending, act } = useAct();
  const cfg = (integ?.config ?? {}) as { phoneNumberId?: string; businessAccountId?: string; displayPhone?: string };
  const [form, setForm] = useState({ phoneNumberId: cfg.phoneNumberId ?? "", businessAccountId: cfg.businessAccountId ?? "", displayPhone: cfg.displayPhone ?? "", accessToken: "", appSecret: "" });
  const hasToken = integ?.credentials.find((c) => c.type === "ACCESS_TOKEN");
  const hasSecret = integ?.credentials.find((c) => c.type === "APP_SECRET");
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <PlatformIcon platform="WHATSAPP" size={28} />
          <div>
            <CardTitle>WhatsApp Business (Cloud API)</CardTitle>
            <CardDescription>The Sales Agent replies within the 24-hour window; outside it only approved templates are sent. Opt-outs (“parar”, “sair”…) become DO NOT CONTACT automatically.</CardDescription>
          </div>
        </div>
        {integ ? <StatusBadge map={INTEGRATION_STATUS} value={integ.status} /> : <Badge>Not connected</Badge>}
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () => saveWhatsAppAction(workspaceId, { phoneNumberId: form.phoneNumberId, businessAccountId: form.businessAccountId, displayPhone: form.displayPhone, accessToken: form.accessToken || undefined, appSecret: form.appSecret || undefined }),
              (d) => {
                const x = d as { ok: boolean; message: string };
                setForm((f) => ({ ...f, accessToken: "", appSecret: "" }));
                return x.ok ? `WhatsApp connected: ${x.message}` : `Saved, but the test failed: ${x.message}`;
              },
            );
          }}
        >
          <Field label="Phone number ID" hint="WhatsApp Manager → API Setup">
            <Input value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} inputMode="numeric" required />
          </Field>
          <Field label="WhatsApp Business Account ID">
            <Input value={form.businessAccountId} onChange={(e) => setForm({ ...form, businessAccountId: e.target.value })} inputMode="numeric" />
          </Field>
          <Field label="Business phone (with country code)" hint="Used for tracked-link redirects (wa.me)">
            <Input value={form.displayPhone} onChange={(e) => setForm({ ...form, displayPhone: e.target.value })} inputMode="tel" placeholder="5511999999999" />
          </Field>
          <Field label="Permanent access token" hint={hasToken ? `Saved (…${hasToken.last4 ?? "****"}). Leave empty to keep.` : "System user token with whatsapp_business_messaging"}>
            <Input type="password" autoComplete="off" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />
          </Field>
          <Field label="Meta app secret" hint={hasSecret ? "Saved. Leave empty to keep." : "Verifies webhook signatures (X-Hub-Signature-256)"}>
            <Input type="password" autoComplete="off" value={form.appSecret} onChange={(e) => setForm({ ...form, appSecret: e.target.value })} />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="primary" loading={pending}>
              Save & test
            </Button>
            {integ ? (
              <>
                <Button type="button" loading={pending} onClick={() => act(() => testWhatsAppAction(workspaceId), (d) => { const x = d as { ok: boolean; message: string }; return x.ok ? x.message : `Test failed: ${x.message}`; })}>
                  Test
                </Button>
                <Button type="button" variant="ghost" className="text-danger" onClick={() => confirm("Remove WhatsApp? Credentials are deleted.") && act(() => removeWorkspaceIntegrationAction(workspaceId, "whatsapp"))}>
                  Remove
                </Button>
              </>
            ) : null}
          </div>
          {integ?.testResult?.message ? <p className={`text-[12px] sm:col-span-2 ${integ.testResult.ok ? "text-success" : "text-danger"}`}>Last test: {integ.testResult.message}</p> : null}
        </form>
        <div className="grid content-start gap-3 rounded-lg border border-border p-3">
          <div className="text-[12px] font-medium">Webhook (Meta App → WhatsApp → Configuration)</div>
          <CopyField label="Callback URL" value={webhook} />
          <CopyField label="Verify token" value={verifyToken} />
          <p className="text-[11px] text-muted-foreground">Subscribe to the “messages” field. Your app URL must be public HTTPS (e.g. Vercel) for Meta to reach it.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentCard({ workspaceId, provider, integ, webhook }: { workspaceId: string; provider: "MERCADOPAGO" | "STRIPE"; integ: IntegrationView | null; webhook: string }) {
  const { pending, act } = useAct();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const mp = provider === "MERCADOPAGO";
  const saved = (t: string) => integ?.credentials.find((c) => c.type === t);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{mp ? "Mercado Pago" : "Stripe"}</CardTitle>
          <CardDescription>{mp ? "Checkout Pro preferences (Pix, cards, boleto)." : "Stripe Checkout Sessions."}</CardDescription>
        </div>
        {integ ? <StatusBadge map={INTEGRATION_STATUS} value={integ.status} /> : <Badge>Not connected</Badge>}
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () => savePaymentAction(workspaceId, provider, mp ? { accessToken: a || undefined, webhookSecret: b || undefined } : { secretKey: a || undefined, webhookSecret: b || undefined }),
              (d) => {
                const x = d as { ok: boolean; message: string };
                setA("");
                setB("");
                return x.ok ? x.message : `Saved, but the test failed: ${x.message}`;
              },
            );
          }}
        >
          <Field label={mp ? "Access token" : "Secret key"} hint={saved(mp ? "ACCESS_TOKEN" : "SECRET_KEY") ? `Saved (…${saved(mp ? "ACCESS_TOKEN" : "SECRET_KEY")?.last4 ?? "****"}). Leave empty to keep.` : mp ? "Your integrations → Credentials → Production access token (APP_USR-…)" : "Developers → API keys (sk_live_… or a restricted key)"}>
            <Input type="password" autoComplete="off" value={a} onChange={(e) => setA(e.target.value)} />
          </Field>
          <Field label="Webhook secret" hint={saved("WEBHOOK_SECRET") ? "Saved. Leave empty to keep." : mp ? "Your integrations → Webhooks → secret signature" : "Developers → Webhooks → signing secret (whsec_…)"}>
            <Input type="password" autoComplete="off" value={b} onChange={(e) => setB(e.target.value)} />
          </Field>
          <CopyField label={mp ? "Notification URL (event: payments)" : "Endpoint URL (event: checkout.session.completed, charge.refunded)"} value={webhook} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={pending}>
              Save & test
            </Button>
            {integ ? (
              <>
                <Button type="button" size="sm" loading={pending} onClick={() => act(() => testPaymentAction(workspaceId, provider), (d) => { const x = d as { ok: boolean; message: string }; return x.ok ? x.message : `Test failed: ${x.message}`; })}>
                  Test
                </Button>
                <Button type="button" size="sm" variant="ghost" className="text-danger" onClick={() => confirm("Remove this payment provider? Credentials are deleted.") && act(() => removeWorkspaceIntegrationAction(workspaceId, mp ? "mercadopago" : "stripe"))}>
                  Remove
                </Button>
              </>
            ) : null}
          </div>
          {integ?.testResult?.message ? <p className={`text-[12px] ${integ.testResult.ok ? "text-success" : "text-danger"}`}>Last test: {integ.testResult.message}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
