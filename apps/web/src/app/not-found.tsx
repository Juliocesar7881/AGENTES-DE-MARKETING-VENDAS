import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-5xl font-semibold tracking-tight text-subtle">404</div>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">It may have been removed, or it belongs to a business you don&apos;t have access to.</p>
      <Link href="/overview" className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
        Back to dashboard
      </Link>
    </main>
  );
}
