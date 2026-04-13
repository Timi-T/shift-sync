"use client";

/**
 * CreateUserModal — admin form to create a new staff/manager account.
 *
 * Collects: name, email, password, role, desired hours/week, skill assignments,
 * and location certifications. All submitted in a single POST /api/users call.
 *
 * The backend handles: bcrypt hashing, audit log, notification prefs default.
 */

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { users as usersApi, locations as locApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import type { AxiosError } from "axios";

// ─── Validation ───────────────────────────────────────────────────────────────

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Valid email required"),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "Password must contain uppercase, lowercase, and a number"),
  role: z.enum(["STAFF", "MANAGER", "ADMIN"], { required_error: "Role is required" }),
  desiredHoursPerWeek: z.coerce.number().int().min(1).max(40).optional(),
});

type FormValues = z.infer<typeof formSchema>;


const ROLE_DESCRIPTIONS: Record<string, string> = {
  STAFF: "Can view their own schedule, request swaps, set availability",
  MANAGER: "Can create/publish shifts, assign staff, approve swaps for their locations",
  ADMIN: "Full platform access — manage users, all locations, audit log",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateUserModal({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);

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
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { role: "STAFF", desiredHoursPerWeek: 35 },
    mode: "onTouched",
  });

  const selectedRole = watch("role");
  const passwordValue = watch("password") ?? "";

  const createMutation = useMutation({
    mutationFn: (data: FormValues) =>
      usersApi.create({
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role,
        desiredHoursPerWeek: data.desiredHoursPerWeek,
        skillIds: selectedSkills,
        locationIds: selectedLocations,
      } as never),
    onSuccess: (newUser) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({
        title: "Account created",
        description: `${newUser.name} can now log in with ${newUser.email}`,
      });
      handleClose();
    },
    onError: (err: AxiosError<{ error?: string; code?: string }>) => {
      const msg = err.response?.data?.error ?? "Could not create account.";
      toast({ variant: "destructive", title: "Error", description: msg });
    },
  });

  const handleClose = () => {
    reset();
    setSelectedSkills([]);
    setSelectedLocations([]);
    setShowPassword(false);
    onClose();
  };

  const toggleSkill = (id: string) =>
    setSelectedSkills((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);

  const toggleLocation = (id: string) =>
    setSelectedLocations((prev) => prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Account</DialogTitle>
        </DialogHeader>

        <form
          id="create-user-form"
          onSubmit={handleSubmit((data) => createMutation.mutate(data))}
          className="space-y-5 py-2"
        >
          {/* Name + Email */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cu-name">Full name</Label>
              <Input id="cu-name" placeholder="Sarah Chen" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cu-email">Email</Label>
              <Input id="cu-email" type="email" placeholder="sarah@coastaleats.com" {...register("email")} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <Label htmlFor="cu-password">Temporary password</Label>
            <div className="relative">
              <Input
                id="cu-password"
                type={showPassword ? "text" : "password"}
                placeholder="Min 8 characters"
                {...register("password")}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {passwordValue.length > 0 && (
              <ul className="text-xs space-y-0.5">
                {[
                  { ok: passwordValue.length >= 8, label: "At least 8 characters" },
                  { ok: /[A-Z]/.test(passwordValue), label: "One uppercase letter" },
                  { ok: /[a-z]/.test(passwordValue), label: "One lowercase letter" },
                  { ok: /\d/.test(passwordValue), label: "One number" },
                ].map(({ ok, label }) => (
                  <li key={label} className={ok ? "text-green-600" : "text-destructive"}>
                    {ok ? "✓" : "✗"} {label}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Share this with the staff member — they should change it after first login.
            </p>
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <Label htmlFor="cu-role">Role</Label>
            <Controller
              name="role"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="cu-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STAFF">Staff</SelectItem>
                    <SelectItem value="MANAGER">Manager</SelectItem>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {errors.role && <p className="text-xs text-destructive">{errors.role.message}</p>}
            <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[selectedRole]}</p>
          </div>

          {/* Desired hours — only meaningful for staff */}
          {selectedRole === "STAFF" && (
            <div className="space-y-1.5">
              <Label htmlFor="cu-hours">Desired hours / weeks</Label>
              <Input
                id="cu-hours"
                type="number"
                min={1}
                max={40}
                placeholder="1–40"
                className="w-28"
                {...register("desiredHoursPerWeek")}
              />
              {errors.desiredHoursPerWeek ? (
                <p className="text-xs text-destructive">{errors.desiredHoursPerWeek.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Maximum 40 hours</p>
              )}
            </div>
          )}

          {/* Skills (staff/manager) */}
          {selectedRole !== "ADMIN" && (
            <div className="space-y-2">
              <Label>Skills</Label>
              <div className="flex flex-wrap gap-2">
                {skillList.map((skill) => {
                  const active = selectedSkills.includes(skill.id);
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleSkill(skill.id)}
                      className="rounded-full border px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                      style={{
                        background: active ? "hsl(var(--primary))" : "transparent",
                        color: active ? "hsl(var(--primary-foreground))" : "inherit",
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

          {/* Location certifications (staff) / Managed locations (manager) */}
          {selectedRole !== "ADMIN" && locationList.length > 0 && (
            <div className="space-y-2">
              <Label>
                {selectedRole === "MANAGER" ? "Managed locations" : "Location certifications"}
              </Label>
              <div className="flex flex-wrap gap-2">
                {(locationList as Array<{ id: string; name: string; timezone: string }>).map((loc) => {
                  const active = selectedLocations.includes(loc.id);
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => toggleLocation(loc.id)}
                      className="rounded-full border px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                      style={{
                        background: active ? "hsl(var(--primary))" : "transparent",
                        color: active ? "hsl(var(--primary-foreground))" : "inherit",
                        borderColor: active ? "hsl(var(--primary))" : "hsl(var(--border))",
                      }}
                    >
                      {loc.name}
                      <span className="ml-1 opacity-60 text-[10px]">
                        {loc.timezone.split("/")[1]?.replace("_", " ")}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedRole === "MANAGER"
                  ? "Managers can only create and publish shifts at their assigned locations."
                  : "Staff can only be assigned to shifts at certified locations."}
              </p>
            </div>
          )}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            type="submit"
            form="create-user-form"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? "Creating…" : "Create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
