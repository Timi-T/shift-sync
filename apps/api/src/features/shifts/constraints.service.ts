/**
 * Scheduling Constraint Engine.
 *
 * This is the most critical module in ShiftSync. It enforces all rules
 * before an assignment is created. Every check is explicit and returns a
 * structured violation with a human-readable explanation.
 *
 * Rules enforced (in order):
 *   1. Location certification      — staff must be certified at the shift's location
 *   2. Skill match                 — staff must hold the shift's required skill
 *   3. Availability                — shift must fall within staff's availability windows
 *   4. Double-booking              — staff cannot have overlapping shifts
 *   5. Minimum rest (10 hours)     — must be 10h between end of previous shift and start of next
 *   6. Daily hours warning (8h)    — warn if a single shift exceeds 8 hours
 *   7. Daily hours hard block (12h)— reject if total scheduled hours in a day exceed 12
 *   8. Weekly hours warning (35h+) — warn when approaching 40h/week
 *   9. 6th consecutive day         — warn
 *  10. 7th consecutive day         — hard block (requires manager override)
 *
 * The function returns { valid, violations, warnings, suggestions }.
 * Callers must check `valid` before persisting the assignment.
 */

import type { Prisma } from "@prisma/client";
import { differenceInHours, differenceInMinutes, isSameDay } from "date-fns";
import { prisma } from "@/shared/lib/prisma.js";
import { getWeekStartUtc, getWeekEndUtc, isWithinAvailabilityWindow, toLocalTime } from "@/shared/services/timezone.service.js";
import type {
  ConstraintCheckResult,
  ConstraintViolation,
  ConstraintWarning,
} from "@shift-sync/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShiftWithLocation {
  id: string;
  locationId: string;
  skillId: string;
  startTime: Date;
  endTime: Date;
  location: { timezone: string; name: string };
  skill: { name: string };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run all scheduling constraints for a proposed assignment.
 *
 * @param userId    - The staff member being assigned
 * @param shiftId   - The shift they're being assigned to
 * @param overrideReason - Manager-provided reason to bypass 7th-day block
 * @param excludeAssignmentId - Assignment ID to exclude (used during swap checks)
 */
export async function checkConstraints(
  userId: string,
  shiftId: string,
  overrideReason?: string,
  excludeAssignmentId?: string,
): Promise<ConstraintCheckResult> {
  const violations: ConstraintViolation[] = [];
  const warnings: ConstraintWarning[] = [];

  // Load the target shift with related data
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: { location: true, skill: true },
  });

  // Load the staff member with all relevant relations
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      skills: { include: { skill: true } },
      locationCertifications: true,
      availability: true,
    },
  });

  // ── Rule 1: Location certification ───────────────────────────────────────
  const isCertified = user.locationCertifications.some(
    (c) => c.locationId === shift.locationId,
  );
  if (!isCertified) {
    violations.push({
      code: "LOCATION_NOT_CERTIFIED",
      message: `${user.name} is not certified to work at ${shift.location.name}`,
      detail: `Staff members must be certified for a location before they can be assigned to shifts there. ${user.name} does not have an active certification for ${shift.location.name}. An admin or manager can grant this certification in the staff management panel.`,
    });
  }

  // ── Rule 2: Skill match ───────────────────────────────────────────────────
  const hasSkill = user.skills.some((us) => us.skillId === shift.skillId);
  if (!hasSkill) {
    violations.push({
      code: "SKILL_MISMATCH",
      message: `${user.name} does not have the "${shift.skill.name}" skill`,
      detail: `This shift requires a ${shift.skill.name}. ${user.name}'s current skills are: ${user.skills.map((s) => s.skill.name).join(", ") || "none listed"
        }. Skills can be updated in the staff profile.`,
    });
  }

  // ── Rule 3: Availability ─────────────────────────────────────────────────
  const availabilityViolation = checkAvailability(user.availability, shift);
  if (availabilityViolation) {
    violations.push(availabilityViolation);
  }

  // Load existing assignments for overlap, rest, and consecutive-day checks
  const existingAssignments = await getExistingAssignments(userId, excludeAssignmentId);

  // ── Rule 4: Double-booking ────────────────────────────────────────────────
  const overlap = findOverlap(existingAssignments, shift);
  if (overlap) {
    violations.push({
      code: "DOUBLE_BOOKED",
      message: `${user.name} is already assigned to another shift during this time`,
      detail: `${user.name} has a shift at ${overlap.shift.location.name} from ${formatShiftTime(overlap.shift, shift.location.timezone)} that overlaps with this assignment. A staff member cannot be in two places at once.`,
    });
  }

  // ── Rule 5: Minimum rest (10 hours) ──────────────────────────────────────
  const restViolation = checkMinimumRest(existingAssignments, shift, user.name);
  if (restViolation) {
    violations.push(restViolation);
  }

  // ── Rules 6–7: Daily hours ────────────────────────────────────────────────
  const dailyChecks = checkDailyHours(
    existingAssignments.map((asg) => ({ startTime: asg.shift.startTime, endTime: asg.shift.endTime })),
    shift,
    shift.location.timezone,
    user.name
  );
  violations.push(...dailyChecks.violations);
  warnings.push(...dailyChecks.warnings);

  // ── Rules 8: Weekly hours warning ────────────────────────────────────────
  const weeklyWarning = await checkWeeklyHours(
    userId, shift,
    existingAssignments.map((asg) => ({ startTime: asg.shift.startTime, endTime: asg.shift.endTime })),
    user.name
  );
  if (weeklyWarning) warnings.push(weeklyWarning);

  // ── Rules 9–10: Consecutive days ─────────────────────────────────────────
  const consecutiveChecks = checkConsecutiveDays(
    existingAssignments.map((asg) => ({ startTime: asg.shift.startTime, endTime: asg.shift.endTime })),
    shift,
    shift.location.timezone,
    user.name,
    overrideReason
  );
  violations.push(...consecutiveChecks.violations);
  warnings.push(...consecutiveChecks.warnings);

  const valid = violations.length === 0;

  // Only fetch suggestions if there are violations — they're expensive.
  const suggestions = valid
    ? []
    : await findSuggestions(shift, userId, violations);

  return { valid, violations, warnings, suggestions };
}

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

