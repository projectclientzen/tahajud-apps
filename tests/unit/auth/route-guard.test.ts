import { describe, expect, it } from "vitest";
import { accessScreenFor, guardRedirect } from "@/domain/auth/route-guard";

describe("route guard (PRD §6.1, §6.4)", () => {
  it("a visitor goes to /login, a user whose session ended goes to /access-status", () => {
    expect(guardRedirect("app", { authenticated: false, signedOutReason: "none" })).toBe("/login");
    expect(guardRedirect("app", { authenticated: false })).toBe("/login");
    expect(guardRedirect("app", { authenticated: false, signedOutReason: "expired" })).toBe("/access-status");
    expect(guardRedirect("app", { authenticated: false, signedOutReason: "revoked" })).toBe("/access-status");
    expect(guardRedirect("onboarding", { authenticated: false, signedOutReason: "none" })).toBe("/login");
  });

  it("anything but active access goes to /access-status, in the app and in onboarding", () => {
    for (const accessStatus of ["awaiting_order_verification", "suspended", "none"] as const) {
      for (const need of ["app", "onboarding"] as const) {
        expect(guardRedirect(need, { authenticated: true, accessStatus, onboardingCompleted: true })).toBe(
          "/access-status",
        );
      }
    }
    // Unknown access is not "active": the caller decides what to do before asking.
    expect(guardRedirect("app", { authenticated: true })).toBe("/access-status");
  });

  it("an active user who has not finished onboarding is sent to /onboarding", () => {
    const u = { authenticated: true, accessStatus: "active", onboardingCompleted: false } as const;
    expect(guardRedirect("app", u)).toBe("/onboarding");
    expect(guardRedirect("onboarding", u)).toBeNull();
  });

  it("an onboarded user may use the app, and is sent away from onboarding", () => {
    const u = { authenticated: true, accessStatus: "active", onboardingCompleted: true } as const;
    expect(guardRedirect("app", u)).toBeNull();
    expect(guardRedirect("onboarding", u)).toBe("/dashboard");
  });

  it("picks the /access-status variant from what the server said, never from the URL", () => {
    expect(accessScreenFor({ authenticated: false, signedOutReason: "expired" })).toBe("session_expired");
    expect(accessScreenFor({ authenticated: false, signedOutReason: "revoked" })).toBe("session_expired");
    expect(accessScreenFor({ authenticated: false, signedOutReason: "none" })).toBeNull();
    expect(accessScreenFor({ authenticated: true, accessStatus: "awaiting_order_verification" })).toBe(
      "purchase_pending",
    );
    expect(accessScreenFor({ authenticated: true, accessStatus: "none" })).toBe("no_access");
    expect(accessScreenFor({ authenticated: true, accessStatus: "suspended" })).toBe("no_access");
    expect(accessScreenFor({ authenticated: true, accessStatus: "active" })).toBeNull();
  });
});
