import "@testing-library/jest-dom";
import { vi } from "vitest";

// ─── Next.js router mock ───────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter:   () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect:    vi.fn(),
}));

// ─── Socket.io-client mock ─────────────────────────────────────────────────
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on:         vi.fn(),
    off:        vi.fn(),
    emit:       vi.fn(),
    disconnect: vi.fn(),
    connected:  false,
  })),
}));

// ─── Suppress console.error noise from React in tests ─────────────────────
const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (
    typeof args[0] === "string" &&
    (args[0].includes("Warning:") || args[0].includes("ReactDOM.render"))
  ) return;
  originalError(...args);
};
