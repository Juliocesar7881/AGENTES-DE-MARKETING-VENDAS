"use client";
import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { demoAction, loginAction } from "@/server/actions/auth";

export function LoginForm({ next, demoEnabled }: { next?: string; demoEnabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [demoPending, startDemo] = useTransition();
  return (
    <div className="mt-6 grid gap-4">
      {demoEnabled ? (
        <>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            loading={demoPending}
            onClick={() =>
              startDemo(async () => {
                setError(null);
                const r = await demoAction();
                if (r && !r.ok) setError(r.error);
              })
            }
          >
            <Sparkles /> Explore Demo
          </Button>
          <p className="-mt-2 text-center text-xs text-muted-foreground">3 demo businesses with simulated data — nothing is published for real.</p>
          <div className="flex items-center gap-3 text-xs text-subtle">
            <div className="h-px flex-1 bg-border" /> or sign in <div className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}
      <form
        className="grid gap-3"
        action={(fd) =>
          start(async () => {
            setError(null);
            const r = await loginAction({ email: String(fd.get("email") ?? ""), password: String(fd.get("password") ?? ""), next });
            if (r && !r.ok) setError(r.error);
          })
        }
      >
        <Field label="E-mail" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        {error ? <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
        <Button type="submit" variant={demoEnabled ? "secondary" : "primary"} loading={pending} className="w-full">
          Sign in
        </Button>
      </form>
    </div>
  );
}
