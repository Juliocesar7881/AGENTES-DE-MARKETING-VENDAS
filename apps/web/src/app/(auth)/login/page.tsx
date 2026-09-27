import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getConfig, userCount } from "@revenueos/core";
import { needsInstall } from "@/server/install";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await needsInstall()) redirect("/install");
  let users = 1;
  let dbError: string | null = null;
  try {
    users = await userCount();
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-xl font-semibold tracking-[-0.02em]">Sign in to RevenueOS</h1>
      <p className="mt-1 text-sm text-muted-foreground">Run every business from one control plane.</p>
      {dbError ? (
        <div className="mt-6 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          The database is not reachable ({dbError}). If you use the built-in database, start RevenueOS with the launcher; otherwise check the database server.
        </div>
      ) : null}
      <LoginForm next={next} demoEnabled={getConfig().demoEnabled} />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {users === 0 ? (
          <>
            First time here?{" "}
            <Link href="/signup" className="font-medium text-primary hover:underline">
              Create the admin account
            </Link>
          </>
        ) : (
          <>
            New to RevenueOS?{" "}
            <Link href="/signup" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
