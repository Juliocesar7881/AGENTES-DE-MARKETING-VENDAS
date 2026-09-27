import { Badge } from "@/components/ui/badge";
import { statusOf } from "@/lib/status";

export function StatusBadge({ map, value, className }: { map: Parameters<typeof statusOf>[0]; value: string | null | undefined; className?: string }) {
  const s = statusOf(map, value);
  return (
    <Badge tone={s.tone} className={className}>
      {s.label}
    </Badge>
  );
}
