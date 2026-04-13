/**
 * Component tests — WeekCalendar
 *
 * Covers rendering of shifts, the day-header labels, empty-day placeholder,
 * and the prev/next week navigation callbacks.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WeekCalendar } from "@/components/scheduling/WeekCalendar";
import { startOfWeek } from "date-fns";
import type { Shift } from "@shift-sync/shared";

// Monday 2024-01-15 (UTC midnight)
const WEEK_START = startOfWeek(new Date("2024-01-15T00:00:00Z"), { weekStartsOn: 1 });

const TIMEZONE = "America/Los_Angeles";

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id:         "shift_1",
    locationId: "loc_marina",
    skillId:    "skill_server",
    startTime:  new Date("2024-01-19T19:00:00Z"), // Friday 11am PT
    endTime:    new Date("2024-01-20T01:00:00Z"), // Friday 5pm PT
    headcount:  2,
    status:     "PUBLISHED",
    isPremium:  true,
    location:   { id: "loc_marina", name: "The Marina", timezone: TIMEZONE },
    skill:      { id: "skill_server", name: "server" },
    assignments: [],
    ...overrides,
  };
}

describe("WeekCalendar", () => {
  it("renders all 7 day-header labels", () => {
    render(
      <WeekCalendar
        shifts={[]}
        weekStart={WEEK_START}
        timezone={TIMEZONE}
        onPrevWeek={vi.fn()}
        onNextWeek={vi.fn()}
      />,
    );
    for (const label of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("shows the week range label", () => {
    render(
      <WeekCalendar
        shifts={[]}
        weekStart={WEEK_START}
        timezone={TIMEZONE}
        onPrevWeek={vi.fn()}
        onNextWeek={vi.fn()}
      />,
    );
    expect(screen.getByText(/Jan 15/)).toBeInTheDocument();
    expect(screen.getByText(/Jan 21/)).toBeInTheDocument();
  });

  it("renders the shift card inside the correct day column", () => {
    const shift = makeShift();
    render(
      <WeekCalendar
        shifts={[shift]}
        weekStart={WEEK_START}
        timezone={TIMEZONE}
        onPrevWeek={vi.fn()}
        onNextWeek={vi.fn()}
      />,
    );
    // "11:00 AM" (PT) should appear somewhere in the rendered output
    expect(screen.getByText(/11:00 AM/i)).toBeInTheDocument();
  });

  it("calls onPrevWeek and onNextWeek when nav buttons clicked", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();

    render(
      <WeekCalendar
        shifts={[]}
        weekStart={WEEK_START}
        timezone={TIMEZONE}
        onPrevWeek={onPrev}
        onNextWeek={onNext}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /prev/i }));
    expect(onPrev).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("shows empty placeholder for days without shifts", () => {
    render(
      <WeekCalendar
        shifts={[]}
        weekStart={WEEK_START}
        timezone={TIMEZONE}
        onPrevWeek={vi.fn()}
        onNextWeek={vi.fn()}
      />,
    );
    // 7 days, all empty — each should show "—"
    expect(screen.getAllByText("—").length).toBe(7);
  });

  it("calls onAssign when Assign staff is clicked in manager view", async () => {
    const onAssign = vi.fn();
    const shift = makeShift({ headcount: 2, assignments: [] });

    render(
      <WeekCalendar
        shifts={[shift]}
        weekStart={WEEK_START}
        timezone={TIMEZONE}
        onPrevWeek={vi.fn()}
        onNextWeek={vi.fn()}
        onAssign={onAssign}
        managerView
      />,
    );

    // Open the dropdown for the shift card
    const menuBtn = screen.getByRole("button", { name: /actions/i });
    fireEvent.click(menuBtn);

    const assignItem = await screen.findByText(/assign staff/i);
    fireEvent.click(assignItem);

    expect(onAssign).toHaveBeenCalledWith(shift);
  });
});
