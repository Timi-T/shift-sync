"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Users, TrendingUp, AlertTriangle } from "lucide-react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OnDutyDashboard } from "@/components/scheduling/OnDutyDashboard";
import { shifts as shiftsApi, analytics } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

function StatCard({ title, value, sub, icon, accent }: {
  title: string; value: string | number; sub?: string;
  icon: React.ReactNode; accent?: "red" | "amber" | "green";
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{title}</p>
          <span className={accent === "red" ? "text-red-500" : accent === "amber" ? "text-amber-500" : "text-muted-foreground"}>{icon}</span>
        </div>
        <p className="mt-2 text-3xl font-bold">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function ManagerOverviewPage() {
  const { user } = useAuth();
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd   = endOfWeek(today, { weekStartsOn: 1 });

  const { data: weekShifts = [] } = useQuery({
    queryKey: ["shifts", "week", format(weekStart, "yyyy-MM-dd")],
    queryFn:  () => shiftsApi.list({
      startDate: format(weekStart, "yyyy-MM-dd"),
      endDate:   format(weekEnd,   "yyyy-MM-dd"),
    }),
  });

  const { data: overtimeProjections = [] } = useQuery({
    queryKey: ["overtime", format(weekStart, "yyyy-MM-dd")],
    queryFn:  () => analytics.overtime({ weekStart: format(weekStart, "yyyy-MM-dd") }),
  });

  const publishedCount    = weekShifts.filter((s) => s.status === "PUBLISHED").length;
  const draftCount        = weekShifts.filter((s) => s.status === "DRAFT").length;
  const overtimeCount     = overtimeProjections.filter((p) => p.overtimeHours > 0).length;
  const approachingCount  = overtimeProjections.filter((p) => p.currentWeekHours >= 35 && p.overtimeHours === 0).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Good {greeting()}, {user?.name?.split(" ")[0]}</h2>
        <p className="text-sm text-muted-foreground">Week of {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Published shifts"
          value={publishedCount}
          sub="this week"
          icon={<CalendarDays className="h-5 w-5" />}
        />
        <StatCard
          title="Draft shifts"
          value={draftCount}
          sub="not yet published"
          icon={<CalendarDays className="h-5 w-5" />}
          accent={draftCount > 0 ? "amber" : undefined}
        />
        <StatCard
          title="Overtime risk"
          value={overtimeCount}
          sub="staff over 40h"
          icon={<AlertTriangle className="h-5 w-5" />}
          accent={overtimeCount > 0 ? "red" : undefined}
        />
        <StatCard
          title="Approaching 40h"
          value={approachingCount}
          sub="≥35h this week"
          icon={<TrendingUp className="h-5 w-5" />}
          accent={approachingCount > 0 ? "amber" : undefined}
        />
      </div>

      {/* On Duty */}
      <OnDutyDashboard />
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
