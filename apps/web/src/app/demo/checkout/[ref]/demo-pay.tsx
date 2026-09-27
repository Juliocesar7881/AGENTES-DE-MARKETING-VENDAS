"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { payDemoCheckout } from "@/server/actions/public";

export function DemoPay({ externalReference, status }: { externalReference: string; status: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(status === "PAID" ? "This checkout is already paid." : null);
  return (
    <div className="mt-5 grid gap-2">
      {result ? <p className="rounded-md bg-muted p-3 text-center text-sm">{result}</p> : null}
      <Button
        variant="primary"
        size="lg"
        loading={pending}
        disabled={status === "PAID" || Boolean(result)}
        onClick={() =>
          start(async () => {
            const r = await payDemoCheckout(externalReference, "APPROVED");
            setResult(r.ok ? (r.data.status === "processed" ? "Payment approved (demo). Revenue was attributed in the dashboard." : `Webhook ${r.data.status}: ${r.data.message}`) : r.error);
          })
        }
      >
        Pay with Pix (simulated)
      </Button>
      <Button
        variant="ghost"
        loading={pending}
        disabled={status === "PAID" || Boolean(result)}
        onClick={() =>
          start(async () => {
            const r = await payDemoCheckout(externalReference, "FAILED");
            setResult(r.ok ? "Payment failed (demo). No revenue recorded." : r.error);
          })
        }
      >
        Simulate a failed payment
      </Button>
    </div>
  );
}
