import type { Page } from "@playwright/test";

/** Test text that is clearly not Qur'an. Injected only in builds with dev routes on (e2e). */
const verses = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ number: from + i, text: `Ayat uji ${from + i}` }));

export const QURAN_FIXTURE = { 36: verses(1, 8), 65: verses(2, 3) };

export async function withQuranFixture(page: Page) {
  await page.addInitScript((f) => {
    (window as unknown as { __TT_QURAN_FIXTURE__: unknown }).__TT_QURAN_FIXTURE__ = f;
  }, QURAN_FIXTURE);
}

/** Auth mock state with a signed-in demo user and three devices (same shape as the logged_in scenario). */
export async function seedSignedIn(page: Page) {
  await page.goto("/levels"); // no auth reads on this page, so nothing races the seed
  await page.evaluate(async () => {
    const now = Date.now();
    const day = 86_400_000;
    const email = "demo@ngajigaes.test";
    const state = {
      schemaVersion: 1,
      scenario: "logged_in",
      otps: {},
      sentAt: {},
      outbox: [],
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
