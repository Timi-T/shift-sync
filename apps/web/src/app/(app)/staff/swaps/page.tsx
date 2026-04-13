"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SwapRequestCard } from "@/components/swaps/SwapRequestCard";
import { swapRequests as swapApi, shifts as shiftsApi, users as usersApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useSocket } from "@/contexts/SocketContext";
import { toast } from "@/hooks/use-toast";
import type { AxiosError } from "axios";

export default function StaffSwapsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { on } = useSocket();
  const [createOpen, setCreateOpen] = useState(false);
  const [type, setType]             = useState<"SWAP" | "DROP">("SWAP");
  const [assignmentId, setAssignmentId] = useState("");
  const [receiverId, setReceiverId]     = useState("");

  const { data: mySwaps = [] } = useQuery({
    queryKey: ["swap-requests", "mine"],
    queryFn:  () => swapApi.list({ initiatedByMe: true }),
  });

  const { data: incomingSwaps = [] } = useQuery({
    queryKey: ["swap-requests", "incoming"],
    queryFn:  () => swapApi.list({ status: "PENDING_ACCEPTANCE" }),
  });

  // Available DROP requests anyone can claim
  const { data: openDrops = [] } = useQuery({
    queryKey: ["swap-requests", "open-drops"],
    queryFn:  () => swapApi.list({ status: "PENDING_ACCEPTANCE" }),
  });

  const { data: myShifts = [] } = useQuery({
    queryKey: ["shifts", "my-assignments"],
    queryFn:  () => shiftsApi.list({}),
    select: (data) =>
      data.filter((s) =>
        s.assignments?.some((a) => a.userId === user?.id && a.status === "CONFIRMED"),
      ),
    enabled: !!user,
  });

  const { data: colleagues = [] } = useQuery({
    queryKey: ["users", "staff"],
    queryFn:  () => usersApi.list({ role: "STAFF" }),
  });

  useEffect(() => {
    return on("SWAP_UPDATED", () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
    });
  }, [on, queryClient]);

  const createMutation = useMutation({
    mutationFn: () =>
      swapApi.create({
        type,
        assignmentId,
        receiverId: type === "SWAP" ? receiverId : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      toast({ title: "Request sent", description: type === "SWAP" ? "Swap request sent to colleague." : "Drop request posted for anyone to claim." });
      setCreateOpen(false);
      setAssignmentId(""); setReceiverId("");
    },
    onError: (err: AxiosError<{ error?: string; code?: string }>) => {
      toast({ variant: "destructive", title: "Error", description: err.response?.data?.error ?? "Could not create request." });
    },
  });

  const incomingForMe = incomingSwaps.filter(
    (s) => s.receiverId === user?.id && s.type === "SWAP",
  );
  const claimableDrops = openDrops.filter(
    (s) => s.type === "DROP" && s.initiatorId !== user?.id,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage your swap and drop requests.
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> New request
        </Button>
      </div>

      {/* Incoming swap requests */}
      {incomingForMe.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-3">Incoming Swap Requests</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {incomingForMe.map((s) => (
              <SwapRequestCard key={s.id} swap={s} />
            ))}
          </div>
        </section>
      )}

      {/* Open drops to claim */}
      {claimableDrops.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-3">Available Shifts to Claim</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {claimableDrops.map((s) => (
              <SwapRequestCard key={s.id} swap={s} />
            ))}
          </div>
        </section>
      )}

      {/* My requests */}
      <section>
        <h3 className="text-sm font-semibold mb-3">My Requests</h3>
        {mySwaps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {mySwaps.map((s) => (
              <SwapRequestCard key={s.id} swap={s} />
            ))}
          </div>
        )}
      </section>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => !o && setCreateOpen(false)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>New Swap / Drop Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Request type</Label>
              <Select value={type} onValueChange={(v) => setType(v as "SWAP" | "DROP")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SWAP">Swap — trade with a specific colleague</SelectItem>
                  <SelectItem value="DROP">Drop — post for anyone to claim</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Your shift</Label>
              <Select value={assignmentId} onValueChange={setAssignmentId}>
                <SelectTrigger><SelectValue placeholder="Select a shift…" /></SelectTrigger>
                <SelectContent>
                  {myShifts.map((s) => {
                    const a = s.assignments?.find((a) => a.userId === user?.id);
                    return a ? (
                      <SelectItem key={a.id} value={a.id}>
                        {s.location?.name} — {new Date(s.startTime).toLocaleDateString()}
                      </SelectItem>
                    ) : null;
                  })}
                </SelectContent>
              </Select>
            </div>
            {type === "SWAP" && (
              <div className="space-y-1.5">
                <Label>Swap with</Label>
                <Select value={receiverId} onValueChange={setReceiverId}>
                  <SelectTrigger><SelectValue placeholder="Select colleague…" /></SelectTrigger>
                  <SelectContent>
                    {colleagues
                      .filter((u) => u.id !== user?.id)
                      .map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!assignmentId || (type === "SWAP" && !receiverId) || createMutation.isPending}
            >
              {createMutation.isPending ? "Sending…" : "Send request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
