/**
 * Socket.io event broadcaster.
 *
 * This module is the single point of contact for emitting real-time events.
 * Controllers call broadcast() after every state change; the socket server
 * handles routing to the correct connected clients.
 *
 * Room strategy:
 *   - Each authenticated user joins a personal room: `user:<userId>`
 *   - Each location has a room:                       `location:<locationId>`
 *   - Managers join rooms for all their managed locations on connect.
 *   - Staff join rooms for all their certified locations on connect.
 *
 * This way, broadcasting to a location room notifies all relevant parties
 * without building a custom recipient list for every event type.
 *
 * The Server instance is set once at startup (in src/socket.ts) and accessed
 * via the singleton getter below.
 */

import type { Server as SocketServer } from "socket.io";
import type { SocketEvent, SocketEventType } from "@shift-sync/shared";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _io: SocketServer | null = null;

export function setSocketServer(io: SocketServer): void {
  _io = io;
}

function getIo(): SocketServer | null {
  return _io;
}

// ---------------------------------------------------------------------------
// Public broadcast helpers
// ---------------------------------------------------------------------------

/**
 * Broadcast a typed event to all clients in a location room.
 * Managers and staff certified at this location will receive the event.
 */
export function broadcastToLocation<T>(
  locationId: string,
  type: SocketEventType,
  payload: T,
): void {
  const io = getIo();
  if (!io) return;

  const event: SocketEvent<T> = { type, payload };
  io.to(`location:${locationId}`).emit(type, event);
}

/**
 * Emit a typed event to a specific user's personal room.
 * Used for notifications, swap request updates, etc.
 */
export function emitToUser<T>(
  userId: string,
  type: SocketEventType,
  payload: T,
): void {
  const io = getIo();
  if (!io) return;

  const event: SocketEvent<T> = { type, payload };
  io.to(`user:${userId}`).emit(type, event);
}

/**
 * Broadcast to multiple specific users.
 * Used when a swap involves exactly two people + their manager.
 */
export function emitToUsers<T>(
  userIds: string[],
  type: SocketEventType,
  payload: T,
): void {
  for (const userId of userIds) {
    emitToUser(userId, type, payload);
  }
}

/**
 * Broadcast a conflict notification to everyone currently viewing a location's
 * schedule except the user who caused the conflict.
 */
export function broadcastConflict(
  locationId: string,
  payload: {
    conflictingUserId: string;
    conflictingUserName: string;
    shiftId: string;
  },
  excludeUserId?: string,
): void {
  const io = getIo();
  if (!io) return;

  const event: SocketEvent<typeof payload> = {
    type: "CONFLICT_ASSIGNMENT",
    payload,
  };

  const room = io.to(`location:${locationId}`);
  if (excludeUserId) {
    room.except(`user:${excludeUserId}`).emit("CONFLICT_ASSIGNMENT", event);
  } else {
    room.emit("CONFLICT_ASSIGNMENT", event);
  }
}
