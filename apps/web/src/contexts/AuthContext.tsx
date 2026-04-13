"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/api";
import { connectSocket, disconnectSocket } from "@/lib/socket";
import type { User } from "@shift-sync/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch /api/auth/me — useful after profile updates. */
  refresh: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setLoading] = useState(true);

  // Rehydrate session on mount
  useEffect(() => {
    const token = localStorage.getItem("shift_sync_token");
    if (!token) {
      setLoading(false);
      return;
    }
    auth.me()
      .then((me) => {
        setUser(me);
        connectSocket(token);
      })
      .catch(() => {
        localStorage.removeItem("shift_sync_token");
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { user: me, token } = await auth.login(email, password);
    localStorage.setItem("shift_sync_token", token);
    setUser(me);
    connectSocket(token);
    // Role-based redirect
    if (me.role === "ADMIN") router.push("/admin");
    else if (me.role === "MANAGER") router.push("/manager");
    else router.push("/staff");
  };

  const logout = async () => {
    await auth.logout().catch(() => { }); // best-effort
    localStorage.removeItem("shift_sync_token");
    disconnectSocket();
    setUser(null);
    router.push("/login");
  };

  const refresh = async () => {
    const me = await auth.me();
    setUser(me);
  };

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isAuthenticated: !!user, login, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