function checkAvailability(
  availability: Prisma.AvailabilityWindowGetPayload<object>[],
  shift: ShiftWithLocation,
): ConstraintViolation | null {
  if (availability.length === 0) {
    // No windows set = no availability restrictions (open availability)
    return null;
  }

  const shiftDayOfWeek = toLocalTime(shift.startTime, shift.location.timezone).getDay();
  const shiftDateStr = toLocalTime(shift.startTime, shift.location.timezone)
    .toISOString()
    .slice(0, 10);

  // Check EXCEPTION windows first — they take precedence over RECURRING.
  const exceptions = availability.filter((w) => {
    if (w.type !== "EXCEPTION") return false;
    if (!w.date) return false;
    // Compare calendar dates in the location timezone
    const windowDateStr = w.date.toISOString().slice(0, 10);
    return windowDateStr === shiftDateStr;
  });

  if (exceptions.length > 0) {
    // Use the most relevant exception
    const exception = exceptions[0]!;
    if (!exception.available) {
      return {
        code: "UNAVAILABLE",
        message: "Staff member has marked themselves unavailable on this date",
        detail: `This staff member has set a specific unavailability exception for ${shiftDateStr}. They cannot be assigned to shifts on this day unless the exception is removed.`,
      };
    }
    // Exception says available — check if shift falls within the exception window
    const withinException = isWithinAvailabilityWindow(
      shift.startTime,
      shift.endTime,
      exception.startTime,
      exception.endTime,
      shift.location.timezone,
    );
    if (!withinException) {
      return {
        code: "UNAVAILABLE",
        message: `Staff member's availability exception on ${shiftDateStr} doesn't cover this shift's hours`,
        detail: `The availability exception for ${shiftDateStr} is ${exception.startTime}–${exception.endTime} (${shift.location.timezone}). The shift runs outside these hours.`,
      };
    }
    return null; // Exception covers this shift
  }

  // No exceptions — check RECURRING windows for this day of week.
  const recurringWindows = availability.filter(
    (w) =>
      w.type === "RECURRING" &&
      w.dayOfWeek === shiftDayOfWeek &&
      isRecurringActive(w, shift.startTime),
  );

  if (recurringWindows.length === 0) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return {
      code: "UNAVAILABLE",
      message: `Staff member has no availability set for ${dayNames[shiftDayOfWeek]}s`,
      detail: `This staff member has not set any recurring availability for ${dayNames[shiftDayOfWeek]}s. They can update their availability in the staff portal.`,
    };
  }

  // Check if ANY recurring window covers the shift.
  const coveringWindow = recurringWindows.find((w) =>
    isWithinAvailabilityWindow(
      shift.startTime,
      shift.endTime,
      w.startTime,
      w.endTime,
      shift.location.timezone,
    ),
  );

  if (!coveringWindow) {
    const windows = recurringWindows
      .map((w) => `${w.startTime}–${w.endTime}`)
      .join(", ");
    return {
      code: "UNAVAILABLE",
      message: "Shift falls outside staff member's available hours",
      detail: `The shift runs ${formatUtcRange(shift.startTime, shift.endTime, shift.location.timezone)} (${shift.location.timezone}). This staff member's availability for that day is: ${windows}. The shift must fall entirely within an availability window.`,
    };
  }

  return null;
}

