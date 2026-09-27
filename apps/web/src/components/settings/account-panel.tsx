"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, Input } from "@/components/ui/input";
import { changePasswordAction, updateProfileAction } from "@/server/actions/connections";
import { SettingsSection } from "./section";

export function AccountPanel({ name, email, isDemo }: { name: string; email: string; isDemo: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [n, setN] = useState(name);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SettingsSection
        title="Profile"
        onSave={() =>
          start(async () => {
            const r = await updateProfileAction(n);
            if (r.ok) toast.success(r.message);
            else toast.error(r.error);
            router.refresh();
          })
        }
        pending={pending}
        dirty={n !== name && !isDemo}
      >
        <Field label="Name">
          <Input value={n} onChange={(e) => setN(e.target.value)} disabled={isDemo} />
        </Field>
        <Field label="E-mail">
          <Input value={email} disabled />
        </Field>
      </SettingsSection>
      {!isDemo ? (
        <SettingsSection
          title="Password"
          onSave={() =>
            start(async () => {
              const r = await changePasswordAction(cur, next);
              if (r.ok) {
                toast.success(r.message);
                setCur("");
                setNext("");
              } else toast.error(r.error);
            })
          }
          pending={pending}
          dirty={Boolean(cur && next.length >= 10)}
        >
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
          </Field>
          <Field label="New password" hint="At least 10 characters">
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
        </SettingsSection>
      ) : null}
    </div>
  );
}
