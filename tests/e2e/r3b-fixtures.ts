import type { Page } from "@playwright/test";

/** Auth mock state with a signed-in demo user and three devices (same shape as the logged_in scenario). */
export async function seedSignedIn(page: Page) {
  // A page that runs no app code, so no sign-in layer holds the old state in memory and writes it back over the seed.
  await page.goto("/manifest.webmanifest");
  await page.evaluate(async () => {
    const now = Date.now();
    const day = 86_400_000;
    const email = "demo@ngajigaes.test";
    const state = {
      schemaVersion: 2,
      scenario: "logged_in",
      orders: {},
      accounts: {},
      fails: {},
      resetTokens: {},
      entitlements: { [email]: "active" },
      session: { userId: "u_test", email, deviceId: "dev_current", issuedAt: now - day, expiresAt: now + 29 * day },
      signedOutReason: "none",
      devices: {
        u_test: [
          { id: "dev_current", label: "Perangkat ini (Chrome)", lastSeenAt: now - day, revokedAt: null },
          { id: "dev_other_1", label: "Contoh: iPhone Safari", lastSeenAt: now - 3 * day, revokedAt: null },
          { id: "dev_other_2", label: "Contoh: Laptop Firefox", lastSeenAt: now - 9 * day, revokedAt: null },
        ],
      },
      clockOverride: null,
    };
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("tahajud-auth-mock", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("state");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction("state", "readwrite");
        tx.objectStore("state").put(state, "auth");
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
    });
  });
}
