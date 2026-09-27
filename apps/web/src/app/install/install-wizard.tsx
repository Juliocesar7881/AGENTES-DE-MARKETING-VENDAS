"use client";
import { ArrowLeft, ArrowRight, Check, CircleAlert, CircleCheck, Cloud, Database, HardDrive, KeyRound, Loader2, Rocket, Server, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { checkSetupCodeAction, installAction, testDatabaseAction } from "@/server/actions/install";

type Mode = "embedded" | "postgres" | "url";
interface TestResult {
  ok: boolean;
  message: string;
  willCreate: boolean;
}
interface Step {
  label: string;
  ok: boolean;
  detail?: string;
}

const STEPS = ["Welcome", "Database", "Options", "Install"];

export function InstallWizard(props: { envFile: string; embeddedDir: string; hasKey: boolean; previous: { error: string | null; embedded: boolean; needsMigration: boolean } | null }) {
  const [step, setStep] = useState(0);
  const [code, setCode] = useState("");
  const [codeOk, setCodeOk] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(props.previous && !props.previous.embedded ? "postgres" : "embedded");
  const [pg, setPg] = useState({ host: "localhost", port: "5432", user: "postgres", password: "", database: "revenueos" });
  const [url, setUrl] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const [appUrl, setAppUrl] = useState("");
  const [demo, setDemo] = useState(true);
  const [result, setResult] = useState<{ steps: Step[]; envFile: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The launcher opens /install#code=XXXX-XXXX (the fragment never reaches the server).
  useEffect(() => {
    setAppUrl(window.location.origin);
    const m = window.location.hash.match(/code=([A-Za-z0-9-]{4,20})/);
    if (m) {
      history.replaceState(null, "", window.location.pathname);
      const c = m[1]!;
      setCode(c);
      void checkSetupCodeAction(c).then((r) => {
        if (r.ok) {
          setCodeOk(true);
          setStep(1);
        }
      });
    }
  }, []);

  const choice = () => (mode === "embedded" ? { mode } : mode === "postgres" ? { mode, ...pg, port: Number(pg.port) } : { mode, url });

  const verifyCode = () =>
    start(async () => {
      setCodeError(null);
      const r = await checkSetupCodeAction(code);
      if (r.ok) {
        setCodeOk(true);
        setStep(1);
      } else setCodeError(r.error);
    });

  const runTest = () =>
    start(async () => {
      setTest(null);
      const r = await testDatabaseAction(code, choice());
      setTest(r.ok ? { ok: r.data.ok, message: r.data.message, willCreate: r.data.willCreate } : { ok: false, message: r.error, willCreate: false });
    });

  const install = () =>
    start(async () => {
      setError(null);
      const r = await installAction(code, { database: choice(), appUrl, demo });
      if (r.ok) setResult(r.data);
      else setError(r.error);
    });

  const dbReady = mode === "embedded" || Boolean(test?.ok);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">Install RevenueOS</h1>
        <p className="mt-1 text-sm text-muted-foreground">Four short steps. Nothing is sent anywhere — everything is configured on this computer.</p>
      </div>
      <ol className="flex items-center gap-2 text-[12px]">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={cn("grid size-6 place-items-center rounded-full border text-[11px] font-semibold", i < step || result ? "border-success bg-success text-white" : i === step ? "border-primary text-primary" : "border-border text-subtle")}>{i < step || result ? <Check className="size-3.5" /> : i + 1}</span>
            <span className={cn(i === step ? "font-medium text-foreground" : "text-muted-foreground")}>{s}</span>
            {i < STEPS.length - 1 ? <span className="mx-1 h-px w-6 bg-border" /> : null}
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
        {step === 0 ? (
          <div className="grid gap-5">
            <div>
              <h2 className="text-lg font-semibold">Welcome</h2>
              <p className="mt-1 text-sm text-muted-foreground">RevenueOS will set up its database, generate the encryption key that protects your connected accounts, and create the tables and security policies. Then you create the administrator account.</p>
            </div>
            {props.previous?.error ? (
              <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[13px]">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>The configured database is not reachable: {props.previous.error}</span>
              </div>
            ) : null}
            <Field label="Setup code" htmlFor="setup-code" hint="Shown in the RevenueOS window (or the terminal) that started the dashboard. It proves you are the person installing it." error={codeError}>
              <Input id="setup-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX" autoComplete="off" className="max-w-xs font-mono tracking-widest uppercase" onKeyDown={(e) => e.key === "Enter" && code && verifyCode()} />
            </Field>
            <div className="flex justify-end">
              <Button variant="primary" loading={pending} disabled={!code} onClick={verifyCode}>
                Continue <ArrowRight />
              </Button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-5">
            <div>
              <h2 className="text-lg font-semibold">Where should RevenueOS keep its data?</h2>
              <p className="mt-1 text-sm text-muted-foreground">Businesses, content, leads, sales and encrypted credentials live in a PostgreSQL database.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <ModeCard active={mode === "embedded"} onClick={() => { setMode("embedded"); setTest(null); }} icon={HardDrive} title="Built-in database" badge="Recommended" text="Runs inside RevenueOS on this computer. Nothing else to install." />
              <ModeCard active={mode === "postgres"} onClick={() => { setMode("postgres"); setTest(null); }} icon={Server} title="My PostgreSQL" text="A PostgreSQL server you already have (this computer or your network)." />
              <ModeCard active={mode === "url"} onClick={() => { setMode("url"); setTest(null); }} icon={Cloud} title="Cloud database" text="Supabase (free tier) or any hosted Postgres — needed to host the dashboard online." />
            </div>

            {mode === "embedded" ? (
              <div className="rounded-lg border border-border bg-muted/40 p-4 text-[13px]">
                <div className="flex items-center gap-2 font-medium">
                  <Database className="size-4 text-primary" /> PostgreSQL 17, private to this computer
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>Data folder: <code className="font-mono text-[12px] text-foreground">{props.embeddedDir}</code></li>
                  <li>Listens only on 127.0.0.1 with a random password — not reachable from the network.</li>
                  <li>Starts automatically with RevenueOS. Back it up by copying the folder while RevenueOS is closed.</li>
                </ul>
              </div>
            ) : null}

            {mode === "postgres" ? (
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                  <Field label="Host" htmlFor="pg-host">
                    <Input id="pg-host" value={pg.host} onChange={(e) => setPg({ ...pg, host: e.target.value })} />
                  </Field>
                  <Field label="Port" htmlFor="pg-port">
                    <Input id="pg-port" inputMode="numeric" value={pg.port} onChange={(e) => setPg({ ...pg, port: e.target.value })} />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="User" htmlFor="pg-user">
                    <Input id="pg-user" value={pg.user} onChange={(e) => setPg({ ...pg, user: e.target.value })} />
                  </Field>
                  <Field label="Password" htmlFor="pg-password">
                    <Input id="pg-password" type="password" autoComplete="off" value={pg.password} onChange={(e) => setPg({ ...pg, password: e.target.value })} />
                  </Field>
                  <Field label="Database" htmlFor="pg-db" hint="Created if missing (local servers)">
                    <Input id="pg-db" value={pg.database} onChange={(e) => setPg({ ...pg, database: e.target.value })} />
                  </Field>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  No PostgreSQL yet? Choose <strong>Built-in database</strong>, or install it from{" "}
                  <a className="text-primary hover:underline" href="https://www.postgresql.org/download/" target="_blank" rel="noopener noreferrer">
                    postgresql.org/download
                  </a>
                  .
                </p>
              </div>
            ) : null}

            {mode === "url" ? (
              <div className="grid gap-3">
                <Field label="Connection string" htmlFor="pg-url" hint="Supabase: Project → Connect → Session pooler → copy the URI and replace [YOUR-PASSWORD].">
                  <Textarea id="pg-url" rows={2} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="postgresql://postgres.xxxx:password@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" className="font-mono text-[12px]" />
                </Field>
                <p className="text-[12px] text-muted-foreground">
                  Free project at{" "}
                  <a className="text-primary hover:underline" href="https://supabase.com/dashboard/new" target="_blank" rel="noopener noreferrer">
                    supabase.com
                  </a>
                  . TLS is required automatically for remote servers.
                </p>
              </div>
            ) : null}

            {mode !== "embedded" ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button loading={pending} onClick={runTest} disabled={mode === "url" ? !url : !pg.host || !pg.user}>
                  Test connection
                </Button>
                {test ? (
                  <span className={cn("flex items-center gap-1.5 text-[13px]", test.ok ? "text-success" : "text-danger")}>
                    {test.ok ? <CircleCheck className="size-4" /> : <CircleAlert className="size-4" />}
                    {test.message}
                  </span>
                ) : null}
              </div>
            ) : null}

            <Nav back={() => setStep(0)} next={() => setStep(2)} nextDisabled={!dbReady} hideBack={codeOk} />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-5">
            <div>
              <h2 className="text-lg font-semibold">Options</h2>
              <p className="mt-1 text-sm text-muted-foreground">You can change these later.</p>
            </div>
            <Field label="Dashboard address" htmlFor="app-url" hint="Used for links in videos, OAuth and webhooks. Keep the default when using RevenueOS on this computer; use your public https address when hosting it.">
              <Input id="app-url" value={appUrl} onChange={(e) => setAppUrl(e.target.value)} />
            </Field>
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox checked={demo} onChange={(e) => setDemo(e.target.checked)} className="mt-0.5" />
              <span>
                Include <strong>Explore Demo</strong>
                <span className="block text-[12px] text-muted-foreground">3 sample businesses with simulated accounts, clearly marked DEMO and kept separate from your real data.</span>
              </span>
            </label>
            <div className="flex gap-3 rounded-lg border border-border bg-muted/40 p-4 text-[13px]">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <div className="font-medium">{props.hasKey ? "Your existing encryption key will be kept" : "An encryption key will be generated"}</div>
                <div className="text-muted-foreground">
                  It encrypts every token and API key you connect. It is saved in <code className="font-mono text-[12px] text-foreground">{props.envFile}</code> — back up this file; without it, stored credentials cannot be read.
                </div>
              </div>
            </div>
            <Nav back={() => setStep(1)} next={() => setStep(3)} nextDisabled={!/^https?:\/\/.+/.test(appUrl)} />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-5">
            {!result ? (
              <>
                <div>
                  <h2 className="text-lg font-semibold">Ready to install</h2>
                  <p className="mt-1 text-sm text-muted-foreground">This takes up to a minute (the built-in database is created on first run).</p>
                </div>
                <dl className="grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-[150px_1fr]">
                  <dt className="text-muted-foreground">Database</dt>
                  <dd>{mode === "embedded" ? "Built-in (this computer)" : mode === "postgres" ? `${pg.user}@${pg.host}:${pg.port}/${pg.database}` : "Cloud connection string"}</dd>
                  <dt className="text-muted-foreground">Dashboard address</dt>
                  <dd>{appUrl}</dd>
                  <dt className="text-muted-foreground">Explore Demo</dt>
                  <dd>{demo ? "included" : "not included"}</dd>
                </dl>
                {pending ? (
                  <div className="flex items-center gap-2 rounded-lg bg-primary-soft px-3 py-2.5 text-[13px] text-primary">
                    <Loader2 className="size-4 animate-spin" /> Installing — preparing the database, security policies and keys…
                  </div>
                ) : null}
                {error ? (
                  <div className="flex gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    {error}
                  </div>
                ) : null}
                <div className="flex justify-between border-t border-border pt-4">
                  <Button variant="ghost" disabled={pending} onClick={() => setStep(2)}>
                    <ArrowLeft /> Back
                  </Button>
                  <Button variant="primary" size="lg" loading={pending} onClick={install}>
                    <Rocket /> Install RevenueOS
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <ShieldCheck className="size-8 text-success" />
                  <div>
                    <h2 className="text-lg font-semibold">Installed</h2>
                    <p className="text-sm text-muted-foreground">One last step: the administrator account.</p>
                  </div>
                </div>
                <ul className="space-y-2">
                  {result.steps.map((s) => (
                    <li key={s.label} className="flex items-start gap-2 text-[13px]">
                      <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
                      <span>
                        <span className="font-medium">{s.label}</span>
                        {s.detail ? <span className="block break-all text-muted-foreground">{s.detail}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end border-t border-border pt-4">
                  <Button asChild variant="primary" size="lg">
                    <Link href="/signup">
                      Create the admin account <ArrowRight />
                    </Link>
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
      <p className="text-center text-[12px] text-subtle">
        Prefer the terminal? <code className="font-mono">pnpm setup</code> does the same. <Badge className="ml-1">v0.1</Badge>
      </p>
    </div>
  );
}

function ModeCard({ active, onClick, icon: Icon, title, text, badge }: { active: boolean; onClick: () => void; icon: typeof Database; title: string; text: string; badge?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn("relative rounded-xl border p-4 text-left transition", active ? "border-primary bg-primary-soft ring-1 ring-primary" : "border-border hover:border-border-strong")}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Icon className={cn("size-5", active ? "text-primary" : "text-muted-foreground")} />
        {badge ? <Badge tone="success">{badge}</Badge> : null}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-[12px] leading-snug text-muted-foreground">{text}</div>
    </button>
  );
}

function Nav({ back, next, nextDisabled, hideBack }: { back: () => void; next: () => void; nextDisabled?: boolean; hideBack?: boolean }) {
  return (
    <div className="flex justify-between border-t border-border pt-4">
      {hideBack ? <span /> : (
        <Button variant="ghost" onClick={back}>
          <ArrowLeft /> Back
        </Button>
      )}
      <Button variant="primary" disabled={nextDisabled} onClick={next}>
        Continue <ArrowRight />
      </Button>
    </div>
  );
}
