import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { LIVE_PASSWORD, livePhone } from "./live-auth";

const mail = (kind: string, project: string) => `${kind}-${project}@ngajigaes.test`;

/** First sign-in of a bought account: the real activation screens, email + phone of the order, then a password. */
async function activateUi(page: Page, email: string) {
  await page.goto("/activate");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Nomor HP").fill(livePhone(email));
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByLabel("Password baru", { exact: true }).fill(LIVE_PASSWORD);
  await page.getByLabel("Ulangi password", { exact: true }).fill(LIVE_PASSWORD);
  await page.getByRole("button", { name: "Aktifkan akun" }).click();
  await expect(page.getByTestId("activated-email")).toHaveText(email);
  await page.getByRole("button", { name: "Lanjut ke aplikasi" }).click();
}

/** Later sign-in of an account that exists: email + password on /login. */
async function loginUi(page: Page, email: string, password = LIVE_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
}

test("live: the real login, onboarding and a Level 1 night, saved on the server", async ({ page, browser }, info) => {
  const email = mail("live", info.project.name);
  await activateUi(page, email);

  // onboarding: welcome, region, confirm
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
  // 520 regions now: the list is searched, not scrolled (T9 C).
  await page.getByLabel("Cari wilayah").fill("Jakarta (contoh)");
  await page.getByRole("radio", { name: /Jakarta \(contoh\)/ }).check();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByTestId("confirm-fajr")).toContainText("04.30");
  await page.getByRole("button", { name: "Mulai perjalanan" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // live mode never shows the demo badge, and says plainly that nothing has been recorded yet
  await expect(page.getByText("Subuh berikutnya")).toBeVisible();
  await expect(page.getByText("Data demo")).toHaveCount(0);
  await expect(page.getByText("Belum ada catatan")).toBeVisible();

  // start tonight's session and count dhikr
  await page.goto("/worship/session");
  await page.getByRole("button", { name: "Mulai ibadah malam ini" }).click();
  await expect(page.getByRole("heading", { name: "Malam", exact: true })).toBeVisible();
  await page
    .getByRole("link", { name: /Istighfar/ })
    .first()
    .click();
  const tap = page.getByRole("button", { name: "Tambah satu hitungan" });
  for (let i = 0; i < 12; i++) await tap.click();
  await expect(page.getByTestId("count")).toHaveText("12");
  await expect(page.getByTestId("sync-status")).toHaveText(/Tersinkron/, { timeout: 15_000 });

  // the owner's Arabic text arrives from the database, unchanged
  const arabic = (await page.locator("[lang='ar']").first().textContent()) ?? "";
  const owner = JSON.parse(readFileSync("content/amalan.v1.json", "utf8")).dhikr.istighfar.arabic_text as string;
  expect(arabic.trim()).toBe(owner.trim());

  // a reload shows what the server has
  await page.reload();
  await expect(page.getByTestId("count")).toHaveText("12");

  // another browser with the same sign-in but nothing stored locally sees the same night
  const state = await page.context().storageState(); // cookies only: no IndexedDB
  const other = await browser.newContext({
    storageState: { cookies: state.cookies, origins: [] },
    baseURL: info.project.use.baseURL,
    viewport: info.project.use.viewport,
  });
  const p2 = await other.newPage();
  await p2.goto("/worship/session");
  await p2
    .getByRole("link", { name: /Istighfar/ })
    .first()
    .click();
  await expect(p2.getByTestId("count")).toHaveText("12");
  await other.close();

  // the dashboard now counts the night in progress, from the server
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Lanjutkan ibadah" })).toBeVisible();
  await expect(page.getByTestId("required-progress")).toContainText("0 dari");

  // the session cookie is invisible to page scripts
  expect(await page.evaluate(() => document.cookie)).not.toContain("tt_session");
  expect((await page.context().cookies()).find((c) => c.name === "tt_session")).toMatchObject({
    httpOnly: true,
    sameSite: "Lax",
  });
});

test("live: the API answers privately and refuses what it should", async ({ page, request }) => {
  const anon = await request.get("/api/v1/me/dashboard");
  expect(anon.status()).toBe(401);
  expect(anon.headers()["cache-control"]).toBe("private, no-store");
  expect((await anon.json()).error.code).toBe("UNAUTHENTICATED");
  const me = await request.get("/api/v1/me");
  expect(await me.json()).toMatchObject({ authenticated: false, reason: "none" });
  // no Origin on a mutation: refused
  const noOrigin = await request.post("/api/v1/auth/login", { data: { email: "someone@ngajigaes.test", password: "x" } });
  expect(noOrigin.status()).toBe(403);
  expect((await noOrigin.json()).error.code).toBe("FORBIDDEN_ORIGIN");
  const foreign = await request.post("/api/v1/auth/login", {
    data: { email: "someone@ngajigaes.test", password: "x" },
    headers: { origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);
  expect((await foreign.json()).error.code).toBe("FORBIDDEN_ORIGIN");
  // an unknown path is JSON, not a web page
  const nope = await request.get("/api/v1/nothing");
  expect(nope.status()).toBe(404);
  expect((await nope.json()).error.code).toBe("NOT_FOUND");
  void page;
});

test("live: a wrong password gets one generic message, for a known and an unknown email", async ({ page }, info) => {
  const seen: string[] = [];
  for (const email of [mail("pending", info.project.name), "nobody-at-all@ngajigaes.test"]) {
    await loginUi(page, email, "salah-salah-1");
    await expect(page.locator("#login-error")).toBeVisible();
    seen.push((await page.locator("#login-error").innerText()).trim());
  }
  expect(seen[0]).toBe("Email atau password salah.");
  expect(seen[1]).toBe(seen[0]);
});

test("live: logout removes the session and the local copy, and the app pages close again", async ({ page }, info) => {
  const email = mail("live-logout", info.project.name);
  await activateUi(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
  // 520 regions now: the list is searched, not scrolled (T9 C).
  await page.getByLabel("Cari wilayah").fill("Jakarta (contoh)");
  await page.getByRole("radio", { name: /Jakarta \(contoh\)/ }).check();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByRole("button", { name: "Mulai perjalanan" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const dbs = async () =>
    page.evaluate(async () =>
      ((await indexedDB.databases()) ?? []).map((d) => d.name ?? "").filter((n) => n.startsWith("tahajud-")),
    );
  expect((await dbs()).length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first().click();
  await page
    .getByRole("dialog", { name: "Keluar dari perangkat ini?" })
    .getByRole("button", { name: "Keluar", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login/);
  expect((await page.context().cookies()).find((c) => c.name === "tt_session")).toBeUndefined();
  expect(await dbs()).toEqual([]);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("live: an email whose purchase is not verified yet waits on its own screen", async ({ page }, info) => {
  await loginUi(page, mail("pending", info.project.name));
  await expect(page).toHaveURL(/\/access-status$/);
  await expect(page.getByText("Pembelianmu sedang diverifikasi")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/access-status$/);
});

// Regression guard for the live-mode reload loop fixed in session-view.tsx (onChanged calls reload(), not bump()).
test("live: a checklist tick is saved on the server and survives a reload", async ({ page }, info) => {
  await activateUi(page, mail("live-tick", info.project.name));
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
  // 520 regions now: the list is searched, not scrolled (T9 C).
  await page.getByLabel("Cari wilayah").fill("Jakarta (contoh)");
  await page.getByRole("radio", { name: /Jakarta \(contoh\)/ }).check();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByRole("button", { name: "Mulai perjalanan" }).click();
  await page.goto("/worship/session");
  await page.getByRole("button", { name: "Mulai ibadah malam ini" }).click();
  await page.getByRole("checkbox", { name: /Salat Taubat/ }).check();
  await expect(page.getByRole("checkbox", { name: /Salat Taubat/ })).toBeChecked();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Salat Taubat/ })).toBeChecked();
});
