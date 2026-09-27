import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { userCount } from "@revenueos/core";
import { needsInstall } from "@/server/install";
import { SignUpForm } from "./signup-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  if (await needsInstall()) redirect("/install");
  const first = (await userCount().catch(() => 1)) === 0;
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-xl font-semibold tracking-[-0.02em]">{first ? "Create the admin account" : "Create your account"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {first ? "The first account administers integrations, AI settings and the local worker." : "You will create your first business right after."}
      </p>
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
