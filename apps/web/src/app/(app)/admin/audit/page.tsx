"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Filter, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { audit as auditApi, locations as locationsApi } from "@/lib/api";
import { format } from "date-fns";
import type { AuditLogEntry } from "@shift-sync/shared";

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_TYPES = ["", "Shift", "ShiftAssignment", "SwapRequest", "Location", "User"] as const;
const PAGE_SIZE = 25;

const ACTION_COLORS: Record<string, string> = {
  created:   "text-green-700 bg-green-50",
  updated:   "text-blue-700 bg-blue-50",
  deleted:   "text-red-700 bg-red-50",
  published: "text-purple-700 bg-purple-50",
  assigned:  "text-indigo-700 bg-indigo-50",
  approved:  "text-teal-700 bg-teal-50",
  rejected:  "text-orange-700 bg-orange-50",
  cancelled: "text-slate-700 bg-slate-100",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminAuditPage() {
  const [locationId, setLocationId] = useState("");
  const [entityType, setEntityType] = useState("");
  const [startDate,  setStartDate]  = useState("");
  const [endDate,    setEndDate]    = useState("");
  const [page,       setPage]       = useState(1);

  const { data: locationList = [] } = useQuery({
    queryKey: ["locations"],
    queryFn:  () => locationsApi.list(),
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["audit", { locationId, entityType, startDate, endDate, page }],
    queryFn: () =>
      auditApi.list({
        locationId: locationId || undefined,
        entityType: entityType || undefined,
        startDate:  startDate  || undefined,
        endDate:    endDate    || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });

  const items   = data?.items ?? [];
  const total   = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function applyFilters() {
    setPage(1);
  }

  function resetFilters() {
    setLocationId("");
    setEntityType("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  const exportUrl = auditApi.exportCsvUrl({
    locationId: locationId || undefined,
    entityType: entityType || undefined,
    startDate:  startDate  || undefined,
    endDate:    endDate    || undefined,
  });

  const hasActiveFilters = !!(locationId || entityType || startDate || endDate);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Audit Log</h2>
          <p className="text-sm text-muted-foreground">
            {total > 0 ? `${total.toLocaleString()} entries` : "Activity log for all system events"}
          </p>
        </div>
        <a href={exportUrl} download>
          <Button variant="outline" size="sm">
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
          </Button>
        </a>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-4">
        <Filter className="h-4 w-4 text-muted-foreground self-center shrink-0" />

        {/* Location */}
        <div className="flex flex-col gap-1 min-w-[160px]">
          <span className="text-xs text-muted-foreground font-medium">Location</span>
          <Select value={locationId || "all"} onValueChange={(v) => setLocationId(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="All locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {locationList.map((loc) => (
                <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Entity type */}
        <div className="flex flex-col gap-1 min-w-[150px]">
          <span className="text-xs text-muted-foreground font-medium">Entity type</span>
          <Select value={entityType || "all"} onValueChange={(v) => setEntityType(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {ENTITY_TYPES.filter(Boolean).map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Start date */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground font-medium">From</span>
          <Input
            type="date"
            className="h-8 text-sm w-36"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        {/* End date */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground font-medium">To</span>
          <Input
            type="date"
            className="h-8 text-sm w-36"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <div className="flex gap-2 ml-auto">
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Clear
            </Button>
          )}
          <Button size="sm" onClick={applyFilters}>
            Apply
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {hasActiveFilters ? "No audit entries match your filters." : "No audit entries yet."}
          </CardContent>
        </Card>
      ) : (
        <div className={`rounded-lg border overflow-hidden transition-opacity ${isFetching ? "opacity-60" : ""}`}>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">When</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Who</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Entity</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Entity ID</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} &mdash; {total.toLocaleString()} entries
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={!hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const actionCls = ACTION_COLORS[entry.action] ?? "text-slate-700 bg-slate-100";
  const when = new Date(entry.performedAt);

  return (
    <tr className="hover:bg-muted/20 transition-colors">
      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
        <span className="block">{format(when, "MMM d, yyyy")}</span>
        <span className="text-xs">{format(when, "HH:mm:ss")}</span>
      </td>
      <td className="px-4 py-2.5 font-medium">{entry.performerName}</td>
      <td className="px-4 py-2.5 hidden sm:table-cell">
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">
          {entry.entityType}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${actionCls}`}>
          {entry.action}
        </span>
      </td>
      <td className="px-4 py-2.5 hidden lg:table-cell">
        <code className="text-xs text-muted-foreground">{entry.entityId}</code>
      </td>
    </tr>
  );
}
