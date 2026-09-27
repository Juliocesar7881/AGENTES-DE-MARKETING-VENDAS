"use client";
import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delayDuration={250}>{children}</T.Provider>;
}

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  if (!content) return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 max-w-72 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-foreground shadow-pop data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
