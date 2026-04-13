/**
 * ShiftSync — Shared Domain Types
 *
 * These are plain TypeScript types used by both the Express API (apps/api)
 * and the Next.js frontend (apps/web). They represent the shape of data
 * crossing the HTTP boundary — not the Prisma DB models themselves.
 *
 * Enums are duplicated here (rather than re-exported from Prisma) so the
 * frontend does not take a dependency on @prisma/client.
 */

// =============================================================================
// Enums
// =============================================================================

export type Role = "ADMIN" | "MANAGER" | "STAFF";

export type ShiftStatus = "DRAFT" | "PUBLISHED" | "CANCELLED";

export type AssignmentStatus = "CONFIRMED" | "PENDING_SWAP" | "CANCELLED";

export type AvailabilityType = "RECURRING" | "EXCEPTION";

export type SwapType = "SWAP" | "DROP";

export type SwapStatus =
  | "PENDING_ACCEPTANCE"
  | "PENDING_MANAGER"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED";

export type NotificationType =
  | "SHIFT_ASSIGNED"
  | "SHIFT_CHANGED"
  | "SHIFT_PUBLISHED"
  | "SHIFT_CANCELLED"
  | "SWAP_REQUESTED"
  | "SWAP_ACCEPTED"
  | "SWAP_REJECTED"
  | "SWAP_APPROVED"
  | "SWAP_CANCELLED"
  | "DROP_AVAILABLE"
  | "DROP_CLAIMED"
  | "DROP_EXPIRED"
  | "OVERTIME_WARNING"
  | "AVAILABILITY_CHANGED"
  | "SCHEDULE_PUBLISHED"
  | "MANAGER_OVERRIDE_REQUIRED";

export type ConstraintCode =
  | "DOUBLE_BOOKED"
  | "INSUFFICIENT_REST"
  | "SKILL_MISMATCH"
  | "LOCATION_NOT_CERTIFIED"
  | "UNAVAILABLE"
  | "DAILY_HOURS_WARNING"
  | "DAILY_HOURS_HARD_BLOCK"
  | "WEEKLY_HOURS_WARNING"
  | "SIXTH_CONSECUTIVE_DAY"
  | "SEVENTH_CONSECUTIVE_DAY";

export type OvertimeWarningType =
  | "APPROACHING_40H"
  | "OVER_40H"
  | "DAILY_8H"
  | "DAILY_12H_HARD_BLOCK"
  | "SIXTH_CONSECUTIVE_DAY"
  | "SEVENTH_CONSECUTIVE_DAY_HARD_BLOCK";

// =============================================================================
// User & Auth
// =============================================================================

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
  desiredHoursPerWeek: number | null;
}

export interface UserDetail extends UserSummary {
  skills: SkillRef[];
  locationCertifications: LocationRef[];
  notificationPreference: NotificationPreference | null;
}

/**
 * Convenience alias — the full user shape returned by the API.
 * Components should import `User` for the general case.
 */
export type User = UserDetail;

export interface SkillRef {
  id: string;
  name: string;
}

export interface LocationRef {
  id: string;
  name: string;
  timezone: string;
}

export interface NotificationPreference {
  inApp: boolean;
  email: boolean;
}

// =============================================================================
// Locations
// =============================================================================

export interface Location {
  id: string;
  name: string;
  timezone: string;
  address: string;
  managerIds: string[];
}

// =============================================================================
// Skills
// =============================================================================

export interface Skill {
  id: string;
  name: string;
}

// =============================================================================
// Availability
// =============================================================================

