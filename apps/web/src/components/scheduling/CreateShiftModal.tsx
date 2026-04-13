"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { shifts as shiftsApi, locations as locApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import type { AxiosError } from "axios";

// Mirrors createShiftSchema from @shift-sync/shared but localised for the form
const formSchema = z
  .object({
    locationId: z.string().min(1, "Location is required"),
    skillId: z.string().min(1, "Skill is required"),
    startTime: z.string().min(1, "Start time is required"),
    endTime: z.string().min(1, "End time is required"),
    headcount: z.coerce.number().int().min(1).max(20),
    notes: z.string().optional(),
  })
  .refine((d) => new Date(d.endTime) > new Date(d.startTime), {
    message: "End time must be after start time",
    path: ["endTime"],
  });

type FormValues = z.infer<typeof formSchema>;


interface Props {
  open: boolean;
  onClose: () => void;
  defaultLocationId?: string;
}

export function CreateShiftModal({ open, onClose, defaultLocationId }: Props) {
  const queryClient = useQueryClient();

  const { data: locationList = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => locApi.list(),
  });

  const { data: skillList = [] } = useQuery({
    queryKey: ["skills"],
    queryFn: () => locApi.skills(),
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { locationId: defaultLocationId ?? "", headcount: 1 },
  });

  const createMutation = useMutation({
    mutationFn: (data: FormValues) => {
      const startTime = new Date(data.startTime).toISOString();
      const endTime = new Date(data.endTime).toISOString();
      return shiftsApi.create({ ...data, startTime, endTime, notes: undefined })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast({ title: "Shift created", description: "The shift has been saved as a draft." });
      reset();
      onClose();
    },
    onError: (err: AxiosError<{ error?: string; details?: { fieldErrors?: Record<string, string[]> } }>) => {
      const body = err.response?.data;
      const firstError = body?.details?.fieldErrors
        ? Object.values(body.details.fieldErrors).flat()[0]
        : body?.error ?? "Could not create shift.";
      toast({ variant: "destructive", title: "Error", description: firstError });
    },
  });

  const handleClose = () => { reset(); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Create Shift</DialogTitle>
        </DialogHeader>

        <form
          id="create-shift-form"
          onSubmit={handleSubmit((data) => createMutation.mutate(data))}
          className="space-y-4 py-2"
        >
          {/* Location */}
          <div className="space-y-1.5">
            <Label htmlFor="locationId">Location</Label>
            <Select
              value={watch("locationId")}
              onValueChange={(v) => setValue("locationId", v, { shouldValidate: true })}
            >
              <SelectTrigger id="locationId">
                <SelectValue placeholder="Select location…" />
              </SelectTrigger>
              <SelectContent>
                {locationList.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.locationId && <p className="text-xs text-destructive">{errors.locationId.message}</p>}
          </div>

          {/* Skill */}
          <div className="space-y-1.5">
            <Label htmlFor="skillId">Required skill</Label>
            <Select
              value={watch("skillId")}
              onValueChange={(v) => setValue("skillId", v, { shouldValidate: true })}
            >
              <SelectTrigger id="skillId">
                <SelectValue placeholder="Select skill…" />
              </SelectTrigger>
              <SelectContent>
                {skillList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.skillId && <p className="text-xs text-destructive">{errors.skillId.message}</p>}
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="startTime">Start</Label>
              <Input id="startTime" type="datetime-local" {...register("startTime")} />
              {errors.startTime && <p className="text-xs text-destructive">{errors.startTime.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endTime">End</Label>
              <Input id="endTime" type="datetime-local" {...register("endTime")} />
              {errors.endTime && <p className="text-xs text-destructive">{errors.endTime.message}</p>}
            </div>
          </div>

          {/* Headcount */}
          <div className="space-y-1.5">
            <Label htmlFor="headcount">Headcount</Label>
            <Input id="headcount" type="number" min={1} max={20} {...register("headcount")} className="w-24" />
            {errors.headcount && <p className="text-xs text-destructive">{errors.headcount.message}</p>}
          </div>

          {/* Notes */}
          {/* <div className="space-y-1.5">
            <Label htmlFor="notes">Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input id="notes" {...register("notes")} placeholder="e.g. Busy Friday dinner service" />
          </div> */}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button type="submit" form="create-shift-form" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
