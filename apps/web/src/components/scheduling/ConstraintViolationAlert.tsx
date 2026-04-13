"use client";

/**
 * ConstraintViolationAlert — renders the structured violations and suggestions
 * returned by the API's 422 CONSTRAINT_VIOLATION response.
 *
 * Used inside AssignStaffModal after a failed assignment attempt.
 */

import { AlertTriangle, Info, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConstraintCheckResult } from "@shift-sync/shared";

interface Props {
  result: Pick<ConstraintCheckResult, "violations" | "warnings" | "suggestions">;
  className?: string;
}

const VIOLATION_ICON_COLOR: Record<string, string> = {
  DOUBLE_BOOKED:          "text-red-500",
  SKILL_MISMATCH:         "text-orange-500",
  LOCATION_NOT_CERTIFIED: "text-orange-500",
  AVAILABILITY_CONFLICT:  "text-amber-500",
  MINIMUM_REST:           "text-red-500",
  SEVENTH_CONSECUTIVE_DAY:"text-red-500",
  DAILY_HOURS_EXCEEDED:   "text-red-500",
};

export function ConstraintViolationAlert({ result, className }: Props) {
  const { violations, warnings, suggestions } = result;

  if (violations.length === 0 && warnings.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Violations */}
      {violations.map((v) => (
        <div key={v.code} className="rounded-md border border-red-200 bg-red-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", VIOLATION_ICON_COLOR[v.code] ?? "text-red-500")} />
            <div>
              <p className="text-sm font-medium text-red-800">{v.message}</p>
              {v.detail && (
                <p className="mt-0.5 text-xs text-red-700">{v.detail}</p>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Warnings */}
      {warnings.map((w) => (
        <div key={w.code} className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-800">{w.message}</p>
              {w.detail && (
                <p className="mt-0.5 text-xs text-amber-700">{w.detail}</p>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <UserCheck className="h-4 w-4 text-blue-600" />
            <p className="text-sm font-medium text-blue-800">Available alternatives</p>
          </div>
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <li key={s.userId} className="text-xs text-blue-700">
                <span className="font-medium">{s.name}</span> — {s.reason}
                {s.caveats && s.caveats.length > 0 && (
                  <span className="text-blue-500"> ({s.caveats.join(", ")})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
