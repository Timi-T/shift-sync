/**
 * Overtime & Labor Law Compliance Service.
 *
 * Computes projected overtime costs and generates warnings for a given week
 * and set of staff assignments. Used by:
 *   - The analytics dashboard (GET /analytics/overtime)
 *   - The "what-if" endpoint (POST /assignments/preview) before committing
 *
 * Labor rules enforced (matching the constraint engine's thresholds):
 *   - 35+ hours/week → APPROACHING_40H warning
 *   - 40+ hours/week → OVER_40H warning
 *   - Single shift > 8 hours → DAILY_8H warning
 *   - Total day hours > 12 → DAILY_12H_HARD_BLOCK
 *   - 6th consecutive day → SIXTH_CONSECUTIVE_DAY warning
 *   - 7th consecutive day → SEVENTH_CONSECUTIVE_DAY_HARD_BLOCK
 */

import { differenceInMinutes } from "date-fns";
import { prisma } from "@/shared/lib/prisma.js";
import { getWeekStartUtc, getWeekEndUtc, toLocalTime } from "@/shared/services/timezone.service.js";
import type { OvertimeProjection, OvertimeWarning } from "@shift-sync/shared";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute overtime projections for all staff active in a given week.
 *
 * @param weekStart - Any Date within the target week (UTC)
 * @param locationId - Filter to a specific location (optional)
 */
export async function getOvertimeProjections(
  weekStart: Date,
  locationId?: string,
): Promise<OvertimeProjection[]> {
  const start = getWeekStartUtc(weekStart);
  const end = getWeekEndUtc(weekStart);

  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      status: { not: "CANCELLED" },
      shift: {
        status: { not: "CANCELLED" },
        startTime: { gte: start, lte: end },
        ...(locationId ? { locationId } : {}),
      },
    },
    include: {
      user: { select: { id: true, name: true } },
      shift: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          location: { select: { timezone: true } },
        },
      },
    },
    orderBy: { shift: { startTime: "asc" } },
  });

  const byUser = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = byUser.get(a.userId) ?? [];
    list.push(a);
    byUser.set(a.userId, list);
  }

  const projections: OvertimeProjection[] = [];

  for (const [userId, userAssignments] of byUser.entries()) {
    const user = userAssignments[0]!.user;
    const shifts = userAssignments.map((a) => a.shift);
    const tz = shifts[0]?.location.timezone ?? "UTC";

    const projection = computeProjection(userId, user.name, shifts, tz);
    projections.push(projection);
  }

  return projections.sort((a, b) => b.overtimeHours - a.overtimeHours);
}

/**
 * Preview the overtime impact of assigning an additional shift.
 * Returns the updated projection without persisting anything.
 */
export async function previewOvertimeImpact(
  userId: string,
  shiftId: string,
): Promise<OvertimeProjection> {
  const proposedShift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: { location: true },
  });

  const weekStart = getWeekStartUtc(proposedShift.startTime);
  const weekEnd = getWeekEndUtc(proposedShift.startTime);

  const existingAssignments = await prisma.shiftAssignment.findMany({
    where: {
      userId,
      status: { not: "CANCELLED" },
      shift: {
        status: { not: "CANCELLED" },
        startTime: { gte: weekStart, lte: weekEnd },
      },
    },
    include: {
      shift: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          location: { select: { timezone: true } },
        },
      },
    },
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true },
  });

  const allShifts = [
    ...existingAssignments.map((a) => a.shift),
    {
      id: proposedShift.id,
      startTime: proposedShift.startTime,
      endTime: proposedShift.endTime,
      location: { timezone: proposedShift.location.timezone },
    },
  ];

  return computeProjection(userId, user.name, allShifts, proposedShift.location.timezone);
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

type ShiftInfo = {
  id: string;
  startTime: Date;
  endTime: Date;
  location: { timezone: string };
};

function computeProjection(
  userId: string,
  name: string,
  shifts: ShiftInfo[],
  timezone: string,
  desiredHoursPerWeek: number | null = null,
): OvertimeProjection {
  const warnings: OvertimeWarning[] = [];
  const overtimeAssignments: OvertimeProjection["overtimeAssignments"] = [];

  const totalHours = shifts.reduce(
    (sum, s) => sum + differenceInMinutes(s.endTime, s.startTime) / 60,
    0,
  );

  const overtimeHours = Math.max(0, totalHours - 40);

  if (totalHours >= 35 && totalHours < 40) {
    warnings.push({
      type: "APPROACHING_40H",
      severity: "warning",
      message: `Projected at ${totalHours.toFixed(1)}h this week — approaching overtime threshold`,
    });
  }

  if (totalHours >= 40) {
    warnings.push({
      type: "OVER_40H",
      severity: "warning",
      message: `Projected at ${totalHours.toFixed(1)}h this week — ${overtimeHours.toFixed(1)}h overtime`,
    });

    let runningHours = 0;
    for (const shift of [...shifts].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    )) {
      const shiftHours = differenceInMinutes(shift.endTime, shift.startTime) / 60;
      const previousHours = runningHours;
      runningHours += shiftHours;

      if (runningHours > 40) {
        const overtimeContribution = runningHours - Math.max(40, previousHours);
        overtimeAssignments.push({
          shiftId: shift.id,
          startTime: shift.startTime.toISOString(),
          endTime: shift.endTime.toISOString(),
          durationHours: shiftHours,
          overtimeContribution,
        });
      }
    }
  }

  for (const shift of shifts) {
    const hours = differenceInMinutes(shift.endTime, shift.startTime) / 60;
    if (hours > 12) {
      warnings.push({
        type: "DAILY_12H_HARD_BLOCK",
        severity: "hard_block",
        message: `Single shift exceeds 12 hours (${hours.toFixed(1)}h)`,
        affectedDate: shift.startTime.toISOString().slice(0, 10),
        affectedShiftId: shift.id,
      });
    } else if (hours > 8) {
      warnings.push({
        type: "DAILY_8H",
        severity: "warning",
        message: `Single shift exceeds 8 hours (${hours.toFixed(1)}h)`,
        affectedDate: shift.startTime.toISOString().slice(0, 10),
        affectedShiftId: shift.id,
      });
    }
  }

  const workedDays = new Set(
    shifts.map((s) =>
      toLocalTime(s.startTime, timezone).toISOString().slice(0, 10),
    ),
  );

  const maxStreak = computeMaxConsecutiveStreak(workedDays);

  if (maxStreak >= 7) {
    warnings.push({
      type: "SEVENTH_CONSECUTIVE_DAY_HARD_BLOCK",
      severity: "hard_block",
      message: "Scheduled for 7+ consecutive days — manager override required",
    });
  } else if (maxStreak === 6) {
    warnings.push({
      type: "SIXTH_CONSECUTIVE_DAY",
      severity: "warning",
      message: "Scheduled for 6 consecutive days",
    });
  }

  return {
    userId,
    name,
    currentWeekHours: totalHours,
    overtimeHours,
    desiredHoursPerWeek,
    warnings,
    overtimeAssignments,
  };
}

function computeMaxConsecutiveStreak(workedDays: Set<string>): number {
  if (workedDays.size === 0) return 0;

  const sorted = Array.from(workedDays).sort();
  let maxStreak = 1;
  let currentStreak = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]!);
    const curr = new Date(sorted[i]!);
    const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays === 1) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }

  return maxStreak;
}
