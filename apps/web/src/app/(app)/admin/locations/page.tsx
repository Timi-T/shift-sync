"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { locations as locationsApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import type { Location } from "@shift-sync/shared";
import type { AxiosError } from "axios";

// ─── Common IANA timezones ────────────────────────────────────────────────────

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface LocationFormData {
  name: string;
  timezone: string;
  address: string;
}

const EMPTY_FORM: LocationFormData = { name: "", timezone: "America/New_York", address: "" };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminLocationsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen]   = useState(false);
  const [editTarget, setEditTarget] = useState<Location | null>(null);
  const [form, setForm]             = useState<LocationFormData>(EMPTY_FORM);

  const { data: locationList = [], isLoading } = useQuery({
    queryKey: ["locations"],
    queryFn:  () => locationsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data: LocationFormData) => locationsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      toast({ title: "Location created" });
      closeModal();
    },
    onError: (err: AxiosError<{ error?: string }>) => {
      toast({ variant: "destructive", title: "Error", description: err.response?.data?.error ?? "Could not create location." });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: LocationFormData }) =>
      locationsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      toast({ title: "Location updated" });
      closeModal();
    },
    onError: (err: AxiosError<{ error?: string }>) => {
      toast({ variant: "destructive", title: "Error", description: err.response?.data?.error ?? "Could not update location." });
    },
  });

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(loc: Location) {
    setEditTarget(loc);
    setForm({ name: loc.name, timezone: loc.timezone, address: loc.address });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditTarget(null);
    setForm(EMPTY_FORM);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.address.trim()) return;
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Locations</h2>
          <p className="text-sm text-muted-foreground">
            {locationList.length} location{locationList.length !== 1 ? "s" : ""} configured
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add location
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : locationList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No locations yet. Add your first location.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Address</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Timezone</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {locationList.map((loc) => (
                <tr key={loc.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{loc.name}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{loc.address}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell font-mono text-xs">{loc.timezone}</td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(loc)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span className="sr-only">Edit</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit modal */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit location" : "New location"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="loc-name">Name</Label>
              <Input
                id="loc-name"
                placeholder="e.g. Downtown Branch"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                minLength={2}
                maxLength={100}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="loc-address">Address</Label>
              <Input
                id="loc-address"
                placeholder="e.g. 123 Main St, Springfield, IL"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                required
                minLength={5}
                maxLength={200}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="loc-tz">Timezone</Label>
              <select
                id="loc-tz"
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={closeModal} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving || !form.name.trim() || !form.address.trim()}>
                {isSaving ? "Saving…" : editTarget ? "Save changes" : "Create location"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
