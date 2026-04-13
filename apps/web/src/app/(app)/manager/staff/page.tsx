"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Mail, Clock, ArrowDownToLine, Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SwapRequestCard } from "@/components/swaps/SwapRequestCard";
import { RejectSwapModal } from "@/components/swaps/RejectSwapModal";
import { users as usersApi, swapRequests as swapApi, pickupRequests as pickupApi } from "@/lib/api";
import { formatLocalTime, formatDuration } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { SwapRequest } from "@shift-sync/shared";
import type { AxiosError } from "axios";

export default function ManagerStaffPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [rejectTarget, setRejectTarget] = useState<SwapRequest | null>(null);

  const { data: staff = [] } = useQuery({
    queryKey: ["users", { role: "STAFF" }],
    queryFn: () => usersApi.list({ role: "STAFF" }),
  });

  const { data: pendingSwaps = [] } = useQuery({
    queryKey: ["swap-requests", "pending-manager"],
    queryFn: () => swapApi.list({ status: "PENDING_MANAGER" }),
  });

  const { data: pickupReqs = [] } = useQuery({
    queryKey: ["pickup-requests", "pending"],
    queryFn: () => pickupApi.listAll(),
  });

  const approveMutation = useMutation({
    mutationFn: ({ shiftId, reqId }: { shiftId: string; reqId: string }) =>
      pickupApi.approve(shiftId, reqId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pickup-requests"] });
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast({ title: "Pickup approved", description: "The staff member has been assigned to the shift." });
    },
    onError: (err: AxiosError<{ error?: string }>) => {
      const msg = err.response?.data?.error ?? "Could not approve request.";
      toast({ variant: "destructive", title: "Error", description: msg });
    },
  });

  const rejectPickupMutation = useMutation({
    mutationFn: ({ shiftId, reqId }: { shiftId: string; reqId: string }) =>
      pickupApi.reject(shiftId, reqId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pickup-requests"] });
      toast({ title: "Pickup declined" });
    },
    onError: (err: AxiosError<{ error?: string }>) => {
      const msg = err.response?.data?.error ?? "Could not reject request.";
      toast({ variant: "destructive", title: "Error", description: msg });
    },
  });

  const filteredStaff = staff.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* Pickup requests requiring manager action */}
      {pickupReqs.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-emerald-700 flex items-center gap-1.5">
            <ArrowDownToLine className="h-4 w-4" />
            Shift pickup requests ({pickupReqs.length})
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {pickupReqs.map((req) => {
              const shift = req.shift;
              const tz = shift?.location?.timezone ?? "UTC";
              const isPending =
                approveMutation.isPending &&
                approveMutation.variables?.reqId === req.id;
              const isRejecting =
                rejectPickupMutation.isPending &&
                rejectPickupMutation.variables?.reqId === req.id;

              return (
                <Card key={req.id} className="border-l-4 border-l-emerald-400">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">
                          {req.user?.name ?? req.userId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {req.user?.email}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        Pickup request
                      </Badge>
                    </div>

                    {shift && (
                      <div className="rounded-md bg-muted/50 px-3 py-2 space-y-0.5">
                        <p className="text-xs font-medium">
                          {shift.location?.name}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {format(new Date(shift.startTime), "EEE, MMM d")} ·{" "}
                          {formatLocalTime(shift.startTime, tz)} –{" "}
                          {formatLocalTime(shift.endTime, tz)} (
                          {formatDuration(shift.startTime, shift.endTime)})
                        </div>
                        {shift.skill && (
                          <Badge variant="outline" className="text-[10px]">
                            {shift.skill.name}
                          </Badge>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={isPending || isRejecting}
                        onClick={() =>
                          approveMutation.mutate({
                            shiftId: req.shiftId,
                            reqId: req.id,
                          })
                        }
                      >
                        <Check className="h-3.5 w-3.5 mr-1" />
                        {isPending ? "Approving…" : "Approve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-destructive hover:text-destructive"
                        disabled={isPending || isRejecting}
                        onClick={() =>
                          rejectPickupMutation.mutate({
                            shiftId: req.shiftId,
                            reqId: req.id,
                          })
                        }
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        {isRejecting ? "Declining…" : "Decline"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending swaps requiring manager action */}
      {pendingSwaps.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-amber-700 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" />
            Swap requests awaiting your approval ({pendingSwaps.length})
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {pendingSwaps.map((swap) => (
              <SwapRequestCard
                key={swap.id}
                swap={swap}
                managerView
                onReject={setRejectTarget}
              />
            ))}
          </div>
        </div>
      )}

      {/* Staff directory */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-sm font-semibold">Staff Directory</h3>
          <Input
            className="ml-auto max-w-xs"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredStaff.map((u) => (
            <Card key={u.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{u.name}</p>
                  <Badge variant="secondary" className="text-[10px]">
                    {u.role}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  {u.email}
                </div>
                {u.desiredHoursPerWeek != null && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    Target: {u.desiredHoursPerWeek}h/week
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <RejectSwapModal
        swap={rejectTarget}
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
      />
    </div>
  );
}
