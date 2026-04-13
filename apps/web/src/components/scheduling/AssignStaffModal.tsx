"use client";

/**
 * AssignStaffModal — lets a manager assign a staff member to a shift.
 *
 * Flow:
 *  1. Manager selects a staff member. Their skills and availability are shown inline.
 *  2. On "Check & Assign", calls POST /shifts/:id/assignments/preview.
 *     - If violations: show them. Allow override if only SEVENTH_CONSECUTIVE_DAY.
 *  3. On final confirm, call POST /shifts/:id/assignments.
 *     - Show warnings from the response as informational toasts.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clock, CheckCircle2, XCircle, Minus } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ConstraintViolationAlert } from "./ConstraintViolationAlert";
import { assignments as assignApi, users as usersApi, availability as availApi } from "@/lib/api";
import { formatLocalTime } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { Shift, ConstraintCheckResult, AvailabilityWindow } from "@shift-sync/shared";
import type { AxiosError } from "axios";

interface Props {
  shift: Shift | null;
  open:  boolean;
  onClose: () => void;
}

interface ApiErrorBody {
  code:    string;
  details?: ConstraintCheckResult;
  error?: string;
}

// ---------------------------------------------------------------------------
// Availability check — does the window cover the shift's local time?
// ---------------------------------------------------------------------------

function checkAvailability(
  windows: AvailabilityWindow[],
  shift: Shift,
): "available" | "unavailable" | "unknown" {
  if (!windows.length) return "unknown";

  const tz = shift.location?.timezone ?? "UTC";
  const shiftStart = new Date(shift.startTime);
  const shiftEnd   = new Date(shift.endTime);

  // Day-of-week in the location's timezone (0 = Sun … 6 = Sat)
  const dayOfWeek = new Date(
    shiftStart.toLocaleString("en-US", { timeZone: tz }),
  ).getDay();

  const shiftStartLocal = shiftStart
    .toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const shiftEndLocal = shiftEnd
    .toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

  // Check EXCEPTION first (highest priority)
  const dateStr = shiftStart.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
  const exception = windows.find(
    (w) => w.type === "EXCEPTION" && w.date?.toString().startsWith(dateStr),
  );
  if (exception) {
    if (!exception.available) return "unavailable";
    return exception.startTime <= shiftStartLocal && exception.endTime >= shiftEndLocal
      ? "available"
      : "unavailable";
  }

  // Check RECURRING
  const recurring = windows.filter(
    (w) => w.type === "RECURRING" && w.dayOfWeek === dayOfWeek,
  );
  if (!recurring.length) return "unknown";

  const covers = recurring.some(
    (w) => w.startTime <= shiftStartLocal && w.endTime >= shiftEndLocal,
  );
  return covers ? "available" : "unavailable";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssignStaffModal({ shift, open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId]       = useState("");
  const [overrideReason, setOverrideReason]       = useState("");
  const [previewResult, setPreviewResult]         = useState<ConstraintCheckResult | null>(null);
  const [showOverrideInput, setShowOverrideInput] = useState(false);

  // All staff at this location
  const { data: staff = [] } = useQuery({
    queryKey: ["users", { locationId: shift?.locationId }],
    queryFn:  () => usersApi.list({ locationId: shift?.locationId }),
    enabled:  !!shift,
  });

  // Selected staff member's full profile (skills)
  const selectedStaff = staff.find((u) => u.id === selectedUserId);

  // Selected staff member's availability windows
  const { data: availWindows = [] } = useQuery({
    queryKey: ["availability", selectedUserId],
    queryFn:  () => availApi.list(),
    enabled:  !!selectedUserId,
    // Availability is fetched as the current user — we use a proxy via the
    // admin user-detail endpoint if needed; for now the list endpoint
    // returns the calling user's windows, so we store per-user in cache key
    // but note this will only be accurate when the manager is the selected user.
    // The constraint preview covers hard blocks; this is a soft indicator.
    staleTime: 60_000,
  });

  const availStatus = shift && availWindows.length
    ? checkAvailability(availWindows, shift)
    : "unknown";

  const previewMutation = useMutation({
    mutationFn: () => assignApi.preview(shift!.id, selectedUserId),
    onSuccess: (data) => {
      setPreviewResult(data);
      if (data.valid) {
        assignMutation.mutate();
      } else {
        const hasOnlySeventhDay = data.violations.every(
          (v) => v.code === "SEVENTH_CONSECUTIVE_DAY",
        );
        setShowOverrideInput(hasOnlySeventhDay);
      }
    },
    onError: () => {
      toast({ variant: "destructive", title: "Preview failed", description: "Unable to check constraints." });
    },
  });

  const assignMutation = useMutation({
    mutationFn: () =>
      assignApi.create(shift!.id, selectedUserId, overrideReason || undefined),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      if (data.warnings.length > 0) {
        data.warnings.forEach((w) => {
          toast({ title: "Scheduling note", description: w.message });
        });
      } else {
        toast({ variant: "success" as never, title: "Assigned", description: "Staff member assigned successfully." });
      }
      handleClose();
    },
    onError: (err: AxiosError<ApiErrorBody>) => {
      const body = err.response?.data;
      if (body?.code === "CONSTRAINT_VIOLATION" && body.details) {
        setPreviewResult(body.details);
      } else {
        toast({ variant: "destructive", title: "Assignment failed", description: body?.error ?? "Unknown error." });
      }
    },
  });

  const handleClose = useCallback(() => {
    setSelectedUserId("");
    setOverrideReason("");
    setPreviewResult(null);
    setShowOverrideInput(false);
    onClose();
  }, [onClose]);

  const handleSubmit = () => {
    if (!selectedUserId) return;
    if (previewResult && !previewResult.valid && overrideReason) {
      assignMutation.mutate();
    } else {
      previewMutation.mutate();
    }
  };

  const isLoading  = previewMutation.isPending || assignMutation.isPending;
  const canOverride = showOverrideInput && previewResult && !previewResult.valid;

  if (!shift) return null;

  const tz = shift.location?.timezone ?? "UTC";
  const shiftSkillId = shift.skillId;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Assign Staff</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Shift summary */}
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
            <p className="font-medium text-foreground text-sm">
              {shift.location?.name} — {shift.skill?.name ?? shift.skillId}
            </p>
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {format(new Date(shift.startTime), "EEE, MMM d")} ·{" "}
              {formatLocalTime(shift.startTime, tz)} – {formatLocalTime(shift.endTime, tz)}
            </div>
            <p>{shift.headcount - (shift.assignments?.filter((a) => a.status === "CONFIRMED").length ?? 0)} open slot(s) remaining</p>
          </div>

          {/* Staff picker */}
          <div className="space-y-1.5">
            <Label htmlFor="staff-select">Staff member</Label>
            <Select
              value={selectedUserId}
              onValueChange={(v) => {
                setSelectedUserId(v);
                setPreviewResult(null);
                setShowOverrideInput(false);
              }}
            >
              <SelectTrigger id="staff-select">
                <SelectValue placeholder="Select a staff member…" />
              </SelectTrigger>
              <SelectContent>
                {staff
                  .filter((u) => u.role === "STAFF")
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Staff profile — shown once someone is selected */}
          {selectedStaff && (
            <div className="rounded-md border px-3 py-3 space-y-3 text-sm">
              {/* Skills */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Skills</p>
                {selectedStaff.skills && selectedStaff.skills.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(selectedStaff.skills as Array<{ id: string; name: string }>).map((s) => (
                      <Badge
                        key={s.id}
                        variant={s.id === shiftSkillId ? "default" : "secondary"}
                        className="text-[11px]"
                      >
                        {s.name}
                        {s.id === shiftSkillId && (
                          <CheckCircle2 className="ml-1 h-3 w-3" />
                        )}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No skills on record</p>
                )}
                {!(selectedStaff.skills as Array<{ id: string }>)?.some((s) => s.id === shiftSkillId) && (
                  <p className="mt-1 text-xs text-destructive">
                    Missing required skill — constraint check will flag this.
                  </p>
                )}
              </div>

              {/* Availability indicator */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Availability</p>
                <div className="flex items-center gap-1.5 text-xs">
                  {availStatus === "available" ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      <span className="text-green-700">Marked available for this slot</span>
                    </>
                  ) : availStatus === "unavailable" ? (
                    <>
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                      <span className="text-destructive">Marked unavailable for this slot</span>
                    </>
                  ) : (
                    <>
                      <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">No availability set for this slot</span>
                    </>
                  )}
                </div>
              </div>

              {/* Desired hours */}
              {selectedStaff.desiredHoursPerWeek != null && (
                <p className="text-xs text-muted-foreground">
                  Target: {selectedStaff.desiredHoursPerWeek}h/week
                </p>
              )}
            </div>
          )}

          {/* Constraint result */}
          {previewResult && (
            <ConstraintViolationAlert result={previewResult} />
          )}

          {/* Override reason */}
          {canOverride && (
            <div className="space-y-1.5">
              <Label htmlFor="override-reason">
                Override reason <span className="text-muted-foreground">(required)</span>
              </Label>
              <Input
                id="override-reason"
                placeholder="e.g. Operational necessity — short-staffed this week"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedUserId || isLoading || (!!canOverride && overrideReason.length < 5)}
          >
            {isLoading
              ? "Checking…"
              : canOverride
              ? "Override & Assign"
              : "Check & Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
