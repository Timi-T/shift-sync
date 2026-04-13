import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a UTC Date as a localized time string in the given timezone. */
export function formatLocalTime(utcDate: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(new Date(utcDate));
}

/** Format a UTC Date as "Mon Jan 20" in the given timezone. */
export function formatLocalDate(utcDate: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).format(new Date(utcDate));
}

/** Return "Xh Ym" from two UTC dates. */
export function formatDuration(start: Date | string, end: Date | string): string {
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  const totalMinutes = Math.round(diffMs / 60_000);
  const hours   = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Given a date, return the ISO date string (YYYY-MM-DD) in a given timezone. */
export function toLocalDateString(utcDate: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(utcDate));
}

/** True if the shift starts on a Friday or Saturday after 5pm local time (premium). */
export function isPremiumShift(utcStart: Date | string, timezone: string): boolean {
  const d = new Date(utcStart);
  const dow   = Number(new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone }).format(d).slice(0, 3) === "Fri" ? 5 : new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: timezone }).format(d) === "S" ? 6 : -1);
  const hour  = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone }).format(d));
  const dayAbbr = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone }).format(d);
  return (dayAbbr === "Fri" || dayAbbr === "Sat") && hour >= 17;
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Pluralise a noun — "1 shift" / "2 shifts". */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