function isRecurringActive(
  window: Prisma.AvailabilityWindowGetPayload<object>,
  shiftDate: Date,
): boolean {
  if (window.effectiveFrom && shiftDate < window.effectiveFrom) return false;
  if (window.effectiveTo && shiftDate > window.effectiveTo) return false;
  return true;
}

function findOverlap(
  existing: Array<{ shift: { startTime: Date; endTime: Date; location: { name: string; timezone: string } } }>,
  proposed: ShiftWithLocation,
): (typeof existing)[number] | null {
  return (
    existing.find(
      (e) => e.shift.startTime < proposed.endTime && e.shift.endTime > proposed.startTime,
    ) ?? null
  );
}

function checkMinimumRest(
  existing: Array<{ shift: { startTime: Date; endTime: Date; location: { name: string } } }>,
  proposed: ShiftWithLocation,
  staffName: string,
): ConstraintViolation | null {
  const MIN_REST_HOURS = 10;

  for (const e of existing) {
    // Check gap between end of existing and start of proposed
    const shift = e.shift;
    const gapAfterExisting = differenceInHours(proposed.startTime, shift.endTime);
    if (gapAfterExisting >= 0 && gapAfterExisting < MIN_REST_HOURS) {
      return {
        code: "INSUFFICIENT_REST",
        message: `${staffName} would have only ${gapAfterExisting}h between shifts (minimum is ${MIN_REST_HOURS}h)`,
        detail: `${staffName}'s shift at ${shift.location.name} ends at ${formatTime(shift.endTime)}. The proposed shift starts at ${formatTime(proposed.startTime)}, leaving only ${gapAfterExisting} hour(s) of rest. Staff must have at least ${MIN_REST_HOURS} hours between the end of one shift and the start of the next.`,
      };
    }

    // Check gap between end of proposed and start of existing
    const gapAfterProposed = differenceInHours(shift.startTime, proposed.endTime);
    if (gapAfterProposed >= 0 && gapAfterProposed < MIN_REST_HOURS) {
      return {
        code: "INSUFFICIENT_REST",
        message: `${staffName} would have only ${gapAfterProposed}h of rest before their next shift (minimum is ${MIN_REST_HOURS}h)`,
        detail: `The proposed shift ends at ${formatTime(proposed.endTime)}. ${staffName}'s next shift at ${shift.location.name} starts at ${formatTime(shift.startTime)}, leaving only ${gapAfterProposed} hour(s) of rest.`,
      };
    }
  }

  return null;
}

