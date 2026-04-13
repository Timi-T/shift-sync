"use client";

/**
 * SocketContext — provides typed, React-friendly access to real-time events.
 *
 * Usage:
 *   const { on, off } = useSocket();
 *   useEffect(() => {
 *     const unsub = on("SHIFT_UPDATED", handler);
 *     return unsub;
 *   }, [on]);
 */

import {
  createContext,
  useContext,
  useCallback,
  type ReactNode,
} from "react";
import { onSocketEvent, emitSocketEvent } from "@/lib/socket";
import type { SocketEventType } from "@shift-sync/shared";

type Handler = (data: unknown) => void;

interface SocketContextValue {
  on:   (event: SocketEventType, handler: Handler) => () => void;
  off:  (event: SocketEventType, handler: Handler) => void;
  emit: (event: string, data?: unknown) => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const on = useCallback(
    (event: SocketEventType, handler: Handler) => onSocketEvent(event, handler),
    [],
  );

  const off = useCallback((_event: SocketEventType, _handler: Handler) => {
    // onSocketEvent already returns an unsubscribe fn; off is provided for
    // symmetry but callers should prefer the returned unsubscribe fn.
  }, []);

  const emit = useCallback((event: string, data?: unknown) => {
    emitSocketEvent(event, data);
  }, []);

  return (
    <SocketContext.Provider value={{ on, off, emit }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used within <SocketProvider>");
  return ctx;
}
