"use client";

import { AvailabilityEditor } from "@/components/availability/AvailabilityEditor";
import { useAuth } from "@/contexts/AuthContext";

export default function StaffAvailabilityPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="max-w-xl space-y-2">
      <p className="text-sm text-muted-foreground">
        Set the hours when you are available to work. Managers will only assign you to shifts
        that fall within your availability windows. EXCEPTION entries override RECURRING rules
        for specific dates.
      </p>
      <AvailabilityEditor userId={user.id} />
    </div>
  );
}
