"use client";

import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload } from "lucide-react";
import { startOfWeek, addWeeks, subWeeks, format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { WeekCalendar } from "@/components/scheduling/WeekCalendar";
import { CreateShiftModal } from "@/components/scheduling/CreateShiftModal";
import { AssignStaffModal } from "@/components/scheduling/AssignStaffModal";
import { shifts as shiftsApi, locations as locApi } from "@/lib/api";
import { useSocket } from "@/contexts/SocketContext";
import { toast } from "@/hooks/use-toast";
import type { Shift } from "@shift-sync/shared";

export default function ManagerSchedulePage() {
  const queryClient = useQueryClient();
  const { on } = useSocket();

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Shift | null>(null);

  const { data: locationList = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => locApi.list(),
  });

  useEffect(() => {
    if (locationList.length > 0 && !selectedLocationId) {
      setSelectedLocationId((locationList as Array<{ id: string }>)[0]!.id);
    }
  }, [locationList, selectedLocationId]);

  const selectedLocation = (locationList as Array<{ id: string; name: string; timezone: string }>).find((l) => l.id === selectedLocationId);

  const { data: weekShifts = [], isLoading } = useQuery({
    queryKey: ["shifts", format(weekStart, "yyyy-MM-dd"), selectedLocationId],
    queryFn: () => shiftsApi.list({
      locationId: selectedLocationId || undefined,
      startDate: format(weekStart, "yyyy-MM-dd"),
      endDate: format(addWeeks(weekStart, 1), "yyyy-MM-dd"),
    }),
    enabled: !!selectedLocationId,
  });

  // Real-time updates
  useEffect(() => {
    return on("SHIFT_UPDATED", () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
    });
  }, [on, queryClient]);

  const publishMutation = useMutation({
    mutationFn: (shift: Shift) => shiftsApi.publish(shift.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast({ title: "Shift published" });
    },
    onError: () => toast({ variant: "destructive", title: "Could not publish shift." }),
  });

  const cancelMutation = useMutation({
    mutationFn: (shift: Shift) => shiftsApi.cancel(shift.id, "Cancelled by manager"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast({ title: "Shift cancelled" });
    },
    onError: () => toast({ variant: "destructive", title: "Could not cancel shift." }),
  });

  const publishWeekMutation = useMutation({
    mutationFn: () =>
      shiftsApi.publishWeek(selectedLocationId, format(weekStart, "yyyy-MM-dd")),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast({ title: "Week published", description: `${data.published} shifts published.` });
    },
  });

  const draftCount = weekShifts.filter((s) => s.status === "DRAFT").length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Select location…" />
          </SelectTrigger>
          <SelectContent>
            {(locationList as Array<{ id: string; name: string }>).map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex gap-2">
          {draftCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => publishWeekMutation.mutate()}
              disabled={publishWeekMutation.isPending}
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Publish week ({draftCount} drafts)
            </Button>
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New shift
          </Button>
        </div>
      </div>

      {/* Calendar */}
      {isLoading ? (
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      ) : (
        <WeekCalendar
          shifts={weekShifts}
          weekStart={weekStart}
          timezone={selectedLocation?.timezone ?? "America/Los_Angeles"}
          onPrevWeek={() => setWeekStart((w) => subWeeks(w, 1))}
          onNextWeek={() => setWeekStart((w) => addWeeks(w, 1))}
          onAssign={setAssignTarget}
          onCancel={(s) => cancelMutation.mutate(s)}
          onPublish={(s) => publishMutation.mutate(s)}
          managerView
        />
      )}

      <CreateShiftModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultLocationId={selectedLocationId}
      />

      <AssignStaffModal
        shift={assignTarget}
        open={!!assignTarget}
        onClose={() => setAssignTarget(null)}
      />
    </div>
  );
}
