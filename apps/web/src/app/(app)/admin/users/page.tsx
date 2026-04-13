"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, MoreVertical, ShieldCheck, Users, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CreateUserModal } from "@/components/admin/CreateUserModal";
import { EditUserModal } from "@/components/admin/EditUserModal";
import { users as usersApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import type { User } from "@shift-sync/shared";
import type { AxiosError } from "axios";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

const ROLE_CONFIG = {
  ADMIN:   { label: "Admin",   color: "text-purple-700 bg-purple-100", icon: ShieldCheck },
  MANAGER: { label: "Manager", color: "text-blue-700 bg-blue-100",     icon: UserCog },
  STAFF:   { label: "Staff",   color: "text-slate-700 bg-slate-100",   icon: Users },
} as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [search, setSearch]         = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");

  const { data: allUsers = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn:  () => usersApi.list(),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      usersApi.patchRole(id, role),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "Role updated", description: `Role changed to ${vars.role}.` });
    },
    onError: (err: AxiosError<{ error?: string }>) => {
      toast({ variant: "destructive", title: "Error", description: err.response?.data?.error ?? "Could not update role." });
    },
  });

  // Filter
  const filtered = allUsers
    .filter((u) => roleFilter === "ALL" || u.role === roleFilter)
    .filter((u) =>
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
    );

  const counts = {
    ADMIN:   allUsers.filter((u) => u.role === "ADMIN").length,
    MANAGER: allUsers.filter((u) => u.role === "MANAGER").length,
    STAFF:   allUsers.filter((u) => u.role === "STAFF").length,
  };

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {(["ADMIN", "MANAGER", "STAFF"] as const).map((role) => {
          const cfg = ROLE_CONFIG[role];
          const Icon = cfg.icon;
          return (
            <button
              key={role}
              onClick={() => setRoleFilter((r) => r === role ? "ALL" : role)}
              className={`rounded-lg border p-4 text-left transition-all hover:shadow-sm ${roleFilter === role ? "ring-2 ring-primary" : ""}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{cfg.label}s</span>
              </div>
              <p className="mt-1 text-2xl font-bold">{counts[role]}</p>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            <SelectItem value="STAFF">Staff</SelectItem>
            <SelectItem value="MANAGER">Manager</SelectItem>
            <SelectItem value="ADMIN">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="ml-auto">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add account
        </Button>
      </div>

      {/* User list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {search || roleFilter !== "ALL" ? "No users match your filters." : "No users yet. Create the first account."}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Skills</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Locations</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Target hrs</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  onRoleChange={(role) => updateRoleMutation.mutate({ id: user.id, role })}
                  onEdit={() => setEditTarget(user)}
                  isUpdating={updateRoleMutation.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {filtered.length} of {allUsers.length} user{allUsers.length !== 1 ? "s" : ""}
      </p>

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <EditUserModal
        user={editTarget}
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
      />
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function UserRow({
  user,
  onRoleChange,
  onEdit,
  isUpdating,
}: {
  user: User;
  onRoleChange: (role: string) => void;
  onEdit: () => void;
  isUpdating: boolean;
}) {
  const cfg = ROLE_CONFIG[user.role as keyof typeof ROLE_CONFIG] ?? ROLE_CONFIG.STAFF;

  return (
    <tr className="hover:bg-muted/20 transition-colors">
      {/* Avatar + name + email */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className={`text-xs font-semibold ${cfg.color}`}>
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium leading-tight">{user.name}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </td>

      {/* Role badge */}
      <td className="px-4 py-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.color}`}>
          {cfg.label}
        </span>
      </td>

      {/* Skills */}
      <td className="px-4 py-3 hidden md:table-cell">
        <div className="flex flex-wrap gap-1">
          {(user as never as { skills?: Array<{ name: string }> }).skills?.map((s) => (
            <Badge key={s.name} variant="secondary" className="text-[10px] px-1.5 py-0">{s.name}</Badge>
          )) ?? <span className="text-muted-foreground text-xs">—</span>}
        </div>
      </td>

      {/* Locations */}
      <td className="px-4 py-3 hidden lg:table-cell">
        <div className="flex flex-wrap gap-1">
          {(user as never as { locationCertifications?: Array<{ name: string }> }).locationCertifications?.map((l) => (
            <Badge key={l.name} variant="outline" className="text-[10px] px-1.5 py-0">{l.name}</Badge>
          )) ?? <span className="text-muted-foreground text-xs">—</span>}
        </div>
      </td>

      {/* Desired hours */}
      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
        {user.desiredHoursPerWeek != null ? `${user.desiredHoursPerWeek}h` : "—"}
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={isUpdating}>
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {user.role !== "ADMIN" && (
              <DropdownMenuItem onClick={onEdit}>
                Edit skills &amp; locations
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-xs text-muted-foreground font-medium">
              Change role
            </DropdownMenuItem>
            {user.role !== "STAFF"    && <DropdownMenuItem onClick={() => onRoleChange("STAFF")}>Set as Staff</DropdownMenuItem>}
            {user.role !== "MANAGER"  && <DropdownMenuItem onClick={() => onRoleChange("MANAGER")}>Set as Manager</DropdownMenuItem>}
            {user.role !== "ADMIN"    && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onRoleChange("ADMIN")}
                  className="text-purple-700 focus:text-purple-700"
                >
                  Promote to Admin
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
