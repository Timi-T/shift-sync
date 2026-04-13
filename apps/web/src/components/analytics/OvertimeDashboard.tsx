"use client";

/**
 * OvertimeDashboard — shows the current week's overtime projections.
 * Highlights staff approaching or exceeding 40h.
 */

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, TrendingUp, Clock } from "lucide-react";
import { startOfWeek, format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { analytics } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { OvertimeProjection } from "@shift-sync/shared";

interface Props {
  locationId?: string;
}

function HoursBar({ current, max = 40 }: { current: number; max?: number }) {
  const pct = Math.min((current / max) * 100, 100);
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          current >= max        ? "bg-red-500"
            : current >= max * 0.875 ? "bg-amber-500"
            : "bg-blue-500",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function OvertimeDashboard({ locationId }: Props) {
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");

  const { data: projections = [], isLoading } = useQuery({
    queryKey: ["overtime", weekStart, locationId],
    queryFn:  () => analytics.overtime({ weekStart, locationId }),
  });

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }

  const overLimit     = projections.filter((p) => p.overtimeHours > 0);
  const approaching   = projections.filter((p) => p.overtimeHours === 0 && p.currentWeekHours >= 35);

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          label="Total staff"
          value={projections.length}
          icon={<Clock className="h-4 w-4" />}
        />
        <SummaryCard
          label="Over 40h"
          value={overLimit.length}
          variant={overLimit.length > 0 ? "danger" : "ok"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <SummaryCard
          label="Approaching 40h"
          value={approaching.length}
          variant={approaching.length > 0 ? "warn" : "ok"}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      {/* Per-staff table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm">Week of {weekStart}</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {projections.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No projections for this week.</p>
          ) : (
            <div className="space-y-3">
              {projections.map((p) => (
                <StaffRow key={p.userId} projection={p} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  variant = "neutral",
  icon,
}: {
  label: string;
  value: number;
  variant?: "ok" | "warn" | "danger" | "neutral";
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{label}</p>
          <span className={cn(
            "text-muted-foreground",
            variant === "danger" && value > 0 && "text-red-500",
            variant === "warn"   && value > 0 && "text-amber-500",
          )}>{icon}</span>
        </div>
        <p className={cn(
          "mt-1 text-2xl font-bold",
          variant === "danger" && value > 0 && "text-red-500",
          variant === "warn"   && value > 0 && "text-amber-500",
        )}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function StaffRow({ projection: p }: { projection: OvertimeProjection }) {
  const isOver   = p.overtimeHours > 0;
  const isNear   = !isOver && p.currentWeekHours >= 35;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{p.name}</span>
        <div className="flex items-center gap-2">
          {isOver && (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
              +{p.overtimeHours.toFixed(1)}h OT
            </Badge>
          )}
          {isNear && (
            <Badge variant="warning" className="text-[10px] px-1.5 py-0">
              Approaching 40h
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {p.currentWeekHours.toFixed(1)}h / {p.desiredHoursPerWeek ?? 40}h
          </span>
        </div>
      </div>
      <HoursBar current={p.currentWeekHours} max={p.desiredHoursPerWeek ?? 40} />
    </div>
  );
}
