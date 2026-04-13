"use client";

import { useQuery } from "@tanstack/react-query";
import { Users, MapPin, CalendarDays, ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { users as usersApi, locations as locApi, shifts as shiftsApi } from "@/lib/api";
import { format, startOfWeek, endOfWeek } from "date-fns";

export default function AdminOverviewPage() {
  const today = new Date();

  const { data: allUsers = [] }   = useQuery({ queryKey: ["users"], queryFn: () => usersApi.list() });
  const { data: locationList = [] } = useQuery({ queryKey: ["locations"], queryFn: () => locApi.list() });
  const { data: weekShifts = [] } = useQuery({
    queryKey: ["shifts", "admin-week"],
    queryFn:  () => shiftsApi.list({
      startDate: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      endDate:   format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    }),
  });

  const staffCount   = allUsers.filter((u) => u.role === "STAFF").length;
  const managerCount = allUsers.filter((u) => u.role === "MANAGER").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Users className="h-5 w-5" />}   title="Staff"     value={staffCount}            sub="active accounts" />
        <StatCard icon={<Users className="h-5 w-5" />}   title="Managers"  value={managerCount}          sub="active accounts" />
        <StatCard icon={<MapPin className="h-5 w-5" />}  title="Locations" value={locationList.length}   sub="restaurant sites" />
        <StatCard icon={<CalendarDays className="h-5 w-5" />} title="Shifts this week" value={weekShifts.length} sub="all statuses" />
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3">User Breakdown</h3>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Email</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {allUsers.map((u) => (
                <tr key={u.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 font-medium">{u.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs font-medium ${u.role === "ADMIN" ? "text-purple-600" : u.role === "MANAGER" ? "text-blue-600" : "text-muted-foreground"}`}>
                      {u.role}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, title, value, sub }: { icon: React.ReactNode; title: string; value: number; sub: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{title}</p>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <p className="mt-2 text-3xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      </CardContent>
    </Card>
  );
}
