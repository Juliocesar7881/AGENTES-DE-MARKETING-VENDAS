"use client";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { decideApprovalAction } from "@/server/actions/global";

export function ApprovalButtons({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const decide = (d: "APPROVED" | "REJECTED") =>
    start(async () => {
      const note = d === "REJECTED" ? (prompt("Reason (optional)") ?? undefined) : undefined;
      const r = await decideApprovalAction(id, d, note);
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
      router.refresh();
    });
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="ghost" loading={pending} onClick={() => decide("REJECTED")}>
        <X /> Reject
      </Button>
      <Button size="sm" variant="success" loading={pending} onClick={() => decide("APPROVED")}>
        <Check /> Approve
      </Button>
    </div>
  );
}
