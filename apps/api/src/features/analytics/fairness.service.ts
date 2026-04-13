/**
 * Schedule Fairness Analytics Service.
 *
 * Answers: "Are premium (Friday/Saturday evening) shifts distributed equitably
 * across staff, and is each person getting close to their desired hours?"
 *
 * The fairness score (0–100) is based on the Gini coefficient applied to
 * premium shift distribution — a score of 100 means perfectly equal distribution,
 * lower scores indicate concentration with specific individuals.
 */

import { differenceInMinutes } from "date-fns";
import { prisma } from "@/shared/lib/prisma.js";
import type { FairnessReport, FairnessEntry } from "@shift-sync/shared";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a fairness report for a location over a date range.
 *
 * @param locationId - The location to report on
 * @param startDate  - Range start (UTC)
 * @param endDate    - Range end (UTC)
 */
export async function getFairnessReport(
  locationId: string,
  startDate: Date,
  endDate: Date,
): Promise<FairnessReport> {
  const location = await prisma.location.findUniqueOrThrow({
    where: { id: locationId },
    select: { name: true },
  });

  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      status: { not: "CANCELLED" },
      shift: {
        locationId,
        status: "PUBLISHED",
        startTime: { gte: startDate, lte: endDate },
      },
    },
    include: {
      user: {
        select: { id: true, name: true, desiredHoursPerWeek: true },
      },
      shift: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          isPremium: true,
        },
      },
    },
  });

  const staffMap = new Map<string, {
    userId: string;
    name: string;
    desiredHoursPerWeek: number | null;
    totalShifts: number;
    totalHours: number;
    premiumShifts: number;
    premiumHours: number;
  }>();

  for (const a of assignments) {
    const entry = staffMap.get(a.userId) ?? {
      userId: a.userId,
      name: a.user.name,
      desiredHoursPerWeek: a.user.desiredHoursPerWeek,
      totalShifts: 0,
      totalHours: 0,
      premiumShifts: 0,
      premiumHours: 0,
    };

    const shiftHours = differenceInMinutes(a.shift.endTime, a.shift.startTime) / 60;
    entry.totalShifts++;
    entry.totalHours += shiftHours;

    if (a.shift.isPremium) {
      entry.premiumShifts++;
      entry.premiumHours += shiftHours;
    }

    staffMap.set(a.userId, entry);
  }

  const totalPremiumShifts = Array.from(staffMap.values()).reduce(
    (sum, e) => sum + e.premiumShifts,
    0,
  );

  const staffEntries: FairnessEntry[] = Array.from(staffMap.values()).map(
    (e) => ({
      ...e,
      premiumSharePercent:
        totalPremiumShifts > 0
          ? Math.round((e.premiumShifts / totalPremiumShifts) * 100)
          : 0,
    }),
  );

  staffEntries.sort((a, b) => b.premiumShifts - a.premiumShifts);

  const fairnessScore = computeFairnessScore(staffEntries);

  return {
    periodStart: startDate.toISOString(),
    periodEnd: endDate.toISOString(),
    locationId,
    locationName: location.name,
    staff: staffEntries,
    fairnessScore,
  };
}

// ---------------------------------------------------------------------------
// Fairness score computation (Gini coefficient)
// ---------------------------------------------------------------------------

/**
 * Compute a 0–100 fairness score using the Gini coefficient on premium shifts.
 * Gini = 0 means perfectly equal; Gini = 1 means one person has everything.
 * We invert and scale: score = (1 - Gini) * 100.
 */
function computeFairnessScore(staff: FairnessEntry[]): number {
  if (staff.length < 2) return 100;

  const values = staff.map((s) => s.premiumShifts);
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  if (sum === 0) return 100;

  let giniNumerator = 0;
  for (let i = 0; i < n; i++) {
    giniNumerator += (2 * (i + 1) - n - 1) * (sorted[i] ?? 0);
  }

  const gini = giniNumerator / (n * sum);
  return Math.round((1 - gini) * 100);
}
