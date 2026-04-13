"use client";

/**
 * WeekCalendar — 7-day grid showing shifts grouped by day.
 *
 * Props:
 *  - shifts:      the week's shifts
 *  - weekStart:   Monday of the displayed week (UTC midnight)
 *  - timezone:    the location's IANA timezone for display
 *  - onPrevWeek / onNextWeek: pagination callbacks
 *  - onShiftClick: open shift detail or assign modal
 *  - managerView:  enable management actions on each card
 */

import { useMemo } from "react";
import { addDays, format, startOfWeek, isSameDay } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShiftCard } from "./ShiftCard";
import { toLocalDateString } from "@/lib/utils";
import type { Shift } from "@shift-sync/shared";

interface WeekCalendarProps {
  shifts:      Shift[];
  weekStart:   Date;
  timezone:    string;
  onPrevWeek:  () => void;
  onNextWeek:  () => void;
  onAssign?:   (shift: Shift) => void;
  onCancel?:   (shift: Shift) => void;
  onPublish?:  (shift: Shift) => void;
  managerView?: boolean;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function WeekCalendar({
  shifts,
  weekStart,
  timezone,
  onPrevWeek,
  onNextWeek,
  onAssign,
  onCancel,
  onPublish,
  managerView = false,
}: WeekCalendarProps) {
  // Build array of 7 Date objects (Mon–Sun) from weekStart
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  // Map "YYYY-MM-DD in timezone" → shifts[]
  const shiftsByDay = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of shifts) {
      const key = toLocalDateString(shift.startTime, timezone);
      const arr = map.get(key) ?? [];
      arr.push(shift);
      map.set(key, arr);
    }
    return map;
  }, [shifts, timezone]);

  const weekLabel = `${format(weekStart, "MMM d")} – ${format(addDays(weekStart, 6), "MMM d, yyyy")}`;

  return (
    <div className="flex flex-col gap-3">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={onPrevWeek}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Prev
        </Button>
        <h2 className="text-sm font-semibold">{weekLabel}</h2>
        <Button variant="outline" size="sm" onClick={onNextWeek}>
          Next <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* 7-column grid */}
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, idx) => {
          const dayKey = toLocalDateString(day, timezone);
          const dayShifts = shiftsByDay.get(dayKey) ?? [];
          const isToday = isSameDay(day, new Date());

          return (
            <div key={dayKey} className="flex flex-col gap-1 min-h-[120px]">
              {/* Day header */}
              <div className="text-center pb-1 border-b">
                <p className="text-xs text-muted-foreground">{DAY_LABELS[idx]}</p>
                <p
                  className={`text-sm font-semibold leading-tight ${
                    isToday
                      ? "text-primary underline underline-offset-2"
                      : "text-foreground"
                  }`}
                >
                  {format(day, "d")}
                </p>
              </div>

              {/* Shifts */}
              <div className="flex flex-col gap-1 flex-1">
                {dayShifts.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/50 italic">
                    —
                  </div>
                ) : (
                  dayShifts
                    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                    .map((shift) => (
                      <ShiftCard
                        key={shift.id}
                        shift={shift}
                        onAssign={onAssign}
                        onCancel={onCancel}
                        onPublish={onPublish}
                        managerView={managerView}
                        compact
                      />
                    ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
