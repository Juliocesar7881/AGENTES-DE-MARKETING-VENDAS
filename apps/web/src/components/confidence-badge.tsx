import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";

const MAP = {
  LOW_DATA: { label: "Low data", tone: "neutral", tip: "Too few observations — do not draw conclusions yet." },
  PROMISING: { label: "Promising", tone: "info", tip: "Early signal. Keep testing before acting on it." },
  CONSISTENT: { label: "Consistent", tone: "primary", tip: "Repeated across several posts with a reasonable sample." },
  STRONG_EVIDENCE: { label: "Strong evidence", tone: "success", tip: "Large sample and statistically strong difference (still observational, not proof of causation)." },
} as const;

export function ConfidenceBadge({ level }: { level: string }) {
  const m = MAP[level as keyof typeof MAP] ?? MAP.LOW_DATA;
  return (
    <Tooltip content={m.tip}>
      <span>
        <Badge tone={m.tone}>{m.label}</Badge>
      </span>
    </Tooltip>
  );
}