function checkDailyHours(
  existing: Array<{ startTime: Date; endTime: Date }>,
  proposed: ShiftWithLocation,
  timezone: string,
  staffName: string,
): { violations: ConstraintViolation[]; warnings: ConstraintWarning[] } {
  const violations: ConstraintViolation[] = [];
  const warnings: ConstraintWarning[] = [];

  const proposedDurationHours =
    differenceInMinutes(proposed.endTime, proposed.startTime) / 60;

  // Warn if a single shift exceeds 8 hours
  if (proposedDurationHours > 8) {
    warnings.push({
      code: "DAILY_HOURS_WARNING",
      message: `This shift is ${proposedDurationHours.toFixed(1)}h long (over 8h daily guideline)`,
      detail: `Shifts exceeding 8 hours in a single day require manager attention for scheduling equity. This is a warning, not a block.`,
    });
  }

  // Hard block: total scheduled hours on the same day > 12
  const proposedLocalDay = toLocalTime(proposed.startTime, timezone);
  const sameDayShifts = existing.filter((e) =>
    isSameDay(toLocalTime(e.startTime, timezone), proposedLocalDay),
  );

  const existingDayHours = sameDayShifts.reduce(
    (total, e) => total + differenceInMinutes(e.endTime, e.startTime) / 60,
    0,
  );

  const totalDayHours = existingDayHours + proposedDurationHours;

  if (totalDayHours > 12) {
    violations.push({
      code: "DAILY_HOURS_HARD_BLOCK",
      message: `${staffName} would work ${totalDayHours.toFixed(1)} hours in a single day (maximum is 12h)`,
      detail: `${staffName} already has ${existingDayHours.toFixed(1)} hours scheduled on this day. Adding this ${proposedDurationHours.toFixed(1)}h shift would bring the total to ${totalDayHours.toFixed(1)} hours. The maximum allowed per day is 12 hours.`,
    });
  }

  return { violations, warnings };
}

async function checkWeeklyHours(
  userId: string,
  shift: ShiftWithLocation,
  existing: Array<{ startTime: Date; endTime: Date }>,
  staffName: string,
): Promise<ConstraintWarning | null> {
  const weekStart = getWeekStartUtc(shift.startTime);
  const weekEnd = getWeekEndUtc(shift.startTime);

  const weekShifts = existing.filter(
    (e) => e.startTime >= weekStart && e.startTime <= weekEnd,
  );

  const existingWeekHours = weekShifts.reduce(
    (total, e) => total + differenceInMinutes(e.endTime, e.startTime) / 60,
    0,
  );

  const proposedHours = differenceInMinutes(shift.endTime, shift.startTime) / 60;
  const totalWeekHours = existingWeekHours + proposedHours;

  if (totalWeekHours >= 35 && totalWeekHours < 40) {
    return {
      code: "WEEKLY_HOURS_WARNING",
      message: `${staffName} will have ${totalWeekHours.toFixed(1)} projected hours this week`,
      detail: `${staffName} already has ${existingWeekHours.toFixed(1)} scheduled hours this week. This assignment would bring them to ${totalWeekHours.toFixed(1)} hours, approaching the 40-hour overtime threshold. Review their schedule before adding more shifts.`,
    };
  }

  if (totalWeekHours >= 40) {
    return {
      code: "WEEKLY_HOURS_WARNING",
      message: `⚠ ${staffName} will exceed 40 hours this week (${totalWeekHours.toFixed(1)}h projected)`,
      detail: `${staffName} already has ${existingWeekHours.toFixed(1)} scheduled hours this week. This shift would bring them to ${totalWeekHours.toFixed(1)} hours — ${(totalWeekHours - 40).toFixed(1)} hours of overtime. This is a warning; you can still proceed if overtime is approved.`,
    };
  }

  return null;
}

function checkConsecutiveDays(
  existing: Array<{ startTime: Date; endTime: Date }>,
  proposed: ShiftWithLocation,
  timezone: string,
  staffName: string,
  overrideReason?: string,
): { violations: ConstraintViolation[]; warnings: ConstraintWarning[] } {
  const violations: ConstraintViolation[] = [];
  const warnings: ConstraintWarning[] = [];

  // Build a set of worked dates (local calendar days in the location timezone).
  const workedDays = new Set<string>();

  for (const e of existing) {
    const localDate = toLocalTime(e.startTime, timezone);
    workedDays.add(localDate.toISOString().slice(0, 10));
  }

  const proposedLocalDate = toLocalTime(proposed.startTime, timezone);
  const proposedDateStr = proposedLocalDate.toISOString().slice(0, 10);

  // If this day is already counted, adding it doesn't change the streak.
  if (workedDays.has(proposedDateStr)) return { violations, warnings };

  // Count how many consecutive days end at (and including) the proposed date.
  let consecutiveCount = 1;
  const checkDate = new Date(proposedLocalDate);

  for (let i = 1; i <= 7; i++) {
    checkDate.setDate(checkDate.getDate() - 1);
    const dateStr = checkDate.toISOString().slice(0, 10);
    if (workedDays.has(dateStr)) {
      consecutiveCount++;
    } else {
      break;
    }
  }

  if (consecutiveCount === 6) {
    warnings.push({
      code: "SIXTH_CONSECUTIVE_DAY",
      message: `${staffName} would work 6 consecutive days`,
      detail: `${staffName} has worked or is scheduled every day for the past 5 days. This assignment would make it 6 consecutive days. Review their schedule for adequate rest.`,
    });
  }

  if (consecutiveCount >= 7) {
    if (overrideReason) {
      // Manager explicitly acknowledged and provided a reason — allow it.
      warnings.push({
        code: "SEVENTH_CONSECUTIVE_DAY",
        message: `Manager override applied: ${staffName} will work 7+ consecutive days`,
        detail: `Override reason: "${overrideReason}"`,
      });
    } else {
      violations.push({
        code: "SEVENTH_CONSECUTIVE_DAY",
        message: `${staffName} would work their 7th consecutive day — manager override required`,
        detail: `Labor regulations require a documented manager override to schedule a 7th consecutive day. Resubmit with an override reason to proceed. This will be logged in the audit trail.`,
      });
    }
  }

  return { violations, warnings };
}

