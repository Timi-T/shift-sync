"use client";

/**
 * EditUserModal — admin/manager form to edit an existing user's skills and locations.
 *
 * Sends PUT /api/users/:id with skillIds and locationIds.
 * For MANAGER users, locationIds maps to LocationManager on the backend.
 * For STAFF users, locationIds maps to LocationCertification.
 */

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { users as usersApi, locations as locApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import type { User } from "@shift-sync/shared";
import type { AxiosError } from "axios";

interface Props {
  user: User | null;
  open: boolean;
  onClose: () => void;
}

export function EditUserModal({ user, open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);

  // Fetch available skills and locations
  const { data: allSkills = [] } = useQuery({
    queryKey: ["skills"],
    queryFn: () => locApi.skills(),
  });

  const { data: locationList = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => locApi.list(),
  });

  // Seed selections from the user prop when the modal opens.
  // The backend returns managed locations in locationCertifications for MANAGER role.
  useEffect(() => {
    if (!user || !open) return;
    setSelectedSkills((user.skills ?? []).map((s) => s.id));
    setSelectedLocations((user.locationCertifications ?? []).map((l) => l.id));
  }, [user?.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateMutation = useMutation({
    mutationFn: () =>
      usersApi.update(user!.id, {
        skillIds: selectedSkills,
        locationIds: selectedLocations,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "User updated", description: "Skills and locations saved." });
      onClose();
    },
    onError: (err: AxiosError<{ error?: string }>) => {
      toast({ variant: "destructive", title: "Error", description: err.response?.data?.error ?? "Could not update user." });
    },
  });

  const toggleSkill = (id: string) =>
    setSelectedSkills((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);

  const toggleLocation = (id: string) =>
    setSelectedLocations((prev) => prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]);

  if (!user) return null;

  const isManager = user.role === "MANAGER";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Edit {user.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Skills — relevant for staff and managers */}
          {user.role !== "ADMIN" && (
            <div className="space-y-2">
              <Label>Skills</Label>
              <div className="flex flex-wrap gap-2">
                {allSkills.map((skill) => {
                  const active = selectedSkills.includes(skill.id);
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleSkill(skill.id)}
                      className="rounded-full border px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                      style={{
                        background:  active ? "hsl(var(--primary))" : "transparent",
                        color:       active ? "hsl(var(--primary-foreground))" : "inherit",
                        borderColor: active ? "hsl(var(--primary))" : "hsl(var(--border))",
                      }}
                    >
                      {skill.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Skills determine which shifts this person can be assigned to.
              </p>
            </div>
          )}

          {/* Locations */}
          {user.role !== "ADMIN" && locationList.length > 0 && (
            <div className="space-y-2">
              <Label>
                {isManager ? "Managed locations" : "Location certifications"}
              </Label>
              <div className="flex flex-wrap gap-2">
                {locationList.map((loc) => {
                  const active = selectedLocations.includes(loc.id);
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => toggleLocation(loc.id)}
                      className="rounded-full border px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                      style={{
                        background:  active ? "hsl(var(--primary))" : "transparent",
                        color:       active ? "hsl(var(--primary-foreground))" : "inherit",
                        borderColor: active ? "hsl(var(--primary))" : "hsl(var(--border))",
                      }}
                    >
                      {loc.name}
                      <span className="ml-1 opacity-60 text-[10px]">
                        {(loc as { timezone: string }).timezone?.split("/")[1]?.replace("_", " ")}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {isManager
                  ? "Managers can only create/publish shifts at their assigned locations."
                  : "Staff can only be assigned to shifts at certified locations."}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
