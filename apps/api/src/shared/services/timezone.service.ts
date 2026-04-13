/**
 * Timezone utilities for ShiftSync.
 *
 * All dates are stored as UTC in the database. This module converts between
 * UTC and location-specific local times, and handles availability window
 * checks correctly across DST transitions.
 *
 * Key decisions (see DECISIONS.md for full rationale):
 *   - Availability is stored as "wall-clock intent" ("I'm available 9am–5pm").
 *   - DST transitions are resolved at query time: we convert the shift's UTC
 *     startTime to the location's local time and compare.
 *   - A 9am–5pm window set in Pacific time is checked against the Pacific
 *     local time of the shift, not against a fixed UTC offset.
 *   - For cross-timezone staff (certified at PT + ET locations), we resolve
 *     availability against the shift's location timezone — not the staff
 *     member's "home" timezone (which doesn't exist in our model).
 */

import {
  format,
  parseISO,
  startOfDay,
  endOfDay,
  isSameDay,
  getDay,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

// ---------------------------------------------------------------------------
// Basic conversions
// ---------------------------------------------------------------------------

/**
 * Convert a UTC Date to the local Date representation in the given IANA timezone.
 * The returned Date object has its fields (hours, minutes, etc.) adjusted to
 * local time, but .toISOString() will not reflect the timezone offset.
 * Use formatInTimezone() for display.
 */
export function toLocalTime(utcDate: Date, timezone: string): Date {
  return toZonedTime(utcDate, timezone);
}

/**
 * Convert a local Date (expressed in the given timezone) to UTC.
 */
export function toUtcTime(localDate: Date, timezone: string): Date {
  return fromZonedTime(localDate, timezone);
}

/**
 * Format a UTC date for display in a given timezone.
 *
 * @example
 * formatInTimezone(new Date("2024-01-15T06:00:00Z"), "America/Los_Angeles", "h:mm a")
 * // => "10:00 PM" (if it were 2024-01-14)
 */
export function formatInTimezone(
  utcDate: Date,
  timezone: string,
  fmt: string,
): string {
  const localDate = toZonedTime(utcDate, timezone);
  return format(localDate, fmt);
}

/**
 * Get the day of week (0=Sun … 6=Sat) for a UTC date in the given timezone.
 * This correctly handles the "shift starts at 11pm UTC, but is midnight Monday
 * in Eastern time" case.
 */
export function getDayOfWeekLocal(utcDate: Date, timezone: string): number {
  return getDay(toZonedTime(utcDate, timezone));
}

/**
 * Get the calendar date string "YYYY-MM-DD" in the given timezone.
 */
export function getLocalDateString(utcDate: Date, timezone: string): string {
  return format(toZonedTime(utcDate, timezone), "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// Availability window checking
// ---------------------------------------------------------------------------

/**
 * Parse an "HH:MM" wall-clock time string to minutes-since-midnight.
 * "00:00" = 0, "24:00" = 1440 (end of day).
 */
export function parseTimeToMinutes(time: string): number {
  const [hours = "0", minutes = "0"] = time.split(":");
  return parseInt(hours, 10) * 60 + parseInt(minutes, 10);
}

/**
 * Determines whether a shift falls within an availability window.
 *
 * The availability window is stored as local wall-clock times (e.g. "09:00"–"17:00").
 * We convert the shift's UTC start/end times to the location's local time and
 * check if the entire shift falls within the window.
 *
 * DST handling: by converting UTC → local time at query time, we automatically
 * get the correct local hour regardless of whether it's standard or daylight time.
 *
 * Overnight windows (endTime < startTime, e.g. "21:00"–"03:00"):
 * These wrap across midnight. We handle them by checking if the shift start
 * is after the window's startTime OR before the window's endTime.
 *
 * @param shiftStartUtc - Shift start in UTC
 * @param shiftEndUtc   - Shift end in UTC
 * @param windowStart   - Availability window start "HH:MM"
 * @param windowEnd     - Availability window end "HH:MM"
 * @param timezone      - Location's IANA timezone
 */
export function isWithinAvailabilityWindow(
  shiftStartUtc: Date,
  shiftEndUtc: Date,
  windowStart: string,
  windowEnd: string,
  timezone: string,
): boolean {
  const localStart = toZonedTime(shiftStartUtc, timezone);
  const localEnd = toZonedTime(shiftEndUtc, timezone);

  const shiftStartMins =
    localStart.getHours() * 60 + localStart.getMinutes();
  const shiftEndMins = localEnd.getHours() * 60 + localEnd.getMinutes();

  const windowStartMins = parseTimeToMinutes(windowStart);
  const windowEndMins =
    windowEnd === "00:00" || windowEnd === "24:00"
      ? 1440
      : parseTimeToMinutes(windowEnd);

  const isOvernightWindow = windowEndMins <= windowStartMins;

  // For overnight shifts (endTime is on the next calendar day), we only check
  // that the shift start falls within the availability window. The end is on a
  // different date and will be covered by a separate window check if needed.
  const shiftIsOvernight = !isSameDay(localStart, localEnd);

  if (isOvernightWindow) {
    // Window wraps midnight: valid range is [windowStart, 24:00] ∪ [00:00, windowEnd]
    const startValid =
      shiftStartMins >= windowStartMins || shiftStartMins <= windowEndMins;
    if (shiftIsOvernight) return startValid;
    const endValid =
      shiftEndMins >= windowStartMins || shiftEndMins <= windowEndMins;
    return startValid && endValid;
  }

  // Normal window
  const startValid = shiftStartMins >= windowStartMins;
  if (shiftIsOvernight) return startValid;
  const endValid = shiftEndMins <= windowEndMins;
  return startValid && endValid;
}

// ---------------------------------------------------------------------------
// Premium shift detection
// ---------------------------------------------------------------------------

/**
 * A shift is "premium" (desirable) if it starts on Friday or Saturday evening
 * (defined as 5pm or later in the location's local time).
 */
export function isPremiumShift(utcStartTime: Date, timezone: string): boolean {
  const local = toZonedTime(utcStartTime, timezone);
  const dayOfWeek = local.getDay(); // 0=Sun … 6=Sat
  const hour = local.getHours();

  const isFridayOrSaturday = dayOfWeek === 5 || dayOfWeek === 6;
  const isEvening = hour >= 17;

  return isFridayOrSaturday && isEvening;
}

// ---------------------------------------------------------------------------
// Week boundary helpers
// ---------------------------------------------------------------------------

/**
 * Get the start of the ISO week (Monday 00:00:00 UTC) containing the given date.
 */
export function getWeekStartUtc(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of the ISO week (Sunday 23:59:59.999 UTC) containing the given date.
 */
export function getWeekEndUtc(date: Date): Date {
  const start = getWeekStartUtc(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/**
 * Get the start and end (UTC) of the week containing `date`, relative to a
 * specific timezone. This ensures a shift at "Sunday 11pm Pacific" is counted
 * in the correct Pacific week.
 */
export function getLocalWeekBounds(
  date: Date,
  timezone: string,
): { start: Date; end: Date } {
  const localDate = toZonedTime(date, timezone);
  const dayOfWeek = localDate.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const localMonday = new Date(localDate);
  localMonday.setDate(localMonday.getDate() + diff);
  localMonday.setHours(0, 0, 0, 0);

  const localSunday = new Date(localMonday);
  localSunday.setDate(localSunday.getDate() + 6);
  localSunday.setHours(23, 59, 59, 999);

  return {
    start: fromZonedTime(localMonday, timezone),
    end: fromZonedTime(localSunday, timezone),
  };
}
