"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyField({ label, value, secretLike }: { label: string; value: string; secretLike?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{secretLike ? `${value.slice(0, 6)}…${value.slice(-4)}` : value}</code>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Copy ${label}`}
          onClick={() =>
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}