// ---------------------------------------------------------------------------
// Suggestions engine
// ---------------------------------------------------------------------------

/**
 * When an assignment is blocked by constraints, find alternative staff members
 * who could fill the shift — and explain why each one qualifies.
 */
async function findSuggestions(
  shift: ShiftWithLocation,
  excludedUserId: string,
  violations: ConstraintViolation[],
) {
  // Only suggest alternatives if the block is about THIS person's constraints,
  // not about the shift itself being invalid.
  const shiftLevelCodes: string[] = []; // None currently block at shift level
  if (violations.every((v) => shiftLevelCodes.includes(v.code))) return [];

  // Find staff who have the required skill + location certification
  const candidates = await prisma.user.findMany({
    where: {
      id: { not: excludedUserId },
      role: "STAFF",
      skills: { some: { skillId: shift.skillId } },
      locationCertifications: { some: { locationId: shift.locationId } },
    },
    include: {
      availability: true,
      skills: { include: { skill: true } },
      locationCertifications: true,
    },
    take: 10,
  });

  const suggestions = [];

  for (const candidate of candidates) {
    const caveats: string[] = [];

    // Check availability
    const availViolation = checkAvailability(candidate.availability, shift);
    if (availViolation) {
      caveats.push(`Availability: ${availViolation.message}`);
    }

    // Check for double-booking
    const existingAssignments = await getExistingAssignments(candidate.id);
    const overlap = findOverlap(existingAssignments, shift);
    if (overlap) {
      caveats.push(`Already assigned to a shift at ${overlap.shift.location.name} during this time`);
    }

    // Check rest requirement
    const restViolation = checkMinimumRest(existingAssignments, shift, candidate.name);
    if (restViolation) {
      caveats.push(restViolation.message);
    }

    suggestions.push({
      userId: candidate.id,
      name: candidate.name,
      reason: `Has "${shift.skill.name}" skill and is certified at ${shift.location.name}`,
      caveats,
    });
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

async function getExistingAssignments(userId: string, excludeId?: string) {
  return prisma.shiftAssignment.findMany({
    where: {
      userId,
      id: excludeId ? { not: excludeId } : undefined,
      status: { not: "CANCELLED" },
      shift: { status: { not: "CANCELLED" } },
    },
    select: {
      shift: {
        select: {
          startTime: true,
          endTime: true,
          location: { select: { name: true, timezone: true } },
        },
      },
    },
    /* include: {
      shift: {
        include: { location: true },
      },
    },
    select: {
      id: true,
      shift: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          location: { select: { name: true, timezone: true } },
        },
      },
    }, */
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatTime(utcDate: Date): string {
  return utcDate.toISOString().replace("T", " ").replace(/\..*/, "") + " UTC";
}

function formatShiftTime(
  shift: { startTime: Date; endTime: Date },
  _timezone: string,
): string {
  return `${formatTime(shift.startTime)} – ${formatTime(shift.endTime)}`;
}

function formatUtcRange(start: Date, end: Date, timezone: string): string {
  const localStart = toLocalTime(start, timezone);
  const localEnd = toLocalTime(end, timezone);
  const fmt = (d: Date) =>
    `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  return `${fmt(localStart)}–${fmt(localEnd)}`;
}