export interface AvailabilityWindow {
  id: string;
  userId: string;
  type: AvailabilityType;
  /** 0 = Sunday … 6 = Saturday. Null for EXCEPTION type. */
  dayOfWeek: number | null;
  /** Local wall-clock time "HH:MM" (24h) */
  startTime: string;
  /** Local wall-clock time "HH:MM" (24h). "00:00" means midnight end-of-day. */
  endTime: string;
  /** ISO date string for EXCEPTION type. Null for RECURRING. */
  date: string | null;
  available: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

// =============================================================================
// Shifts
// =============================================================================

export interface Shift {
  id: string;
  locationId: string;
  location: LocationRef;
  skillId: string;
  skill: SkillRef;
  /** UTC ISO 8601 string */
  startTime: string;
  /** UTC ISO 8601 string. May be a later calendar day for overnight shifts. */
  endTime: string;
  headcount: number;
  status: ShiftStatus;
  publishedAt: string | null;
  isPremium: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  assignments: ShiftAssignment[];
  /** headcount − confirmed assignments */
  openSlots: number;
}

export interface ShiftAssignment {
  id: string;
  shiftId: string;
  userId: string;
  user: UserSummary;
  status: AssignmentStatus;
  assignedBy: string;
  assignedAt: string;
}

// =============================================================================
// Swap / Drop Requests
// =============================================================================

export interface SwapRequest {
  id: string;
  type: SwapType;
  assignmentId: string;
  initiatorId: string;
  initiator: UserSummary;
  receiverId: string | null;
  receiver: UserSummary | null;
  shiftId: string;
  shift: Shift;
  status: SwapStatus;
  managerNote: string | null;
  approvedBy: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Notifications
// =============================================================================

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  /** The notification body text. Aliased as `message` for API compatibility. */
  body: string;
  /** @deprecated Use `body` instead — kept for API response compatibility. */
  message?: string;
  data: Record<string, unknown> | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

// =============================================================================
// Audit
// =============================================================================

export interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  performedBy: string;
  performerName: string;
  performedAt: string;
  shiftId: string | null;
  locationId: string | null;
}

// =============================================================================
// Analytics
// =============================================================================

export interface StaffHoursSummary {
  userId: string;
  name: string;
  scheduledHours: number;
  desiredHoursPerWeek: number | null;
  /** Positive = over desired; negative = under */
  hoursDelta: number | null;
  premiumShiftCount: number;
  assignments: Array<{
    shiftId: string;
    startTime: string;
    endTime: string;
    locationName: string;
    isPremium: boolean;
    durationHours: number;
  }>;
}

export interface OvertimeProjection {
  userId: string;
  name: string;
  currentWeekHours: number;
  overtimeHours: number;
  desiredHoursPerWeek: number | null;
  warnings: OvertimeWarning[];
  overtimeAssignments: Array<{
    shiftId: string;
    startTime: string;
    endTime: string;
    durationHours: number;
    overtimeContribution: number;
  }>;
}

export interface OvertimeWarning {
  type: OvertimeWarningType;
  severity: "warning" | "hard_block";
  message: string;
  affectedDate?: string;
  affectedShiftId?: string;
}

export interface FairnessReport {
  periodStart: string;
  periodEnd: string;
  locationId: string;
  locationName: string;
  staff: FairnessEntry[];
  /** 0–100: higher = more equitable distribution of premium shifts */
  fairnessScore: number;
}

export interface FairnessEntry {
  userId: string;
  name: string;
  totalShifts: number;
  totalHours: number;
  premiumShifts: number;
  premiumHours: number;
  /** This person's premium shifts as % of all premium shifts at the location */
  premiumSharePercent: number;
  desiredHoursPerWeek: number | null;
}

// =============================================================================
// Constraint Checking
// =============================================================================

export interface ConstraintCheckResult {
  valid: boolean;
  violations: ConstraintViolation[];
  warnings: ConstraintWarning[];
  suggestions: StaffSuggestion[];
}

export interface ConstraintViolation {
  code: ConstraintCode;
  message: string;
  detail: string;
}

export interface ConstraintWarning {
  code: ConstraintCode;
  message: string;
  detail: string;
}

export interface StaffSuggestion {
  userId: string;
  name: string;
  /** Why this person is a good alternative */
  reason: string;
  /** Issues that would still exist if this person were assigned */
  caveats: string[];
}

// =============================================================================
// Real-time (Socket.io events)
// =============================================================================

export type SocketEventType =
  // Emitted by the API server (SCREAMING_SNAKE_CASE matches socket.service.ts)
  | "SHIFT_CREATED"
  | "SHIFT_UPDATED"
  | "SHIFT_PUBLISHED"
  | "SHIFT_CANCELLED"
  | "ASSIGNMENT_CREATED"
  | "ASSIGNMENT_REMOVED"
  | "SWAP_CREATED"
  | "SWAP_UPDATED"
  | "NOTIFICATION"
  | "CONFLICT_ASSIGNMENT"
  | "PICKUP_REQUESTED";

export interface SocketEvent<T = unknown> {
  type: SocketEventType;
  payload: T;
}

// =============================================================================
// API Response envelope
// =============================================================================

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  code?: string;
  details?: unknown;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
