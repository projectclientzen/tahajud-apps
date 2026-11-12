"use client";

import * as React from "react";
import {
  AUTH_SCENARIOS,
  createAuthLayer,
  type AuthRepository,
  type AuthScenarioName,
  type AuthSession,
  type MockAuthDevTools,
  type MockAuthLayer,
} from "@/data";

interface AuthContextValue {
  auth: AuthRepository | null;
  /** Mock only: OTP peek and scenarios. Null in live mode. */
  authDev: MockAuthDevTools | null;
  /** Last answer from the auth layer. Null until the first answer. */
  session: AuthSession | null;
  /** False until the first session check finished. */
  ready: boolean;
  /** The auth layer could not be reached and nothing is known yet. Not the same as signed out. */
  unreachable: boolean;
  /** Ask the auth layer again (after sign-in, sign-out, a scenario change, or the tab coming back). */
  refresh: () => Promise<AuthSession | null>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

/** Mock only: scenario a fresh browser starts in. The e2e build sets it to `logged_in`. Default `logged_out`. */
function startScenario(): AuthScenarioName {
  const v = process.env.NEXT_PUBLIC_DEMO_AUTH_SCENARIO;
  return (AUTH_SCENARIOS as readonly string[]).includes(v ?? "") ? (v as AuthScenarioName) : "logged_out";
}

const RECHECK_MS = 5 * 60_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = React.useState<AuthRepository | null>(null);
  const [session, setSession] = React.useState<AuthSession | null>(null);
  const [ready, setReady] = React.useState(false);
  const [unreachable, setUnreachable] = React.useState(false);
  const authRef = React.useRef<AuthRepository | null>(null);

  const refresh = React.useCallback(async () => {
    const a = authRef.current;
    if (!a) return null;
    try {
      const s = await a.getSession();
      setSession(s);
      setUnreachable(false);
      setReady(true);
      return s;
    } catch {
      // Cannot reach the server: keep what we know. With nothing known yet, say so instead of "signed out".
      setUnreachable(true);
      setReady(true);
      return null;
    }
  }, []);

  // Created in an effect: the mock auth opens IndexedDB, which only exists in the browser.
  React.useEffect(() => {
    if (authRef.current) return;
    const a = createAuthLayer({ scenario: startScenario() });
    authRef.current = a;
    setAuth(a);
    void refresh();
  }, [refresh]);

  // Another device may have signed this one out, or the 30 days may be over: look again when the tab returns.
  React.useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(() => void refresh(), RECHECK_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [refresh]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      auth,
      authDev: auth && "dev" in auth ? (auth as MockAuthLayer).dev : null,
      session,
      ready,
      unreachable: unreachable && session === null,
      refresh,
    }),
    [auth, session, ready, unreachable, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** User id of the signed-in user, or null. */
export function useUserId(): string | null {
  const { session } = useAuth();
  return session?.authenticated ? (session.user?.id ?? null) : null;
}
