"use client";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { retryJobAction } from "@/server/actions/global";

export function RetryJobButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await retryJobAction(id);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
          router.refresh();
        })
      }
    >
      <RotateCcw /> Retry
    </Button>
  );
}
