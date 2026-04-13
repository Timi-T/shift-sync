"use client";

/**
 * OnDutyDashboard — shows shifts currently in progress.
 * Auto-refreshes every 60 s and updates in real-time via socket events.
 */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, MapPin, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { shifts as shiftsApi } from "@/lib/api";
import { useSocket } from "@/contexts/SocketContext";
import { formatLocalTime, formatDuration } from "@/lib/utils";

export function OnDutyDashboard() {
  const queryClient = useQueryClient();
  const { on } = useSocket();

  const { data: activeShifts = [], isLoading } = useQuery({
    queryKey:  ["shifts", "on-duty"],
    queryFn:   () => shiftsApi.onDuty(),
    refetchInterval: 60_000,
  });

  // Invalidate on real-time updates
  useEffect(() => {
    return on("SHIFT_UPDATED", () => {
      queryClient.invalidateQueries({ queryKey: ["shifts", "on-duty"] });
    });
  }, [on, queryClient]);

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-lg bg-muted" />;
  }

  if (activeShifts.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No shifts currently in progress.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Currently On Duty
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {activeShifts.map((shift) => {
          const tz = shift.location?.timezone ?? "UTC";
          const confirmed = shift.assignments?.filter(
            (a) => a.status === "CONFIRMED" || a.status === "PENDING_SWAP",
          ) ?? [];

          return (
            <Card key={shift.id} className="border-l-4 border-l-green-500">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  {shift.location?.name ?? shift.locationId}
                  <Badge variant="success" className="ml-auto text-[10px]">
                    Live
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {formatLocalTime(shift.startTime, tz)} – {formatLocalTime(shift.endTime, tz)}
                  <span className="ml-1 text-muted-foreground/60">
                    ({formatDuration(shift.startTime, shift.endTime)})
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {confirmed.length}/{shift.headcount} on duty
                </div>
                {confirmed.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {confirmed.map((a) => (
                      <span
                        key={a.id}
                        className="rounded-full bg-green-100 text-green-800 text-[10px] font-medium px-2 py-0.5"
                      >
                        {a.user?.name ?? a.userId}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
