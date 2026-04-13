"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Clock, CheckCircle, XCircle, RotateCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { swapRequests as swapApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { formatLocalTime } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import type { SwapRequest } from "@shift-sync/shared";

interface Props {
  swap: SwapRequest;
  /** When true, show approve/reject buttons (manager view). */
  managerView?: boolean;
  onReject?: (swap: SwapRequest) => void;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  PENDING_ACCEPTANCE: "warning",
  PENDING_MANAGER:    "default",
  APPROVED:           "success",
  REJECTED:           "destructive",
  CANCELLED:          "secondary",
  EXPIRED:            "secondary",
};

export function SwapRequestCard({ swap, managerView = false, onReject }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const isInitiator = user?.id === swap.initiatorId;
  const isReceiver  = user?.id === swap.receiverId;
  const canCancel   = isInitiator && ["PENDING_ACCEPTANCE", "PENDING_MANAGER"].includes(swap.status);
  const canAccept   = isReceiver  && swap.status === "PENDING_ACCEPTANCE";

  const tz = swap.shift?.location?.timezone ?? "UTC";

  const cancelMutation = useMutation({
    mutationFn: () => swapApi.cancel(swap.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      toast({ title: "Swap cancelled", description: "Your assignment has been restored." });
    },
    onError: () => toast({ variant: "destructive", title: "Error", description: "Could not cancel swap." }),
  });

  const acceptMutation = useMutation({
    mutationFn: () => swapApi.accept(swap.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      toast({ title: "Accepted", description: "Swap is now pending manager approval." });
    },
    onError: () => toast({ variant: "destructive", title: "Error", description: "Could not accept swap." }),
  });

  const approveMutation = useMutation({
    mutationFn: () => swapApi.approve(swap.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      toast({ title: "Approved", description: "Swap has been approved and assignments updated." });
    },
    onError: () => toast({ variant: "destructive", title: "Error", description: "Could not approve swap." }),
  });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          {/* Type + status */}
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{swap.type === "DROP" ? "Drop Request" : "Swap Request"}</span>
            <Badge variant={STATUS_VARIANT[swap.status] ?? "outline"} className="text-[10px]">
              {swap.status.replace("_", " ")}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(swap.createdAt), { addSuffix: true })}
          </p>
        </div>

        {/* Shift info */}
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {swap.shift ? (
            <>
              {swap.shift.location?.name ?? "Unknown location"} ·{" "}
              {formatLocalTime(swap.shift.startTime, tz)} – {formatLocalTime(swap.shift.endTime, tz)}
            </>
          ) : (
            "Shift details unavailable"
          )}
        </div>

        {/* People */}
        <div className="mt-2 text-xs">
          <span className="text-muted-foreground">From: </span>
          <span className="font-medium">{swap.initiator?.name ?? swap.initiatorId}</span>
          {swap.type === "SWAP" && swap.receiver && (
            <>
              <span className="mx-1.5 text-muted-foreground">→</span>
              <span className="font-medium">{swap.receiver.name}</span>
            </>
          )}
        </div>

        {swap.managerNote && (
          <p className="mt-2 text-xs text-muted-foreground italic border-t pt-2">
            Manager: "{swap.managerNote}"
          </p>
        )}

        {/* Actions */}
        {(canAccept || canCancel || (managerView && swap.status === "PENDING_MANAGER")) && (
          <div className="mt-3 flex gap-2 border-t pt-3">
            {canAccept && (
              <Button size="sm" onClick={() => acceptMutation.mutate()} disabled={acceptMutation.isPending}>
                <CheckCircle className="h-3.5 w-3.5 mr-1" /> Accept
              </Button>
            )}
            {canCancel && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Regret / Cancel
              </Button>
            )}
            {managerView && swap.status === "PENDING_MANAGER" && (
              <>
                <Button
                  size="sm"
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending}
                >
                  <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/50"
                  onClick={() => onReject?.(swap)}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
