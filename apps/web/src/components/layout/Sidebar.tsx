"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays, Users, BarChart3, Settings, MapPin,
  RefreshCw, ClipboardList, Home, LogOut, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

interface NavItem {
  href:  string;
  label: string;
  icon:  React.ComponentType<{ className?: string }>;
  roles: string[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/admin",              label: "Overview",      icon: Home,          roles: ["ADMIN"] },
  { href: "/admin/locations",    label: "Locations",     icon: MapPin,        roles: ["ADMIN"] },
  { href: "/admin/users",        label: "Users",         icon: Users,         roles: ["ADMIN"] },
  { href: "/admin/audit",        label: "Audit Log",     icon: ClipboardList, roles: ["ADMIN"] },
  { href: "/manager",            label: "Overview",      icon: Home,          roles: ["MANAGER"] },
  { href: "/manager/schedule",   label: "Schedule",      icon: CalendarDays,  roles: ["MANAGER"] },
  { href: "/manager/staff",      label: "Staff",         icon: Users,         roles: ["MANAGER"] },
  { href: "/manager/analytics",  label: "Analytics",     icon: BarChart3,     roles: ["MANAGER"] },
  { href: "/staff",              label: "My Shifts",     icon: CalendarDays,  roles: ["STAFF"] },
  { href: "/staff/availability", label: "Availability",  icon: Settings,      roles: ["STAFF"] },
  { href: "/staff/swaps",        label: "Swap Requests", icon: RefreshCw,     roles: ["STAFF"] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  if (!user) return null;

  const items = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  return (
    <aside className="flex h-full w-60 flex-col border-r bg-white">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold tracking-tight">ShiftSync</span>
      </div>

      {/* Location badge */}
      <div className="border-b px-6 py-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Coastal Eats</p>
        <p className="text-sm font-medium">{user.name}</p>
        <p className="text-xs text-muted-foreground capitalize">{user.role.toLowerCase()}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Logout */}
      <div className="border-t p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={() => logout()}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
