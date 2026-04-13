"use client";

import { usePathname } from "next/navigation";
import { NotificationBell } from "./NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const PAGE_TITLES: Record<string, string> = {
  "/admin":              "Overview",
  "/admin/locations":    "Locations",
  "/admin/users":        "User Management",
  "/admin/audit":        "Audit Log",
  "/manager":            "Overview",
  "/manager/schedule":   "Schedule",
  "/manager/staff":      "Staff",
  "/manager/analytics":  "Analytics",
  "/staff":              "My Shifts",
  "/staff/availability": "Availability",
  "/staff/swaps":        "Swap Requests",
  "/notifications":      "Notifications",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Header() {
  const pathname  = usePathname();
  const { user }  = useAuth();

  const title = PAGE_TITLES[pathname] ?? "ShiftSync";

  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="flex items-center gap-3">
        <NotificationBell />
        {user && (
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
    </header>
  );
}
