"use client";

import * as React from "react";
import { createAuthLayer, type AuthRepository, type AuthSession, type MockAuthLayer } from "@/data";

type AuthStatus = "loading" | "signedIn" | "signedOut";

interface AuthContextValue {
  auth: AuthRepository | null;
  /** Dev tools exist only on the mock auth layer. */
  dev: MockAuthLayer["dev"] | null;
  status: AuthStatus;
  session: AuthSession | null;
  /** Read the session again (after login, logout, or when the tab becomes visible). */
  refresh: () => Promise<AuthSession | null>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

/** Holds the sign-in layer and the current session. Wraps the whole app, so entry and login pages can use it. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = React.useState<AuthRepository | null>(null);
  const [session, setSession] = React.useState<AuthSession | null>(null);
  const [status, setStatus] = React.useState<AuthStatus>("loading");
  const created = React.useRef<AuthRepository | null>(null);

  const read = React.useCallback(async (repo: AuthRepository) => {
    const s = await repo.getSession();
    setSession(s);
    setStatus(s.authenticated ? "signedIn" : "signedOut");
    return s;
  }, []);

  // Created in an effect: the mock layer opens IndexedDB, which only exists in the browser.
  React.useEffect(() => {
    if (created.current) return;
    const repo = createAuthLayer({});
    created.current = repo;
    setAuth(repo);
    void read(repo);
  }, [read]);

  // A session can end while the tab sits in the background (expired, or signed out from another device).
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && created.current) void read(created.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [read]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      auth,
      dev: auth && "dev" in auth ? (auth as MockAuthLayer).dev : null,
      status,
      session,
      refresh: async () => (created.current ? read(created.current) : null),
    }),
    [auth, status, session, read],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
