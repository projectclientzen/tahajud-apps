import AxeBuilder from "@axe-core/playwright";
import { expect, request as pwRequest, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { base32Decode, totp } from "../../src/server/admin/rules/totp";
import { BUYER_PHONE, ORDER_NUMBER, adminEmail, buyerEmail, staffEmail } from "./admin-fixtures";
import { LIVE_PASSWORD } from "./live-auth";

/**
 * Admin e2e (X2-B). The real screens, the real /api/v1/admin routes, a real PostgreSQL (PGlite).
 * Each role signs in once and enrols its authenticator through the screen (the code is computed from the shown key with
 * the same RFC 6238 function the server uses). Tests of one role share that session, so they run in order.
 */
const REASON = "Alasan uji e2e yang cukup panjang";
let ipN = 0;
const nextIp = (project: string) => `192.0.2.${(project === "mobile" ? 10 : 110) + ++ipN}`;

async function open(browser: Browser, info: TestInfo): Promise<{ ctx: BrowserContext; page: Page; ip: string }> {
  const ip = nextIp(info.project.name);
  const use = info.project.use;
  const ctx = await browser.newContext({
    viewport: use.viewport ?? undefined,
    hasTouch: use.hasTouch,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    baseURL: info.project.use.baseURL,
    extraHTTPHeaders: { "x-forwarded-for": ip },
  });
  return { ctx, page: await ctx.newPage(), ip };
}

/** Sign in with email + password, enrol the authenticator, and land on the dashboard. */
async function signInAndEnrol(page: Page, email: string): Promise<void> {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Masuk admin", level: 1 })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(LIVE_PASSWORD);
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByRole("heading", { name: "Pasang autentikator", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Buat kunci autentikator" }).click();
  const key = (await page.getByLabel("Kunci autentikator").innerText()).trim();
  await page.getByLabel("Kode pertama").fill(totp(base32Decode(key), Date.now()));
  await page.getByRole("button", { name: "Buka admin" }).click();
  await expect(page.getByRole("heading", { name: "Ringkasan", level: 1 })).toBeVisible();
}

const noSideScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

async function axeClean(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

async function adminApi(page: Page, path: string) {
  return page.request.get(`/api/v1/admin${path}`);
}

test.describe.serial("super admin", () => {
  let ctx: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }, info) => {
    ({ ctx, page } = await open(browser, info));
  });
  test.afterAll(async () => ctx.close());

  test("sign in, set up the authenticator, and open the dashboard; no sideways scroll; no a11y violations", async ({}, info) => {
    await signInAndEnrol(page, adminEmail("super", info.project.name));
    await expect(page.getByRole("heading", { name: "Perlu ditangani" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Integrasi" })).toBeVisible();
    // Below 20 users nothing is shown (PRIV-01), and staff are not counted.
    await expect(page.getByText("Kurang dari 20").first()).toBeVisible();
    await noSideScroll(page);
    await axeClean(page);
  });

  test("a reload keeps the admin session; the response is never cached", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ringkasan", level: 1 })).toBeVisible();
    const res = await adminApi(page, "/dashboard");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toMatch(/no-store/);
  });

  test("create a staff account: link shown once, staff sets their own password, revoke", async ({ browser }, info) => {
    const email = staffEmail(info.project.name);
    await page.goto("/admin/staff");
    await expect(page.getByRole("heading", { name: "Staf", level: 1 })).toBeVisible();
    await page.getByLabel("Email staf").fill(email);
    await page.getByLabel(/^Alasan/).fill(REASON);
    await page.getByRole("button", { name: "Buat akun dan tautan" }).click();
    const box = page.getByLabel("Tautan atur password");
    await expect(box).toBeVisible();
    const link = await box.inputValue();
    expect(link).toMatch(/\/reset#t=[A-Za-z0-9_-]{40,}$/);
    await noSideScroll(page);

    // The staff member opens the link in their own browser and chooses a password.
    const staff = await open(browser, info);
    await staff.page.goto(link);
    await staff.page.getByLabel("Password baru", { exact: true }).fill("kata-sandi-staf-uji-77");
    await staff.page.getByLabel("Ulangi password", { exact: true }).fill("kata-sandi-staf-uji-77");
    await staff.page.getByRole("button", { name: "Simpan password" }).click();
    await expect
      .poll(async () => (await (await staff.page.request.get("/api/v1/me/access")).json()).access_status, { timeout: 15_000 })
      .toBe("active");
    // The same link does not work twice.
    const again = await staff.page.request.post("/api/v1/auth/set-password", {
      data: { token: link.split("#t=")[1], password: "kata-sandi-lain-staf-88" },
      headers: { origin: new URL(link).origin },
    });
    expect(again.status()).toBe(400);

    // The staff list shows them with a password, and the link is gone from the screen after leaving it.
    await page.goto("/admin/staff");
    const row = page.getByRole("listitem").filter({ hasText: email });
    await expect(row.getByText("Sudah punya password")).toBeVisible();
    await expect(page.getByLabel("Tautan atur password")).toHaveCount(0);

    await row.getByRole("button", { name: "Kelola" }).click();
    await row.getByLabel(/^Alasan/).last().fill(REASON);
    await row.getByRole("button", { name: "Cabut akses" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: email }).getByText("Dicabut", { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await (await staff.page.request.get("/api/v1/me/access")).json()).access_status, { timeout: 15_000 })
      .not.toBe("active");
    await staff.ctx.close();
  });

  test("the audit log shows what was done, with who and why", async () => {
    await page.goto("/admin/audit-logs");
    await expect(page.getByText("Akun staf dibuat").first()).toBeVisible();
    await expect(page.getByText("Akses staf dicabut").first()).toBeVisible();
    await expect(page.getByText("Tautan atur password dibuat").first()).toBeVisible();
    await expect(page.getByText(REASON).first()).toBeVisible();
    await axeClean(page);
  });
});

test.describe.serial("support admin (CS)", () => {
  let ctx: BrowserContext;
  let page: Page;
  let ip: string;

  test.beforeAll(async ({ browser }, info) => {
    ({ ctx, page, ip } = await open(browser, info));
  });
  test.afterAll(async () => ctx.close());

  test("find the held order by email and read why it is held", async ({}, info) => {
    const p = info.project.name;
    await signInAndEnrol(page, adminEmail("cs", p));
    await page.goto("/admin/users");
    await page.getByLabel("Email, nomor order, atau ID").fill(buyerEmail(p));
    await page.getByRole("button", { name: "Cari" }).click();
    await expect(page.getByRole("heading", { name: /^Order \(1\)/ })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(`#${ORDER_NUMBER(p)}`) }).click();
    await expect(page.getByText("Order ditahan: Ditandai spam oleh Scalev")).toBeVisible();
    await expect(page.getByText("Tersimpan sebagai hash. Tidak bisa ditampilkan.")).toBeVisible();
    // No phone number anywhere on the page, not even the digits of the test number.
    expect(await page.locator("body").innerText()).not.toMatch(/5555.?0101/);
    await noSideScroll(page);
    await axeClean(page);
  });

  test("phone check says match or no match and never shows the number", async ({}, info) => {
    const p = info.project.name;
    void p;
    await page.getByLabel("Nomor HP yang disebut pembeli").fill("0899 0000 1111");
    await page.getByRole("button", { name: "Cek nomor" }).click();
    await expect(page.getByText("Tidak cocok dengan nomor di order.")).toBeVisible();
    await page.getByLabel("Nomor HP yang disebut pembeli").fill(BUYER_PHONE);
    await page.getByRole("button", { name: "Cek nomor" }).click();
    await expect(page.getByText("Cocok dengan nomor di order.")).toBeVisible();
    await expect(page.getByLabel("Nomor HP yang disebut pembeli")).toHaveValue("");
  });

  test("approve by hand needs a reason and a reference; then the buyer can activate; block and unblock work", async ({}, info) => {
    const p = info.project.name;
    const approve = page.getByRole("button", { name: "Setujui dan beri akses" });
    await expect(approve).toBeDisabled();
    await page.getByLabel("Referensi persetujuan").fill("bukti-transfer-e2e");
    await page.getByLabel(/^Alasan/).first().fill(REASON);
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(page.getByText("Disetujui manual admin")).toBeVisible();
    await expect(page.getByText("Order disetujui manual").first()).toBeVisible();

    // The buyer is a different person: their own request context, so the CS cookie is not replaced by the buyer's session.
    const origin = new URL(page.url()).origin;
    const activate = async () => {
      const buyer = await pwRequest.newContext({ baseURL: origin });
      try {
        return await buyer.post("/api/v1/auth/activate", {
          data: { email: buyerEmail(p), phone: BUYER_PHONE, password: "kata-sandi-pembeli-uji-9" },
          headers: { origin, "x-forwarded-for": `${ip.split(".").slice(0, 3).join(".")}.200` },
        });
      } finally {
        await buyer.dispose();
      }
    };

    // Blocked: one generic failure.
    await page.getByLabel(/^Alasan/).last().fill(REASON);
    await page.getByRole("button", { name: "Blokir aktivasi" }).click();
    await expect(page.getByText("Aktivasi diblokir").first()).toBeVisible();
    expect((await activate()).status()).toBe(400);

    // Reopened: activation works, with the same email and phone as the order.
    await page.getByLabel(/^Alasan/).last().fill(REASON);
    await page.getByRole("button", { name: "Buka blokir" }).click();
    await expect(page.getByRole("button", { name: "Blokir aktivasi" })).toBeVisible();
    expect((await activate()).status()).toBe(200);
  });

  test("a support admin sees no staff or role screens, and the server refuses them", async () => {
    const me = await (await adminApi(page, "/me")).json();
    const hrefs = me.nav.map((n: { href: string }) => n.href);
    expect(hrefs).toContain("/admin/purchases");
    expect(hrefs).not.toContain("/admin/staff");
    expect(hrefs).not.toContain("/admin/levels");
    expect((await adminApi(page, "/staff")).status()).toBe(403);
    expect((await adminApi(page, "/roles")).status()).toBe(403);
    await page.goto("/admin/staff");
    await expect(page.getByText("Peran akunmu tidak boleh melakukan ini.")).toBeVisible();
  });
});

test.describe.serial("content admin", () => {
  let ctx: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }, info) => {
    ({ ctx, page } = await open(browser, info));
  });
  test.afterAll(async () => ctx.close());

  test("sees content screens, not orders; can start a template draft", async ({}, info) => {
    await signInAndEnrol(page, adminEmail("content", info.project.name));
    await page.goto("/admin/purchases");
    await expect(page.getByText("Peran akunmu tidak boleh melakukan ini.")).toBeVisible();
    await page.goto("/admin/notifications");
    await expect(page.getByRole("heading", { name: "Notifikasi", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Template baru" }).click();
    await page.getByLabel("Judul").fill("Waktunya istirahat");
    await page.getByLabel("Isi pesan").fill("Halo {nama}, tidur lebih awal malam ini.");
    await page.getByRole("button", { name: "Simpan sebagai draf" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Waktunya istirahat" }).getByText("Draf")).toBeVisible();
    await axeClean(page);
  });

  test("Arabic text is refused in a template", async () => {
    await page.getByRole("button", { name: "Template baru" }).click();
    await page.getByLabel("Judul").fill("Judul uji");
    await page.getByLabel("Isi pesan").fill("بسم الله");
    await page.getByRole("button", { name: "Simpan sebagai draf" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Arab" })).toBeVisible();
  });
});
