"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { OvertimeDashboard } from "@/components/analytics/OvertimeDashboard";
import { FairnessReport } from "@/components/analytics/FairnessReport";
import { locations as locApi } from "@/lib/api";

export default function ManagerAnalyticsPage() {
  const [locationId, setLocationId] = useState("");

  const { data: locationList = [] } = useQuery({
    queryKey: ["locations"],
    queryFn:  () => locApi.list(),
    onSuccess: (data: Array<{id: string}>) => { if (data[0] && !locationId) setLocationId(data[0].id); },
  } as never);

  const selectedLocation = (locationList as Array<{ id: string; name: string; timezone: string }>).find(
    (l) => l.id === locationId,
  );

  return (
    <div className="space-y-6">
      {/* Location filter */}
      <div className="flex items-center gap-3">
        <Select value={locationId} onValueChange={setLocationId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Select location…" />
          </SelectTrigger>
          <SelectContent>
            {(locationList as Array<{ id: string; name: string }>).map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold mb-3">Overtime Projections</h3>
          <OvertimeDashboard locationId={locationId} />
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-3">Premium Shift Fairness</h3>
          {locationId && (
            <FairnessReport locationId={locationId} locationName={selectedLocation?.name} />
          )}
        </div>
      </div>
    </div>
  );
}
