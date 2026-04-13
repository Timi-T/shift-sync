/**
 * Typed API client — thin wrapper around axios.
 *
 * Every function returns strongly-typed data extracted from ApiResponse<T>.
 * Errors are re-thrown as AxiosError so TanStack Query's error boundaries
 * and mutation onError callbacks receive the full response body.
 */

import axios, { type AxiosError, type AxiosResponse } from "axios";
import type {
  ApiResponse,
  PaginatedResult,
  Shift,
  ShiftAssignment,
  SwapRequest,
  User,
  Location,
  AvailabilityWindow,
  Notification,
  FairnessReport,
  OvertimeProjection,
  ConstraintCheckResult,
  AuditLogEntry,
} from "@shift-sync/shared";

// ─── Axios instance ──────────────────────────────────────────────────────────

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  withCredentials: true, // send httpOnly cookie on every request
  headers: { "Content-Type": "application/json" },
});

// Attach Bearer token from localStorage (set on login response)
apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("shift_sync_token");
    if (token) config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// Redirect to /login on 401 (session expired) — but NOT on the login endpoint itself.
apiClient.interceptors.response.use(
  (r) => r,
  (err: AxiosError<ApiResponse<never>>) => {
    const isLoginEndpoint = err.config?.url?.includes("/auth/login");
    if (err.response?.status === 401 && !isLoginEndpoint && typeof window !== "undefined") {
      localStorage.removeItem("shift_sync_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  },
);

/** Extract `data` from `{ ok: true, data: T }`. */
function unwrap<T>(res: AxiosResponse<ApiResponse<T>>): T {
  if (!res.data.ok) throw new Error("API returned ok:false without an HTTP error");
  return res.data.data as T;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export const auth = {
  login: async (email: string, password: string): Promise<{ user: User; token: string }> => {
    const res = await apiClient.post<ApiResponse<{ user: User; token: string }>>("/api/auth/login", { email, password });
    return unwrap(res);
  },
  logout: async (): Promise<void> => {
    await apiClient.post("/api/auth/logout");
  },
  me: async (): Promise<User> => {
    const res = await apiClient.get<ApiResponse<User>>("/api/auth/me");
    return unwrap(res);
  },
};

// ─── Shifts ──────────────────────────────────────────────────────────────────

export interface ListShiftsParams {
  locationId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}

export const shifts = {
  list: async (params?: ListShiftsParams): Promise<Shift[]> => {
    const res = await apiClient.get<ApiResponse<Shift[]>>("/api/shifts", { params });
    return unwrap(res);
  },
  getById: async (id: string): Promise<Shift> => {
    const res = await apiClient.get<ApiResponse<Shift>>(`/api/shifts/${id}`);
    return unwrap(res);
  },
  create: async (data: {
    locationId: string;
    skillId: string;
    startTime: string;
    endTime: string;
    headcount: number;
    notes?: string;
  }): Promise<Shift> => {
    const res = await apiClient.post<ApiResponse<Shift>>("/api/shifts", data);
    return unwrap(res);
  },
  update: async (id: string, data: Partial<{ headcount: number; notes: string; startTime: string; endTime: string }>): Promise<Shift> => {
    const res = await apiClient.put<ApiResponse<Shift>>(`/api/shifts/${id}`, data);
    return unwrap(res);
  },
  publish: async (id: string): Promise<Shift> => {
    const res = await apiClient.post<ApiResponse<Shift>>(`/api/shifts/${id}/publish`);
    return unwrap(res);
  },
  publishWeek: async (locationId: string, weekStart: string): Promise<{ published: number }> => {
    const res = await apiClient.post<ApiResponse<{ published: number }>>("/api/shifts/publish-week", { locationId, weekStart });
    return unwrap(res);
  },
  cancel: async (id: string, reason: string): Promise<Shift> => {
    const res = await apiClient.post<ApiResponse<Shift>>(`/api/shifts/${id}/cancel`, { reason });
    return unwrap(res);
  },
  onDuty: async (): Promise<Shift[]> => {
    const res = await apiClient.get<ApiResponse<Shift[]>>("/api/shifts/on-duty");
    return unwrap(res);
  },
  auditLog: async (id: string): Promise<AuditLogEntry[]> => {
    const res = await apiClient.get<ApiResponse<AuditLogEntry[]>>(`/api/shifts/${id}/audit`);
    return unwrap(res);
  },
};

// ─── Assignments ─────────────────────────────────────────────────────────────

export const assignments = {
  create: async (shiftId: string, userId: string, overrideReason?: string): Promise<{
    assignment: ShiftAssignment;
    warnings: ConstraintCheckResult["warnings"];
  }> => {
    const res = await apiClient.post<ApiResponse<{ assignment: ShiftAssignment; warnings: ConstraintCheckResult["warnings"] }>>(
      `/api/shifts/${shiftId}/assignments`,
      { userId, overrideReason },
    );
    return unwrap(res);
  },
  preview: async (shiftId: string, userId: string): Promise<ConstraintCheckResult & { overtimeImpact: OvertimeProjection }> => {
    const res = await apiClient.post<ApiResponse<ConstraintCheckResult & { overtimeImpact: OvertimeProjection }>>(
      `/api/shifts/${shiftId}/assignments/preview`,
      { userId },
    );
    return unwrap(res);
  },
  remove: async (shiftId: string, userId: string): Promise<void> => {
    await apiClient.delete(`/api/shifts/${shiftId}/assignments/${userId}`);
  },
};

// ─── Swap / Drop Requests ─────────────────────────────────────────────────────

export const swapRequests = {
  list: async (params?: { status?: string; initiatedByMe?: boolean }): Promise<SwapRequest[]> => {
    const res = await apiClient.get<ApiResponse<SwapRequest[]>>("/api/swap-requests", { params });
    return unwrap(res);
  },
  create: async (data: {
    type: "SWAP" | "DROP";
    assignmentId: string;
    receiverId?: string;
  }): Promise<SwapRequest> => {
    const res = await apiClient.post<ApiResponse<SwapRequest>>("/api/swap-requests", data);
    return unwrap(res);
  },
  accept: async (id: string): Promise<SwapRequest> => {
    const res = await apiClient.post<ApiResponse<SwapRequest>>(`/api/swap-requests/${id}/accept`);
    return unwrap(res);
  },
  claim: async (id: string): Promise<SwapRequest> => {
    const res = await apiClient.post<ApiResponse<SwapRequest>>(`/api/swap-requests/${id}/claim`);
    return unwrap(res);
  },
  cancel: async (id: string): Promise<{ message: string }> => {
    const res = await apiClient.post<ApiResponse<{ message: string }>>(`/api/swap-requests/${id}/cancel`);
    return unwrap(res);
  },
  approve: async (id: string, managerNote?: string): Promise<{ message: string }> => {
    const res = await apiClient.post<ApiResponse<{ message: string }>>(`/api/swap-requests/${id}/approve`, { managerNote });
    return unwrap(res);
  },
  reject: async (id: string, managerNote: string): Promise<{ message: string }> => {
    const res = await apiClient.post<ApiResponse<{ message: string }>>(`/api/swap-requests/${id}/reject`, { managerNote });
    return unwrap(res);
  },
};

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = {
  list: async (params?: { locationId?: string; role?: string }): Promise<User[]> => {
    const res = await apiClient.get<ApiResponse<User[]>>("/api/users", { params });
    return unwrap(res);
  },
  getById: async (id: string): Promise<User> => {
    const res = await apiClient.get<ApiResponse<User>>(`/api/users/${id}`);
    return unwrap(res);
  },
  create: async (data: {
    name: string;
    email: string;
    password: string;
    role: string;
    desiredHoursPerWeek?: number;
    skillIds?: string[];
    locationIds?: string[];
  }): Promise<User> => {
    const res = await apiClient.post<ApiResponse<User>>("/api/users", data);
    return unwrap(res);
  },
  update: async (id: string, data: {
    name?: string;
    desiredHoursPerWeek?: number | null;
    skillIds?: string[];
    locationIds?: string[];
    notificationPreference?: { inApp: boolean; email: boolean };
  }): Promise<{ message: string }> => {
    const res = await apiClient.put<ApiResponse<{ message: string }>>(`/api/users/${id}`, data);
    return unwrap(res);
  },
  patchRole: async (id: string, role: string): Promise<{ message: string }> => {
    const res = await apiClient.patch<ApiResponse<{ message: string }>>(`/api/users/${id}/role`, { role });
    return unwrap(res);
  },
};

// ─── Availability ─────────────────────────────────────────────────────────────

export const availability = {
  list: async (): Promise<AvailabilityWindow[]> => {
    const res = await apiClient.get<ApiResponse<AvailabilityWindow[]>>(`/api/availability`);
    return unwrap(res);
  },
  upsert: async (data: {
    type: "RECURRING" | "EXCEPTION";
    dayOfWeek?: number;
    date?: string;
    startTime: string;
    endTime: string;
    available: boolean;
  }): Promise<AvailabilityWindow> => {
    const res = await apiClient.post<ApiResponse<AvailabilityWindow>>(`/api/availability`, data);
    return unwrap(res);
  },
  remove: async (windowId: string): Promise<void> => {
    await apiClient.delete(`/api/availability/${windowId}`);
  },
};

// ─── Notifications ────────────────────────────────────────────────────────────

export const notifications = {
  list: async (): Promise<Notification[]> => {
    const res = await apiClient.get<ApiResponse<Notification[]>>("/api/notifications");
    return unwrap(res);
  },
  markRead: async (id: string): Promise<void> => {
    await apiClient.post(`/api/notifications/${id}/read`);
  },
  markAllRead: async (): Promise<void> => {
    await apiClient.post("/api/notifications/read-all");
  },
};

// ─── Analytics ───────────────────────────────────────────────────────────────

export const analytics = {
  fairness: async (locationId: string, startDate: string, endDate: string): Promise<FairnessReport> => {
    // locationId is a query param, not a path segment
    const res = await apiClient.get<ApiResponse<FairnessReport>>("/api/analytics/fairness", {
      params: { locationId, startDate, endDate },
    });
    return unwrap(res);
  },
  overtime: async (params?: { weekStart?: string; locationId?: string }): Promise<OvertimeProjection[]> => {
    const res = await apiClient.get<ApiResponse<OvertimeProjection[]>>("/api/analytics/overtime", { params });
    return unwrap(res);
  },
  hours: async (params?: { weekStart?: string; locationId?: string }): Promise<unknown[]> => {
    const res = await apiClient.get<ApiResponse<unknown[]>>("/api/analytics/hours", { params });
    return unwrap(res);
  },
};

// ─── Locations ────────────────────────────────────────────────────────────────

export const locations = {
  list: async (): Promise<Location[]> => {
    const res = await apiClient.get<ApiResponse<Location[]>>("/api/locations");
    return unwrap(res);
  },
  getById: async (id: string): Promise<Location> => {
    const res = await apiClient.get<ApiResponse<Location>>(`/api/locations/${id}`);
    return unwrap(res);
  },
  create: async (data: {
    name: string;
    timezone: string;
    address: string;
    managerIds?: string[];
  }): Promise<Location> => {
    const res = await apiClient.post<ApiResponse<Location>>("/api/locations", data);
    return unwrap(res);
  },
  update: async (id: string, data: {
    name?: string;
    timezone?: string;
    address?: string;
    managerIds?: string[];
  }): Promise<Location> => {
    const res = await apiClient.put<ApiResponse<Location>>(`/api/locations/${id}`, data);
    return unwrap(res);
  },
  skills: async (): Promise<Array<{ id: string; name: string }>> => {
    const res = await apiClient.get<ApiResponse<Array<{ id: string; name: string }>>>("/api/locations/skills");
    return unwrap(res);
  },
};

// ─── Pickup Requests ──────────────────────────────────────────────────────────

export interface ShiftPickupRequest {
  id: string;
  shiftId: string;
  userId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  managerNote?: string | null;
  resolvedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  shift?: {
    id: string;
    startTime: string;
    endTime: string;
    location?: { id: string; name: string; timezone: string };
    skill?: { id: string; name: string };
  };
  user?: { id: string; name: string; email: string };
}

export const pickupRequests = {
  /** Staff requests to pick up an open published shift. */
  request: async (shiftId: string): Promise<ShiftPickupRequest> => {
    const res = await apiClient.post<ApiResponse<ShiftPickupRequest>>(
      `/api/shifts/${shiftId}/pickup`,
    );
    return unwrap(res);
  },

  /** Manager: list all pending pickup requests across managed locations. */
  listAll: async (): Promise<ShiftPickupRequest[]> => {
    const res = await apiClient.get<ApiResponse<ShiftPickupRequest[]>>(
      "/api/shifts/pickup-requests",
    );
    return unwrap(res);
  },

  /** Manager: list pickup requests for a specific shift. */
  listForShift: async (shiftId: string): Promise<ShiftPickupRequest[]> => {
    const res = await apiClient.get<ApiResponse<ShiftPickupRequest[]>>(
      `/api/shifts/${shiftId}/pickup`,
    );
    return unwrap(res);
  },

  /** Manager approves a pickup request. */
  approve: async (shiftId: string, reqId: string, managerNote?: string): Promise<{ message: string }> => {
    const res = await apiClient.post<ApiResponse<{ message: string }>>(
      `/api/shifts/${shiftId}/pickup/${reqId}/approve`,
      { managerNote },
    );
    return unwrap(res);
  },

  /** Manager rejects a pickup request. */
  reject: async (shiftId: string, reqId: string, managerNote?: string): Promise<{ message: string }> => {
    const res = await apiClient.post<ApiResponse<{ message: string }>>(
      `/api/shifts/${shiftId}/pickup/${reqId}/reject`,
      { managerNote },
    );
    return unwrap(res);
  },
};

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditListParams {
  locationId?: string;
  startDate?: string;
  endDate?: string;
  entityType?: string;
  page?: number;
  pageSize?: number;
}

export const audit = {
  list: async (params?: AuditListParams): Promise<PaginatedResult<AuditLogEntry>> => {
    const res = await apiClient.get<ApiResponse<PaginatedResult<AuditLogEntry>>>("/api/audit", { params });
    return unwrap(res);
  },
  exportCsvUrl: (params?: Omit<AuditListParams, "page" | "pageSize">): string => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const qs = new URLSearchParams();
    if (params?.locationId) qs.set("locationId", params.locationId);
    if (params?.startDate)  qs.set("startDate",  params.startDate);
    if (params?.endDate)    qs.set("endDate",     params.endDate);
    if (params?.entityType) qs.set("entityType",  params.entityType);
    return `${base}/api/audit/export?${qs.toString()}`;
  },
};
