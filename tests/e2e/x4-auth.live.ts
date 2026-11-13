import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { LIVE_NEW_PASSWORD, LIVE_PASSWORD, LIVE_PHONE } from "./live-auth";

/**
 * X4 live: email + password, activation by email + phone of a paid order, reset and change password, against the real
 * server and a real PostgreSQL (PGlite). Orders and phone proofs come from tests/e2e/live-auth.ts.
 * Every call sends its own X-Forwarded-For, so one test never spends another test's per-address limit.
 */
const mail = (kind: string, project: string) => `${kind}-${project}@ngajigaes.test`;
let ipN = 0;
const nextIp = (project: string) => `203.0.113.${(project === "mobile" ? 10 : 110) + ++ipN}`;

async function post(page: Page, path: string, data: unknown, ip: string) {
  return page.request.post(`/api/v1${path}`, {
    data,
    headers: { origin: new URL(page.url() === "about:blank" ? "http://localhost:3199" : page.url()).origin, "x-forwarded-for": ip },
  });
}

test("live: activation needs the email AND the phone of the order, and gives one answer for every failure", async ({
  page,
}, info) => {
  await page.goto("/login");
  const email = mail("act-api", info.project.name);
  const ip = nextIp(info.project.name);
  const strong = LIVE_PASSWORD;
  const bodies: string[] = [];
  for (const data of [
    { email, phone: "0899 9999 9999", password: strong }, // wrong phone
    { email: mail("nobody", info.project.name), phone: LIVE_PHONE, password: strong }, // no such order
    { email: mail("pending", info.project.name), phone: LIVE_PHONE, password: strong }, // account exists already
  ]) {
    const res = await post(page, "/auth/activate", data, ip);
    expect(res.status()).toBe(400);
    expect(res.headers()["set-cookie"]).toBeUndefined();
    bodies.push(JSON.stringify(await res.json()));
  }
  expect(new Set(bodies).size).toBe(1);
  expect(JSON.parse(bodies[0]!).error.code).toBe("ACTIVATION_FAILED");
  // a weak password is explained and creates nothing
  const weak = await post(page, "/auth/activate", { email, phone: LIVE_PHONE, password: "pendek" }, ip);
  expect(weak.status()).toBe(422);
  expect((await weak.json()).error.details.reason).toBe("too_short");

  // the right data, with the phone written another way
  const ok = await post(page, "/auth/activate", { email, phone: "+62 812-3456-7890", password: strong }, ip);
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ status: "ok", user: { email }, access: { access_status: "active" } });
  expect((await page.context().cookies()).find((c) => c.name === "tt_session")).toMatchObject({
    httpOnly: true,
    sameSite: "Lax",
  });
  expect(await (await page.request.get("/api/v1/me")).json()).toMatchObject({ authenticated: true });

  // one activation per entitlement
  const again = await post(page, "/auth/activate", { email, phone: LIVE_PHONE, password: LIVE_NEW_PASSWORD }, nextIp(info.project.name));
  expect(again.status()).toBe(400);
  expect((await again.json()).error.code).toBe("ACTIVATION_FAILED");

  // the password chosen at activation opens the account on another browser
  const other: BrowserContext = await page.context().browser()!.newContext({ baseURL: info.project.use.baseURL });
  try {
    const p2 = await other.newPage();
    await p2.goto("/login");
    const login = await post(p2, "/auth/login", { email, password: strong }, nextIp(info.project.name));
    expect(login.status()).toBe(200);
    const bad = await post(p2, "/auth/login", { email, password: LIVE_NEW_PASSWORD }, nextIp(info.project.name));
    expect(bad.status()).toBe(401);
  } finally {
    await other.close();
  }
});

