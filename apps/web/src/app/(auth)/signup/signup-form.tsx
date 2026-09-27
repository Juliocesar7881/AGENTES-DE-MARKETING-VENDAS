"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { signUpAction } from "@/server/actions/auth";

export function SignUpForm() {
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-6 grid gap-3"
      action={(fd) =>
        start(async () => {
          setError(null);
          setFieldErrors({});
          const r = await signUpAction({ name: String(fd.get("name") ?? ""), email: String(fd.get("email") ?? ""), password: String(fd.get("password") ?? "") });
          if (r && !r.ok) {
            setError(r.error);
            setFieldErrors(r.fieldErrors ?? {});
          }
        })
      }
    >
      <Field label="Name" htmlFor="name" error={fieldErrors.name}>
        <Input id="name" name="name" autoComplete="name" required />
      </Field>
      <Field label="E-mail" htmlFor="email" error={fieldErrors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" error={fieldErrors.password} hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      {error && !Object.keys(fieldErrors).length ? <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      <Button type="submit" variant="primary" loading={pending} className="mt-1 w-full">
        Create account
      </Button>
    </form>
  );
}
