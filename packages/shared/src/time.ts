import { TZDate } from "@date-fns/tz";
import type { BusinessHours } from "./schemas/settings";

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Converts a wall-clock date + time in `tz` to the UTC instant. */
export function zonedToUtc(localDate: string, time: string, tz: string): Date {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, tz).getTime());
}

/** yyyy-MM-dd of the instant as seen in `tz`. */
export function localDateString(date: Date, tz: string): string {
  const z = new TZDate(date.getTime(), tz);
  return `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`;
}

/** HH:mm of the instant as seen in `tz`. */
export function localTimeString(date: Date, tz: string): string {
  const z = new TZDate(date.getTime(), tz);
  return `${pad(z.getHours())}:${pad(z.getMinutes())}`;
}

export function localHour(date: Date, tz: string): number {
  return new TZDate(date.getTime(), tz).getHours();
}

export function localWeekday(date: Date, tz: string): number {
  return new TZDate(date.getTime(), tz).getDay();
}

export function addLocalDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** UTC instant of local midnight for the local day containing `date`. */
export function startOfLocalDay(date: Date, tz: string): Date {
  return zonedToUtc(localDateString(date, tz), "00:00", tz);
}

export function endOfLocalDay(date: Date, tz: string): Date {
  return zonedToUtc(addLocalDays(localDateString(date, tz), 1), "00:00", tz);
}

export interface Slot {
  scheduledFor: Date;
  localDate: string;
  localTime: string;
}

/**
 * Generates the posting slots for `days` local days starting at the local day of `from`.
 * Slots in the past (<= from + minLeadMinutes) are skipped. Deterministic and idempotent:
 * the same inputs always produce the same instants, so they can be upserted safely.
 */
export function generateSlots(opts: {
  schedule: string[];
  timezone: string;
  from: Date;
  days: number;
  postsPerDay?: number;
  minLeadMinutes?: number;
}): Slot[] {
  const times = [...new Set(opts.schedule)].sort().slice(0, opts.postsPerDay ?? opts.schedule.length);
  const threshold = opts.from.getTime() + (opts.minLeadMinutes ?? 0) * 60_000;
  const today = localDateString(opts.from, opts.timezone);
  const out: Slot[] = [];
  for (let i = 0; i < opts.days; i++) {
    const day = addLocalDays(today, i);
    for (const t of times) {
      const at = zonedToUtc(day, t, opts.timezone);
      if (at.getTime() > threshold) out.push({ scheduledFor: at, localDate: day, localTime: t });
    }
  }
  return out.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
}

function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export function isWithinBusinessHours(date: Date, tz: string, bh: BusinessHours): boolean {
  if (!bh.enabled) return true;
  const z = new TZDate(date.getTime(), tz);
  if (!bh.days.includes(z.getDay())) return false;
  const now = z.getHours() * 60 + z.getMinutes();
  return now >= minutesOf(bh.start) && now < minutesOf(bh.end);
}

/** Next instant (>= date) that falls inside business hours. */
export function nextBusinessHoursStart(date: Date, tz: string, bh: BusinessHours): Date {
  if (isWithinBusinessHours(date, tz, bh)) return date;
  const today = localDateString(date, tz);
  for (let i = 0; i < 8; i++) {
    const day = addLocalDays(today, i);
    const open = zonedToUtc(day, bh.start, tz);
    if (open.getTime() >= date.getTime() && bh.days.includes(localWeekday(open, tz))) return open;
  }
  return date;
}

export function formatInTz(date: Date | string, tz: string, opts: Intl.DateTimeFormatOptions = {}, locale = "pt-BR"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { timeZone: tz, dateStyle: "short", timeStyle: "short", ...opts }).format(d);
}