test("live: the activation screen creates the account and lands on onboarding", async ({ page }, info) => {
  const email = mail("act-ui", info.project.name);
  await page.goto("/activate");
  await expect(page.getByText("Data demo")).toHaveCount(0);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Nomor HP").fill("081234567890");
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByLabel("Password baru", { exact: true }).fill(LIVE_PASSWORD);
  await page.getByLabel("Ulangi password", { exact: true }).fill(LIVE_PASSWORD);
  await page.getByRole("button", { name: "Aktifkan akun" }).click();
  await expect(page.getByTestId("activated-email")).toHaveText(email);
  await page.getByRole("button", { name: "Lanjut ke aplikasi" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("live: forgot password with email + phone, then the old password stops working", async ({ page }, info) => {
  const email = mail("reset", info.project.name);
  await page.goto("/login");
  const act = await post(page, "/auth/activate", { email, phone: LIVE_PHONE, password: LIVE_PASSWORD }, nextIp(info.project.name));
  expect(act.status()).toBe(200);

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Nomor HP").fill("0899 9999 9999");
  await page.getByLabel("Password baru", { exact: true }).fill(LIVE_NEW_PASSWORD);
  await page.getByLabel("Ulangi password", { exact: true }).fill(LIVE_NEW_PASSWORD);
  await page.getByRole("button", { name: "Ganti password" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Data tidak cocok atau akun sudah aktif");

  await page.getByLabel("Nomor HP").fill(LIVE_PHONE);
  await page.getByRole("button", { name: "Ganti password" }).click();
  await expect(page.getByRole("heading", { name: "Password diganti", level: 1 })).toBeVisible();
  // every device was signed out, and no session was opened
  expect(await (await page.request.get("/api/v1/me")).json()).toMatchObject({ authenticated: false, reason: "revoked" });

  const old = await post(page, "/auth/login", { email, password: LIVE_PASSWORD }, nextIp(info.project.name));
  expect(old.status()).toBe(401);
  const fresh = await post(page, "/auth/login", { email, password: LIVE_NEW_PASSWORD }, nextIp(info.project.name));
  expect(fresh.status()).toBe(200);
});

test("live: change password needs the current one and signs the other devices out", async ({ page, browser }, info) => {
  const email = mail("chpw", info.project.name);
  await page.goto("/login");
  expect((await post(page, "/auth/activate", { email, phone: LIVE_PHONE, password: LIVE_PASSWORD }, nextIp(info.project.name))).status()).toBe(200);

  const ctx: BrowserContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const laptop = await ctx.newPage();
  try {
    await laptop.goto("/login");
    expect((await post(laptop, "/auth/login", { email, password: LIVE_PASSWORD, device_label: "Laptop" }, nextIp(info.project.name))).status()).toBe(200);

    await page.goto("/settings/account");
    await page.getByLabel("Password sekarang", { exact: true }).fill("salah-salah-1");
    await page.getByLabel("Password baru", { exact: true }).fill(LIVE_NEW_PASSWORD);
    await page.getByLabel("Ulangi password baru", { exact: true }).fill(LIVE_NEW_PASSWORD);
    await page.getByRole("button", { name: "Ganti password" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Password lama belum benar." })).toBeVisible();

    await page.getByLabel("Password sekarang", { exact: true }).fill(LIVE_PASSWORD);
    await page.getByRole("button", { name: "Ganti password" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Password diganti" })).toBeVisible();

    expect(await (await page.request.get("/api/v1/me")).json()).toMatchObject({ authenticated: true });
    expect(await (await laptop.request.get("/api/v1/me")).json()).toMatchObject({ authenticated: false, reason: "revoked" });
    const login = await post(page, "/auth/login", { email, password: LIVE_NEW_PASSWORD }, nextIp(info.project.name));
    expect(login.status()).toBe(200);
  } finally {
    await ctx.close();
  }
});

test("live: a 4th device is refused after a right password, and the old OTP routes are gone", async ({ page, browser }, info) => {
  const email = mail("limit", info.project.name);
  await page.goto("/login");
  expect((await post(page, "/auth/activate", { email, phone: LIVE_PHONE, password: LIVE_PASSWORD, device_label: "HP 1" }, nextIp(info.project.name))).status()).toBe(200);
  const contexts: BrowserContext[] = [];
  try {
    for (const label of ["HP 2", "HP 3"]) {
      const c = await browser.newContext({ baseURL: info.project.use.baseURL });
      contexts.push(c);
      const p = await c.newPage();
      await p.goto("/login");
      expect((await post(p, "/auth/login", { email, password: LIVE_PASSWORD, device_label: label }, nextIp(info.project.name))).status()).toBe(200);
    }
    const c4 = await browser.newContext({ baseURL: info.project.use.baseURL });
    contexts.push(c4);
    const p4 = await c4.newPage();
    await p4.goto("/login");
    const res = await post(p4, "/auth/login", { email, password: LIVE_PASSWORD, device_label: "HP 4" }, nextIp(info.project.name));
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "device_limit", max_devices: 3 });
    expect(body.devices).toHaveLength(3);
    expect((await c4.cookies()).find((c) => c.name === "tt_session")).toBeUndefined();
  } finally {
    for (const c of contexts) await c.close();
  }
  for (const path of ["/auth/request-otp", "/auth/verify-otp"]) {
    const res = await post(page, path, { email }, nextIp(info.project.name));
    expect([404, 405], path).toContain(res.status());
  }
});

test("live: the login limit counts the address the proxy saw, not what the client wrote first", async ({ page }, info) => {
  await page.goto("/login");
  const proxyIp = `198.51.100.${info.project.name === "mobile" ? 201 : 202}`;
  const attempt = (i: number) =>
    page.request.post("/api/v1/auth/login", {
      data: { email: `spoof${i}@ngajigaes.test`, password: "salah-salah-1" },
      // the client invents a new first entry each time, our proxy appends the real address last
      headers: { origin: new URL(page.url()).origin, "x-forwarded-for": `10.0.0.${i}, ${proxyIp}` },
    });
  for (let i = 0; i < 30; i++) expect((await attempt(i)).status()).toBe(401);
  const blocked = await attempt(99);
  expect(blocked.status()).toBe(429);
  expect(blocked.headers()["retry-after"]).toBeTruthy();
});

test("live: the payment page is public, static and never shows demo data", async ({ page }) => {
  await page.goto("/payment/success?order=1&token=secret");
  await expect(page.getByRole("heading", { name: "Pembayaran diterima", level: 1 })).toBeVisible();
  await expect(page.getByText("Data demo")).toHaveCount(0);
  await expect(page).toHaveURL(/\/payment\/success/);
  await page.getByRole("link", { name: "Aktivasi akun" }).click();
  await expect(page).toHaveURL(/\/activate$/);
});
