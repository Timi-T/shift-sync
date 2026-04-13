/**
 * Component tests — ConstraintViolationAlert
 *
 * Verifies that violations, warnings, and suggestions render correctly
 * and that nothing renders when the result is valid.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConstraintViolationAlert } from "@/components/scheduling/ConstraintViolationAlert";

const VIOLATION = {
  code:    "DOUBLE_BOOKED",
  message: "Sarah Chen is already assigned to another shift during this time",
  detail:  "Sarah has a shift at The Boardwalk from 17:00–23:00 PT that overlaps.",
};

const WARNING = {
  code:    "WEEKLY_HOURS_WARNING",
  message: "Approaching 40h",
  detail:  "Sarah has 36 projected hours this week.",
};

const SUGGESTION = {
  userId: "user_john",
  name:   "John Martinez",
  reason: "Has server skill, certified at The Marina",
  caveats: [],
};

describe("ConstraintViolationAlert", () => {
  it("renders nothing when violations and warnings are both empty", () => {
    const { container } = render(
      <ConstraintViolationAlert result={{ violations: [], warnings: [], suggestions: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the violation message and detail", () => {
    render(
      <ConstraintViolationAlert
        result={{ violations: [VIOLATION], warnings: [], suggestions: [] }}
      />,
    );
    expect(screen.getByText(VIOLATION.message)).toBeInTheDocument();
    expect(screen.getByText(VIOLATION.detail!)).toBeInTheDocument();
  });

  it("renders the warning message", () => {
    render(
      <ConstraintViolationAlert
        result={{ violations: [], warnings: [WARNING], suggestions: [] }}
      />,
    );
    expect(screen.getByText(WARNING.message)).toBeInTheDocument();
    expect(screen.getByText(WARNING.detail!)).toBeInTheDocument();
  });

  it("renders suggestions with name and reason", () => {
    render(
      <ConstraintViolationAlert
        result={{ violations: [VIOLATION], warnings: [], suggestions: [SUGGESTION] }}
      />,
    );
    expect(screen.getByText(/John Martinez/)).toBeInTheDocument();
    expect(screen.getByText(/Has server skill/)).toBeInTheDocument();
  });

  it("renders multiple violations", () => {
    const second = { code: "SKILL_MISMATCH", message: "Skill mismatch", detail: "Needs bartender." };
    render(
      <ConstraintViolationAlert
        result={{ violations: [VIOLATION, second], warnings: [], suggestions: [] }}
      />,
    );
    expect(screen.getByText(VIOLATION.message)).toBeInTheDocument();
    expect(screen.getByText(second.message)).toBeInTheDocument();
  });

  it("renders 'Available alternatives' heading when suggestions present", () => {
    render(
      <ConstraintViolationAlert
        result={{ violations: [VIOLATION], warnings: [], suggestions: [SUGGESTION] }}
      />,
    );
    expect(screen.getByText(/available alternatives/i)).toBeInTheDocument();
  });

  it("does NOT render suggestions section when there are no suggestions", () => {
    render(
      <ConstraintViolationAlert
        result={{ violations: [VIOLATION], warnings: [], suggestions: [] }}
      />,
    );
    expect(screen.queryByText(/available alternatives/i)).not.toBeInTheDocument();
  });
});
