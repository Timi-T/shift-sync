"use client";

import { Star, Users, Clock, MoreVertical, UserPlus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatLocalTime, formatDuration } from "@/lib/utils";
import type { Shift } from "@shift-sync/shared";

interface ShiftCardProps {
  shift: Shift;
  onAssign?:  (shift: Shift) => void;
  onCancel?:  (shift: Shift) => void;
  onPublish?: (shift: Shift) => void;
  /** If true, show management actions (assign, cancel). Manager-only. */
  managerView?: boolean;
  compact?: boolean;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT:     "border-l-slate-400  bg-slate-50",
  PUBLISHED: "border-l-blue-500   bg-blue-50/40",
  CANCELLED: "border-l-red-400    bg-red-50/40 opacity-60",
};

const STATUS_BADGE_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT:     "secondary",
  PUBLISHED: "default",
  CANCELLED: "destructive",
};

export function ShiftCard({
  shift,
  onAssign,
  onCancel,
  onPublish,
  managerView = false,
  compact = false,
}: ShiftCardProps) {
  const timezone = shift.location?.timezone ?? "UTC";
  const filledCount = shift.assignments?.filter((a) => a.status === "CONFIRMED" || a.status === "PENDING_SWAP").length ?? 0;
  const isFull = filledCount >= (shift.headcount ?? 1);
  const isUnderstaffed = filledCount < (shift.headcount ?? 1);

  return (
    <div
      className={cn(
        "rounded-md border-l-4 border border-border px-3 py-2 text-sm shadow-sm",
        STATUS_STYLES[shift.status] ?? "bg-white",
        shift.isPremium && shift.status === "PUBLISHED" && "shift-card-premium",
        compact ? "py-1.5" : "py-2.5",
      )}
    >
      {/* Top row: time + badges */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs">
            {formatLocalTime(shift.startTime, timezone)}–{formatLocalTime(shift.endTime, timezone)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {shift.isPremium && (
            <Badge variant="premium" className="gap-0.5 text-[10px] px-1.5 py-0">
              <Star className="h-2.5 w-2.5" /> Premium
            </Badge>
          )}
          <Badge variant={STATUS_BADGE_VARIANTS[shift.status] ?? "outline"} className="text-[10px] px-1.5 py-0">
            {shift.status}
          </Badge>
        </div>
      </div>

      {/* Skill */}
      {!compact && (
        <p className="mt-0.5 text-xs text-muted-foreground capitalize">
          {shift.skill?.name ?? shift.skillId}
        </p>
      )}

      {/* Staffing */}
      <div className="mt-1.5 flex items-center justify-between">
        <div className={cn("flex items-center gap-1 text-xs", isUnderstaffed && shift.status === "PUBLISHED" ? "text-amber-600 font-medium" : "text-muted-foreground")}>
          <Users className="h-3 w-3" />
          <span>
            {filledCount}/{shift.headcount} · {formatDuration(shift.startTime, shift.endTime)}
          </span>
        </div>

        {/* Manager actions */}
        {managerView && shift.status !== "CANCELLED" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 -mr-1">
                <MoreVertical className="h-3.5 w-3.5" />
                <span className="sr-only">Actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {shift.status === "DRAFT" && onPublish && (
                <DropdownMenuItem onClick={() => onPublish(shift)}>
                  Publish shift
                </DropdownMenuItem>
              )}
              {(shift.status === "DRAFT" || shift.status === "PUBLISHED") && !isFull && onAssign && (
                <DropdownMenuItem onClick={() => onAssign(shift)}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Assign staff
                </DropdownMenuItem>
              )}
              {onCancel && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => onCancel(shift)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Cancel shift
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Assigned staff pills (non-compact) */}
      {!compact && shift.assignments && shift.assignments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {shift.assignments
            .filter((a) => a.status !== "CANCELLED")
            .map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center rounded-full bg-white border px-2 py-0.5 text-[10px] font-medium"
              >
                {a.user?.name ?? a.userId}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
