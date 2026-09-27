"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

/** Shows one-shot messages passed through the URL by redirects (OAuth callbacks), then cleans the URL. */
export function Flash() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    const error = sp.get("error") ?? sp.get("connectError");
    const connected = sp.get("connected");
    if (!error && !connected) return;
    if (error) toast.error(error);
    if (connected) {
      const status = sp.get("status");
      if (status === "CONNECTED") toast.success(`${connected[0]!.toUpperCase()}${connected.slice(1)} connected and tested`);
      else toast.warning(`${connected[0]!.toUpperCase()}${connected.slice(1)} connected — action required (see the card)`);
    }
    const next = new URLSearchParams(sp.toString());
    for (const k of ["error", "connectError", "connected", "status"]) next.delete(k);
    router.replace(next.size ? `${path}?${next}` : path, { scroll: false });
  }, [sp, router, path]);
  return null;
}
