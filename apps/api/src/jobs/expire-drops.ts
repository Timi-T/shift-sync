/**
 * Drop request expiry job.
 *
 * Runs on a schedule (called from index.ts via setInterval) to expire any
 * DROP swap requests whose expiresAt timestamp has passed without being claimed.
 *
 * This avoids stale drop requests cluttering the UI and consuming the staff
 * member's pending-request quota.
 */

import { prisma } from "@/shared/lib/prisma.js";
import { emitToUser } from "@/shared/services/socket.service.js";

export async function expireDropRequests(): Promise<void> {
  const expired = await prisma.swapRequest.findMany({
    where: {
      type: "DROP",
      status: "PENDING_ACCEPTANCE",
      expiresAt: { lte: new Date() },
    },
    include: {
      initiator: { select: { id: true, name: true } },
      shift: { include: { location: { select: { name: true } } } },
    },
  });

  if (expired.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.swapRequest.updateMany({
      where: { id: { in: expired.map((r) => r.id) } },
      data: { status: "EXPIRED" },
    });

    // Restore assignments to CONFIRMED since no one claimed them
    await tx.shiftAssignment.updateMany({
      where: { id: { in: expired.map((r) => r.assignmentId) } },
      data: { status: "CONFIRMED" },
    });
  });

  for (const req of expired) {
    await prisma.notification.create({
      data: {
        userId: req.initiatorId,
        type: "DROP_EXPIRED",
        title: "Drop request expired",
        message: `Your drop request for the ${req.shift.location.name} shift expired with no one picking it up. You are still assigned to the shift.`,
        data: { swapRequestId: req.id, shiftId: req.shiftId },
      },
    });

    emitToUser(req.initiatorId, "SWAP_UPDATED", {
      swapRequestId: req.id,
      status: "EXPIRED",
    });
  }

  console.log(`[Jobs] Expired ${expired.length} drop request(s)`);
}
