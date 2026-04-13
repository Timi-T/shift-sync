/**
 * ShiftSync — Shared Zod Validation Schemas
 *
 * These schemas validate incoming request bodies on the Express API and
 * can be reused on the Next.js frontend for form validation (same rules,
 * zero duplication).
 *
 * Convention:
 *   - Schemas are named after the operation they validate, not the entity.
 *   - .strict() is applied where extra fields should be rejected.
 *   - Inferred types are exported alongside each schema.
 */

import { z } from "zod";

// =============================================================================
// Auth
// =============================================================================

export const loginSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    password: z.string().min(1, "Password is required"),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

// =============================================================================
// Users
// =============================================================================

export const createUserSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters").max(100),
    email: z.string().email("Please enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        "Password must contain uppercase, lowercase, and a number",
      ),
    role: z.enum(["ADMIN", "MANAGER", "STAFF"]),
    desiredHoursPerWeek: z
      .number()
      .int()
      .min(0)
      .max(40)
      .nullable()
      .optional(),
    skillIds: z.array(z.string().min(1)).optional(),
    locationIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    desiredHoursPerWeek: z.number().int().min(0).max(40).nullable().optional(),
    skillIds: z.array(z.string().min(1)).optional(),
    locationIds: z.array(z.string().min(1)).optional(),
    notificationPreference: z
      .object({
        inApp: z.boolean(),
        email: z.boolean(),
      })
      .optional(),
  })
  .strict();

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// =============================================================================
// Locations
// =============================================================================

export const createLocationSchema = z
  .object({
    name: z.string().min(2).max(100),
    timezone: z
      .string()
      .min(1, "Timezone is required")
      .refine(
        (tz) => {
          try {
            Intl.DateTimeFormat(undefined, { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        },
        { message: "Invalid IANA timezone identifier" },
      ),
    address: z.string().min(5).max(200),
    managerIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = createLocationSchema.partial();
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

// =============================================================================
// Shifts
// =============================================================================

const TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export const createShiftSchema = z
  .object({
    locationId: z.string().nonempty("Invalid location ID"),
    skillId: z.string().nonempty("Invalid skill ID"),
    startTime: z
      .string()
      .regex(TIME_REGEX, "startTime must be a UTC ISO 8601 string"),
    endTime: z
      .string()
      .regex(TIME_REGEX, "endTime must be a UTC ISO 8601 string"),
    headcount: z
      .number()
      .int()
      .min(1, "At least 1 staff member is required")
      .max(20),
  })
  .strict()
  .refine((data) => new Date(data.endTime) > new Date(data.startTime), {
    message: "endTime must be after startTime",
    path: ["endTime"],
  })
  .refine(
    (data) => {
      const durationMs =
        new Date(data.endTime).getTime() - new Date(data.startTime).getTime();
      const durationHours = durationMs / (1000 * 60 * 60);
      return durationHours <= 24;
    },
    { message: "A single shift cannot exceed 24 hours", path: ["endTime"] },
  );

export type CreateShiftInput = z.infer<typeof createShiftSchema>;

export const updateShiftSchema = z
  .object({
    startTime: z
      .string()
      .regex(TIME_REGEX, "startTime must be a UTC ISO 8601 string")
      .optional(),
    endTime: z
      .string()
      .regex(TIME_REGEX, "endTime must be a UTC ISO 8601 string")
      .optional(),
    headcount: z.number().int().min(1).max(20).optional(),
    skillId: z.string().min(1).optional(),
  })
  .strict();

export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;

// =============================================================================
// Assignments
// =============================================================================

export const createAssignmentSchema = z
  .object({
    userId: z.string().min(1, "Invalid user ID"),
    /** Allow manager to acknowledge and override a 7th consecutive day warning. */
    overrideReason: z.string().min(10).max(500).optional(),
  })
  .strict();

export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

// =============================================================================
// Swap / Drop Requests
// =============================================================================

export const createSwapRequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SWAP"),
      assignmentId: z.string().min(1, "Invalid assignment ID"),
      receiverId: z.string().min(1, "Invalid receiver user ID"),
    })
    .strict(),
  z
    .object({
      type: z.literal("DROP"),
      assignmentId: z.string().min(1, "Invalid assignment ID"),
    })
    .strict(),
]);

export type CreateSwapRequestInput = z.infer<typeof createSwapRequestSchema>;

export const approveSwapSchema = z
  .object({
    managerNote: z.string().max(500).optional(),
  })
  .strict();

export type ApproveSwapInput = z.infer<typeof approveSwapSchema>;

export const rejectSwapSchema = z
  .object({
    managerNote: z.string().min(5, "Please provide a reason for rejecting").max(500),
  })
  .strict();

export type RejectSwapInput = z.infer<typeof rejectSwapSchema>;

// =============================================================================
// Availability
// =============================================================================

const TIME_OF_DAY_REGEX = /^([01]\d|2[0-4]):[0-5]\d$/;

export const createAvailabilitySchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("RECURRING"),
        dayOfWeek: z
          .number()
          .int()
          .min(0, "0 = Sunday")
          .max(6, "6 = Saturday"),
        startTime: z
          .string()
          .regex(TIME_OF_DAY_REGEX, "Use HH:MM 24-hour format"),
        endTime: z
          .string()
          .regex(TIME_OF_DAY_REGEX, "Use HH:MM 24-hour format"),
        effectiveFrom: z.string().datetime().nullable().optional(),
        effectiveTo: z.string().datetime().nullable().optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("EXCEPTION"),
        date: z.string().date("Use YYYY-MM-DD format"),
        available: z.boolean(),
        startTime: z
          .string()
          .regex(TIME_OF_DAY_REGEX, "Use HH:MM 24-hour format"),
        endTime: z
          .string()
          .regex(TIME_OF_DAY_REGEX, "Use HH:MM 24-hour format"),
      })
      .strict(),
  ]);

export type CreateAvailabilityInput = z.infer<typeof createAvailabilitySchema>;

export const updateAvailabilitySchema = z
  .object({
    startTime: z
      .string()
      .regex(TIME_OF_DAY_REGEX, "Use HH:MM 24-hour format")
      .optional(),
    endTime: z
      .string()
      .regex(TIME_OF_DAY_REGEX, "Use HH:MM 24-hour format")
      .optional(),
    available: z.boolean().optional(),
  })
  .strict();

export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;

// =============================================================================
// Publish / Unpublish
// =============================================================================

export const publishWeekSchema = z
  .object({
    /** ISO date string for the Monday of the week to publish */
    weekStart: z.string().date("Use YYYY-MM-DD format"),
    locationId: z.string().min(1),
  })
  .strict();

export type PublishWeekInput = z.infer<typeof publishWeekSchema>;

// =============================================================================
// Analytics query params
// =============================================================================

export const analyticsQuerySchema = z.object({
  locationId: z.string().min(1).optional(),
  startDate: z.string().date("Use YYYY-MM-DD").optional(),
  endDate: z.string().date("Use YYYY-MM-DD").optional(),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
