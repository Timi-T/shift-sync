/**
 * Component tests — SwapRequestCard
 *
 * Checks the role-based action visibility:
 *  - initiator sees Cancel / Regret button for PENDING_ACCEPTANCE / PENDING_MANAGER
 *  - receiver sees Accept for PENDING_ACCEPTANCE
 *  - neither sees buttons for terminal states (APPROVED, REJECTED, CANCELLED)
 *  - manager sees Approve/Reject buttons when managerView=true and status=PENDING_MANAGER
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SwapRequestCard } from "@/components/swaps/SwapRequestCard";
import type { SwapRequest } from "@shift-sync/shared";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  swapRequests: {
    cancel:  vi.fn().mockResolvedValue({ message: "cancelled" }),
    accept:  vi.fn().mockResolvedValue({}),
    approve: vi.fn().mockResolvedValue({ message: "approved" }),
    reject:  vi.fn().mockResolvedValue({ message: "rejected" }),
  },
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toasts: [], toast: vi.fn() }) }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { useAuth } from "@/contexts/AuthContext";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const BASE_SWAP: SwapRequest = {
  id:           "swap_1",
  type:         "SWAP",
  assignmentId: "assign_1",
  initiatorId:  "user_sarah",
  receiverId:   "user_maria",
  shiftId:      "shift_fri",
  status:       "PENDING_ACCEPTANCE",
  managerNote:  null,
  approvedBy:   null,
  expiresAt:    null,
  createdAt:    new Date("2024-01-15T10:00:00Z"),
  updatedAt:    new Date("2024-01-15T10:00:00Z"),
  initiator:    { id: "user_sarah", name: "Sarah Chen",       email: "sarah@test.com", role: "STAFF", desiredHoursPerWeek: 30 },
  receiver:     { id: "user_maria", name: "Maria Rodriguez",  email: "maria@test.com", role: "STAFF", desiredHoursPerWeek: 35 },
  shift: {
    id: "shift_fri", locationId: "loc_marina", skillId: "skill_server",
    startTime: new Date("2024-01-19T19:00:00Z"),
    endTime:   new Date("2024-01-20T01:00:00Z"),
    headcount: 2, status: "PUBLISHED", isPremium: true,
    location: { id: "loc_marina", name: "The Marina", timezone: "America/Los_Angeles" },
    assignments: [],
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SwapRequestCard", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("shows Accept button for receiver when status is PENDING_ACCEPTANCE", () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: "user_maria" } } as never);
    wrap(<SwapRequestCard swap={BASE_SWAP} />);
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });

  it("does NOT show Accept for initiator (only receiver can accept)", () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: "user_sarah" } } as never);
    wrap(<SwapRequestCard swap={BASE_SWAP} />);
    expect(screen.queryByRole("button", { name: /^accept$/i })).not.toBeInTheDocument();
  });

  it("shows Regret/Cancel button for initiator when PENDING_ACCEPTANCE", () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: "user_sarah" } } as never);
    wrap(<SwapRequestCard swap={BASE_SWAP} />);
    expect(screen.getByRole("button", { name: /regret|cancel/i })).toBeInTheDocument();
  });

  it("shows Regret/Cancel for initiator when PENDING_MANAGER (Regret Swap scenario)", () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: "user_sarah" } } as never);
    const swap = { ...BASE_SWAP, status: "PENDING_MANAGER" as const };
    wrap(<SwapRequestCard swap={swap} />);
    expect(screen.getByRole("button", { name: /regret|cancel/i })).toBeInTheDocument();
  });

  it("shows Approve + Reject for manager when status=PENDING_MANAGER and managerView=true", () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: "user_mgr" } } as never);
    const swap = { ...BASE_SWAP, status: "PENDING_MANAGER" as const };
    wrap(<SwapRequestCard swap={swap} managerView onReject={vi.fn()} />);
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i  })).toBeInTheDocument();
  });

  it("hides all action buttons when swap is APPROVED", () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: "user_sarah" } } as never);
    const swap = { ...BASE_SWAP, status: "APPROVED" as const };
    wrap(<SwapRequestCard swap={swap} />);
    expect(screen.queryByRole("button", { name: /accept|cancel|regret|approve|reject/i })).not.toBeInTheDocument();
  });

  it("hides all action buttons when swap is CANCELLED", () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: "user_sarah" } } as never);
    const swap = { ...BASE_SWAP, status: "CANCELLED" as const };
    wrap(<SwapRequestCard swap={swap} />);
    expect(screen.queryByRole("button", { name: /accept|cancel|regret|approve|reject/i })).not.toBeInTheDocument();
  });

  it("renders swap type and status badge", () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: "user_sarah" } } as never);
    wrap(<SwapRequestCard swap={BASE_SWAP} />);
    expect(screen.getByText("Swap Request")).toBeInTheDocument();
    expect(screen.getByText(/PENDING ACCEPTANCE/i)).toBeInTheDocument();
  });

  it("renders manager note when present", () => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: "user_sarah" } } as never);
    const swap = { ...BASE_SWAP, status: "REJECTED" as const, managerNote: "Insufficient notice." };
    wrap(<SwapRequestCard swap={swap} />);
    expect(screen.getByText(/Insufficient notice/)).toBeInTheDocument();
  });
});
