"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { subDays, format } from "date-fns";
import { Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { analytics } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  locationId: string;
  locationName?: string;
}

export function FairnessReport({ locationId, locationName }: Props) {
  const endDate   = format(new Date(), "yyyy-MM-dd");
  const startDate = format(subDays(new Date(), 28), "yyyy-MM-dd");

  const { data: report, isLoading } = useQuery({
    queryKey: ["fairness", locationId, startDate, endDate],
    queryFn:  () => analytics.fairness(locationId, startDate, endDate),
    enabled:  !!locationId,
  });

  if (isLoading) return <div className="h-48 animate-pulse rounded-lg bg-muted" />;
  if (!report) return null;

  const score = report.fairnessScore;
  const scoreColor =
    score >= 80 ? "text-green-600"
    : score >= 60 ? "text-amber-600"
    : "text-red-600";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm">Premium Shift Fairness</CardTitle>
            <CardDescription className="text-xs">
              {locationName} · Last 28 days
            </CardDescription>
          </div>
          <div className="text-right">
            <p className={cn("text-3xl font-bold tabular-nums", scoreColor)}>
              {score}
            </p>
            <p className="text-xs text-muted-foreground">/ 100</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {report.staff.map((s) => (
          <div key={s.userId} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{s.name ?? s.userId}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">
                  {s.totalHours.toFixed(0)}h · {s.totalShifts} shifts
                </span>
                <div className="flex items-center gap-0.5 text-amber-500">
                  <Star className="h-3 w-3 fill-current" />
                  <span className="font-medium">{s.premiumShifts}</span>
                  <span className="text-muted-foreground ml-0.5">({s.premiumSharePercent}%)</span>
                </div>
              </div>
            </div>
            {/* Bar showing premium share */}
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-400 transition-all"
                style={{ width: `${s.premiumSharePercent}%` }}
              />
            </div>
          </div>
        ))}

        {report.staff.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No assignments in this period.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
