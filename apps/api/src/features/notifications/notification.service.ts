/**
 * Notification Service.
 *
 * Creates persisted in-app notifications and optionally sends emails (simulated).
 * After creating a notification, it emits a Socket.io event so the recipient's
 * notification bell updates in real-time without a page refresh.
 *
 * All notification creation goes through this service — never direct Prisma
 * calls — so that the real-time emit is never accidentally skipped.
 */

import type { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@/shared/lib/prisma.js";
import { emitToUser } from "@/shared/services/socket.service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateNotificationOptions {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist a notification for one user and push it to them via Socket.io.
 */
export async function createNotification(
  opts: CreateNotificationOptions,
): Promise<void> {
  const notification = await prisma.notification.create({
    data: {
      userId: opts.userId,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      data: opts.data as Prisma.InputJsonValue,
    },
  });

  // Push to the user's personal socket room
  emitToUser(opts.userId, "NOTIFICATION", {
    id:        notification.id,
    type:      notification.type,
    title:     notification.title,
    body:      notification.message,  // Prisma field is `message`; shared type & frontend call it `body`
    data:      opts.data ?? null,
    read:      false,
    createdAt: notification.createdAt.toISOString(),
  });

  // Simulate email if the user has opted in
  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId: opts.userId },
  });

  if (prefs?.email && process.env.EMAIL_ENABLED === "true") {
    await sendSimulatedEmail(opts);
  }
}

/**
 * Create the same notification for multiple users at once.
 */
export async function createNotifications(
  notifications: CreateNotificationOptions[],
): Promise<void> {
  await Promise.all(notifications.map(createNotification));
}

// ---------------------------------------------------------------------------
// Domain-specific notification factories
// ---------------------------------------------------------------------------

export async function notifyShiftPublished(
  userIds: string[],
  locationName: string,
  weekOf: string,
): Promise<void> {
  await createNotifications(
    userIds.map((userId) => ({
      userId,
      type: "SCHEDULE_PUBLISHED" as NotificationType,
      title: "Your schedule is live",
      message: `The schedule for ${locationName} (week of ${weekOf}) has been published. Check your upcoming shifts.`,
    })),
  );
}

export async function notifyShiftAssigned(
  userId: string,
  locationName: string,
  shiftId: string,
  shiftStart: string,
): Promise<void> {
  await createNotification({
    userId,
    type: "SHIFT_ASSIGNED",
    title: "New shift assigned",
    message: `You have been assigned to a shift at ${locationName} on ${shiftStart}.`,
    data: { shiftId },
  });
}

export async function notifyShiftChanged(
  userId: string,
  locationName: string,
  shiftId: string,
  changeDescription: string,
): Promise<void> {
  await createNotification({
    userId,
    type: "SHIFT_CHANGED",
    title: "Your shift has been updated",
    message: `A shift at ${locationName} was changed: ${changeDescription}.`,
    data: { shiftId },
  });
}

export async function notifySwapRequested(
  receiverId: string,
  initiatorName: string,
  shiftId: string,
  swapRequestId: string,
): Promise<void> {
  await createNotification({
    userId: receiverId,
    type: "SWAP_REQUESTED",
    title: "Swap request from " + initiatorName,
    message: `${initiatorName} wants to swap a shift with you. Review the request and accept or decline.`,
    data: { swapRequestId, shiftId },
  });
}

export async function notifyDropAvailable(
  eligibleUserIds: string[],
  shiftId: string,
  locationName: string,
  shiftStart: string,
): Promise<void> {
  await createNotifications(
    eligibleUserIds.map((userId) => ({
      userId,
      type: "DROP_AVAILABLE" as NotificationType,
      title: "Shift available to pick up",
      message: `A ${locationName} shift on ${shiftStart} is now available. Claim it if you're interested.`,
      data: { shiftId },
    })),
  );
}

export async function notifySwapOutcome(
  initiatorId: string,
  receiverId: string | null,
  outcome: "APPROVED" | "REJECTED" | "CANCELLED",
  shiftId: string,
  swapRequestId: string,
  managerNote?: string | null,
): Promise<void> {
  const notifType: NotificationType =
    outcome === "APPROVED"
      ? "SWAP_APPROVED"
      : outcome === "REJECTED"
        ? "SWAP_REJECTED"
        : "SWAP_CANCELLED";

  const title =
    outcome === "APPROVED"
      ? "Swap approved"
      : outcome === "REJECTED"
        ? "Swap rejected"
        : "Swap cancelled";

  const baseMessage =
    outcome === "APPROVED"
      ? "Your shift swap has been approved by the manager."
      : outcome === "REJECTED"
        ? `Your shift swap was rejected${managerNote ? `: ${managerNote}` : "."}`
        : "The shift swap was cancelled.";

  const recipients = [initiatorId, ...(receiverId ? [receiverId] : [])];

  await createNotifications(
    recipients.map((userId) => ({
      userId,
      type: notifType,
      title,
      message: baseMessage,
      data: { swapRequestId, shiftId },
    })),
  );
}

export async function notifyManagerSwapPending(
  managerIds: string[],
  initiatorName: string,
  receiverName: string | null,
  shiftId: string,
  swapRequestId: string,
): Promise<void> {
  await createNotifications(
    managerIds.map((userId) => ({
      userId,
      type: "SWAP_REQUESTED" as NotificationType,
      title: "Swap request needs your approval",
      message: receiverName
        ? `${initiatorName} and ${receiverName} want to swap a shift. Your approval is required.`
        : `${initiatorName} submitted a drop request. Review and approve.`,
      data: { swapRequestId, shiftId },
    })),
  );
}

export async function notifyOvertimeWarning(
  managerIds: string[],
  staffName: string,
  projectedHours: number,
  userId: string,
): Promise<void> {
  await createNotifications(
    managerIds.map((managerId) => ({
      userId: managerId,
      type: "OVERTIME_WARNING" as NotificationType,
      title: `Overtime warning: ${staffName}`,
      message: `${staffName} is projected at ${projectedHours.toFixed(1)} hours this week. Review their schedule before adding more shifts.`,
      data: { userId, projectedHours },
    })),
  );
}

// ---------------------------------------------------------------------------
// Email simulation
// ---------------------------------------------------------------------------

async function sendSimulatedEmail(opts: CreateNotificationOptions): Promise<void> {
  // In production this would use nodemailer with real SMTP credentials.
  // For the assessment, we log the email to the console as a simulation.
  console.log(`[EMAIL SIMULATED] → ${opts.userId}`);
  console.log(`  Subject: ${opts.title}`);
  console.log(`  Body:    ${opts.message}`);
}
