import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function money(cents: number | null | undefined, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: (cents ?? 0) % 100 === 0 ? 0 : 2 }).format((cents ?? 0) / 100);
}

export function num(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("pt-BR").format(n);
}

export function compact(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function pct(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function usd(n: number | null | undefined): string {
  return `$${(n ?? 0).toFixed((n ?? 0) < 1 ? 3 : 2)}`;
}

export function dateTime(d: Date | string | null | undefined, timeZone?: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(d));
}

export function dateOnly(d: Date | string | null | undefined, timeZone?: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone }).format(new Date(d));
}

export function timeOnly(d: Date | string | null | undefined, timeZone?: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(d));
}

export function ago(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const units: [number, string][] = [
    [60_000, "s"],
    [3_600_000, "min"],
    [86_400_000, "h"],
    [Infinity, "d"],
  ];
  let value: number;
  let unit: string;
  if (abs < 60_000) return future ? "in a moment" : "just now";
  if (abs < 3_600_000) [value, unit] = [Math.round(abs / 60_000), units[1]![1]];
  else if (abs < 86_400_000) [value, unit] = [Math.round(abs / 3_600_000), units[2]![1]];
  else [value, unit] = [Math.round(abs / 86_400_000), units[3]![1]];
  return future ? `in ${value}${unit}` : `${value}${unit} ago`;
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
