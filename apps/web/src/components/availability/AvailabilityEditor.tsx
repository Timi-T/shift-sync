"use client";

/**
 * AvailabilityEditor — lets a staff member set their recurring weekly
 * availability and one-off exceptions.
 *
 * Each row represents one AvailabilityWindow. Toggling "Available" creates
 * a blocking exception (available: false) or a normal window (available: true).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { availability as availApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import type { AvailabilityWindow } from "@shift-sync/shared";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Props { userId: string }

export function AvailabilityEditor({ userId }: Props) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    type: "RECURRING" as "RECURRING" | "EXCEPTION",
    dayOfWeek: "1",
    date: "",
    startTime: "09:00",
    endTime: "17:00",
    available: "true",
  });

  const { data: windows = [], isLoading } = useQuery({
    queryKey: ["availability", userId],
    queryFn: () => availApi.list(),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      availApi.upsert({
        type: form.type,
        dayOfWeek: form.type === "RECURRING" ? Number(form.dayOfWeek) : undefined,
        date: form.type === "EXCEPTION" ? form.date : undefined,
        startTime: form.startTime,
        endTime: form.endTime,
        available: form.available === "true",
      })
    ,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability", userId] });
      toast({ title: "Saved", description: "Availability updated." });
      setAdding(false);
    },
    onError: (e) => toast({ variant: "destructive", title: "Error", description: e.message || "Could not save availability." }),
  });

  const removeMutation = useMutation({
    mutationFn: (windowId: string) => availApi.remove(windowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability", userId] });
    },
  });

  const recurring = windows.filter((w) => w.type === "RECURRING").sort((a, b) => (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0));
  const exceptions = windows.filter((w) => w.type === "EXCEPTION").sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Recurring Availability</CardTitle>
          <Button size="sm" variant="outline" onClick={() => { setAdding(true); setForm((f) => ({ ...f, type: "RECURRING" })); }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add
          </Button>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {isLoading ? (
            <div className="h-12 animate-pulse rounded bg-muted" />
          ) : recurring.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recurring windows set. Staff are assumed unavailable by default.</p>
          ) : (
            <div className="space-y-1">
              {recurring.map((w) => (
                <WindowRow key={w.id} window={w} onRemove={() => removeMutation.mutate(w.id)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">One-off Exceptions</CardTitle>
          <Button size="sm" variant="outline" onClick={() => { setAdding(true); setForm((f) => ({ ...f, type: "EXCEPTION" })); }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add
          </Button>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {isLoading ? (
            <div className="h-12 animate-pulse rounded bg-muted" />
          ) : exceptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No exceptions.</p>
          ) : (
            <div className="space-y-1">
              {exceptions.map((w) => (
                <WindowRow key={w.id} window={w} onRemove={() => removeMutation.mutate(w.id)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add form (inline) */}
      {adding && (
        <Card className="border-primary/50 shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm">New {form.type === "RECURRING" ? "Recurring" : "Exception"} Window</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {form.type === "RECURRING" ? (
              <div className="space-y-1.5">
                <Label>Day of week</Label>
                <Select value={form.dayOfWeek} onValueChange={(v) => setForm((f) => ({ ...f, dayOfWeek: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAY_NAMES.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start time</Label>
                <Input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>End time</Label>
                <Input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.available} onValueChange={(v) => setForm((f) => ({ ...f, available: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Available</SelectItem>
                  <SelectItem value="false">Unavailable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>
                <Check className="h-3.5 w-3.5 mr-1" /> Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
                <X className="h-3.5 w-3.5 mr-1" /> Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function WindowRow({ window: w, onRemove }: { window: AvailabilityWindow; onRemove: () => void }) {
  const label = w.type === "RECURRING"
    ? DAY_NAMES[w.dayOfWeek ?? 0]
    : w.date;

  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant={w.available ? "success" : "destructive"} className="text-[10px] px-1.5 py-0">
          {w.available ? "Available" : "Unavailable"}
        </Badge>
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{w.startTime} – {w.endTime}</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span className="sr-only">Remove</span>
      </Button>
    </div>
  );
}
