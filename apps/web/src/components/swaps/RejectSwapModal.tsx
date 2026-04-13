"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { swapRequests as swapApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import type { SwapRequest } from "@shift-sync/shared";

interface Props {
  swap:    SwapRequest | null;
  open:    boolean;
  onClose: () => void;
}

export function RejectSwapModal({ swap, open, onClose }: Props) {
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const rejectMutation = useMutation({
    mutationFn: () => swapApi.reject(swap!.id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      toast({ title: "Swap rejected", description: "The initiator has been notified." });
      setReason("");
      onClose();
    },
    onError: () => toast({ variant: "destructive", title: "Error", description: "Could not reject swap." }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Reject Swap Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Provide a reason for rejecting this swap. The staff member will be notified.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason <span className="text-muted-foreground text-xs">(min 5 characters)</span></Label>
            <Input
              id="reject-reason"
              placeholder="e.g. Insufficient notice — need more time"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => rejectMutation.mutate()}
            disabled={reason.length < 5 || rejectMutation.isPending}
          >
            {rejectMutation.isPending ? "Rejecting…" : "Reject swap"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
