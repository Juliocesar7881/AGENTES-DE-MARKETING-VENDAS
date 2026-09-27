"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches server components periodically (lists that change in the background). */
export function AutoRefresh({ ms = 15000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}
