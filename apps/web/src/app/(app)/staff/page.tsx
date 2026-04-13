"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfWeek, addWeeks, subWeeks } from "date-fns";
import { Clock, ArrowDownToLine } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WeekCalendar } from "@/components/scheduling/WeekCalendar";
import { shifts as shiftsApi, pickupRequests as pickupApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSocket } from "@/contexts/SocketContext";
import { formatLocalTime, formatDuration } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { AxiosError } from "axios";

export default function StaffShiftsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { on } = useSocket();

  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );

  const { data: weekShifts = [], isLoading } = useQuery({
    queryKey: ["shifts", "staff", format(weekStart, "yyyy-MM-dd"), user?.id],
    queryFn: () =>
      shiftsApi.list({
        startDate: format(weekStart, "yyyy-MM-dd"),
        endDate: format(addWeeks(weekStart, 1), "yyyy-MM-dd"),
      }),
    enabled: !!user,
  });

  // Track which shifts the user has already requested
  const [requestedShiftIds, setRequestedShiftIds] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    return on("SHIFT_UPDATED", () => {
      queryClient.invalidateQueries({ queryKey: ["shifts", "staff"] });
    });
  }, [on, queryClient]);

  // Shifts assigned to this user
  const myShifts = weekShifts.filter((s) =>
    s.assignments?.some(
      (a) => a.userId === user?.id && a.status !== "CANCELLED",
    ),
  );

  const upcomingShifts = myShifts
    .filter((s) => new Date(s.startTime) > new Date())
    .sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    )
    .slice(0, 5);

  // Open published shifts the user is NOT already on and has open slots
  const availableShifts = weekShifts.filter((s) => {
    if (s.status !== "PUBLISHED") return false;
    const alreadyOn = s.assignments?.some(
      (a) => a.userId === user?.id && a.status !== "CANCELLED",
    );
    if (alreadyOn) return false;
    const confirmed =
      s.assignments?.filter((a) => a.status === "CONFIRMED").length ?? 0;
    return confirmed < (s.headcount ?? 1);
  });

  const pickupMutation = useMutation({
    mutationFn: (shiftId: string) => pickupApi.request(shiftId),
    onSuccess: (_, shiftId) => {
      setRequestedShiftIds((prev) => new Set([...prev, shiftId]));
      toast({
        title: "Request sent",
        description:
          "Your shift pickup request has been sent to the manager for approval.",
      });
    },
    onError: (err: AxiosError<{ error?: string }>) => {
      const msg =
        err.response?.data?.error ?? "Could not submit pickup request.";
      toast({ variant: "destructive", title: "Error", description: msg });
    },
  });

  return (
    <div className="space-y-6">
      {/* Upcoming shifts summary */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Upcoming Shifts</h3>
        {upcomingShifts.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No upcoming shifts this week.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {upcomingShifts.map((s) => {
              const tz = s.location?.timezone ?? "UTC";
              return (
                <Card key={s.id} className="border-l-4 border-l-blue-500">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {s.location?.name ?? s.locationId}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        <Clock className="h-3.5 w-3.5" />
                        {format(new Date(s.startTime), "EEE, MMM d")} ·{" "}
                        {formatLocalTime(s.startTime, tz)} –{" "}
                        {formatLocalTime(s.endTime, tz)} (
                        {formatDuration(s.startTime, s.endTime)})
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {s.isPremium && (
                        <Badge variant="premium" className="text-[10px]">
                          Premium
                        </Badge>
                      )}
                      <Badge
                        variant="secondary"
                        className="text-[10px] capitalize"
                      >
                        {s.skill?.name}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Available open shifts to pick up */}
      {availableShifts.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <ArrowDownToLine className="h-4 w-4 text-muted-foreground" />
            Open Shifts — Available to Pick Up
          </h3>
          <div className="space-y-2">
            {availableShifts.map((s) => {
              const tz = s.location?.timezone ?? "UTC";
              const confirmed =
                s.assignments?.filter((a) => a.status === "CONFIRMED")
                  .length ?? 0;
              const openSlots = (s.headcount ?? 1) - confirmed;
              const requested = requestedShiftIds.has(s.id);

              return (
                <Card
                  key={s.id}
                  className="border-l-4 border-l-emerald-500"
                >
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {s.location?.name ?? s.locationId}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        {format(new Date(s.startTime), "EEE, MMM d")} ·{" "}
                        {formatLocalTime(s.startTime, tz)} –{" "}
                        {formatLocalTime(s.endTime, tz)} (
                        {formatDuration(s.startTime, s.endTime)})
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge
                          variant="secondary"
                          className="text-[10px] capitalize"
                        >
                          {s.skill?.name}
                        </Badge>
                        {s.isPremium && (
                          <Badge variant="premium" className="text-[10px]">
                            Premium
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {openSlots} slot{openSlots !== 1 ? "s" : ""} open
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={requested ? "secondary" : "default"}
                      disabled={
                        requested ||
                        (pickupMutation.isPending &&
                          pickupMutation.variables === s.id)
                      }
                      onClick={() => pickupMutation.mutate(s.id)}
                      className="shrink-0"
                    >
                      {requested ? "Requested" : "Pick up"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Week calendar — my shifts only */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Week View</h3>
        {isLoading ? (
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        ) : (
          <WeekCalendar
            shifts={myShifts}
            weekStart={weekStart}
            timezone={
              myShifts[0]?.location?.timezone ?? "America/Los_Angeles"
            }
            onPrevWeek={() => setWeekStart((w) => subWeeks(w, 1))}
            onNextWeek={() => setWeekStart((w) => addWeeks(w, 1))}
            managerView={false}
          />
        )}
      </div>
    </div>
  );
}
