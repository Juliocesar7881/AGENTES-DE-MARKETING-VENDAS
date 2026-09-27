import type { Metadata } from "next";
import Link from "next/link";
import { getConfig, userCount } from "@revenueos/core";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
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
          The database is not reachable. Check <code className="font-mono">DATABASE_URL</code> in <code className="font-mono">.env</code> and run <code className="font-mono">pnpm setup</code>.
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
