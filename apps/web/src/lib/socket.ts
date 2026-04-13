/**
 * Socket.io client singleton.
 *
 * One socket is shared across the entire application lifecycle.
 * The socket is NOT created until `connectSocket(token)` is called
 * (i.e. after the user logs in), and torn down on `disconnectSocket()`.
 */

import { io, type Socket } from "socket.io-client";
import type { SocketEventType } from "@shift-sync/shared";

type EventHandler = (data: unknown) => void;

let socket: Socket | null = null;

export function connectSocket(token: string): Socket {
  if (socket?.connected) return socket;

  socket = io(process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000", {
    auth: { token },
    transports: ["websocket"],
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  socket.on("connect", () => {
    console.log("[socket] connected:", socket!.id);
  });

  socket.on("disconnect", (reason) => {
    console.log("[socket] disconnected:", reason);
  });

  socket.on("connect_error", (err) => {
    console.warn("[socket] connection error:", err.message);
  });

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}

/**
 * Subscribe to a typed socket event. Returns an unsubscribe function.
 *
 * @example
 *   const off = onSocketEvent("SHIFT_UPDATED", (data) => { ... });
 *   // later:
 *   off();
 */
export function onSocketEvent(event: SocketEventType, handler: EventHandler): () => void {
  if (!socket) return () => {};
  socket.on(event, handler);
  return () => socket?.off(event, handler);
}

export function emitSocketEvent(event: string, data?: unknown): void {
  socket?.emit(event, data);
}
