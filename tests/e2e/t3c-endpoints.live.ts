import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { LIVE_PASSWORD, livePhone } from "./live-auth";

/**
 * T3c: the endpoints added after T3b, called the way the browser calls them (same origin, cookie, Origin header)
 * against the real server and a real PostgreSQL (PGlite). No UI for these exists yet in live mode, so the calls are
 * made with fetch from inside the page.
 */
const mail = (kind: string, project: string) => `t3c-${kind}-${project}@ngajigaes.test`;

// Each sign-in comes from its own address: activation is limited to 20 an hour per IP, and the t3b tests share one.
let ipCounter = 0;
const nextIp = (project: string) => `198.51.100.${(project === "mobile" ? 10 : 100) + ++ipCounter}`;

interface Reply {
  status: number;
  headers: Record<string, string>;
  // The shape depends on the endpoint; every test checks the fields it needs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  text: string;
}

/** fetch() from the page: the browser adds the cookie and the Origin header itself. */
async function api(page: Page, method: string, path: string, body?: unknown): Promise<Reply> {
  return page.evaluate(
    async ([m, p, b]) => {
      const res = await fetch(`/api/v1${p}`, {
        method: m as string,
        headers: b === undefined ? undefined : { "content-type": "application/json" },
        body: b === undefined ? undefined : JSON.stringify(b),
        credentials: "same-origin",
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* 204 or not JSON */
      }
      return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json, text };
    },
    [method, path, body] as [string, string, unknown],
  );
}

async function signInAndOnboard(page: Page, email: string, project: string) {
  await page.goto("/login");
  const headers = { origin: new URL(page.url()).origin, "x-forwarded-for": nextIp(project) };
  const activate = await page.request.post("/api/v1/auth/activate", {
    data: { email, phone: livePhone(email), password: LIVE_PASSWORD, device_label: `Chrome ${project}` },
    headers,
  });
  expect(activate.status()).toBe(200);
  const regions = (await (await page.request.get("/api/v1/regions")).json()) as { id: string; name: string }[];
  const jkt = regions.find((r) => r.name.startsWith("Jakarta"))!;
  expect(
    (await page.request.put("/api/v1/me/location", { data: { mode: "region", region_id: jkt.id }, headers })).status(),
  ).toBe(200);
  expect((await page.request.post("/api/v1/me/onboarding/complete", { data: {}, headers })).status()).toBe(200);
  await page.goto("/login");
}

const SUB = (n: string) => ({
  endpoint: `https://push.example.test/e2e/${n}`,
  keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
});

test("live T3c: the Qur'an catalog serves the dataset text unchanged", async ({ page }, info) => {
  await signInAndOnboard(page, mail("quran", info.project.name), info.project.name);
  const list = await api(page, "GET", "/quran/surahs");
  expect(list.status).toBe(200);
  expect(list.headers["cache-control"]).toBe("private, no-store");
  expect(list.json.surahs.map((s: { number: number }) => s.number)).toEqual([18, 36, 55, 56, 65, 67]);

  const dataset = JSON.parse(readFileSync("content/quran/uthmani.json", "utf8")) as {
    sha256: string;
    verses: { surah: number; ayah: number; text: string }[];
  };
  expect(list.json.source.sha256).toBe(dataset.sha256);
  const surah = await api(page, "GET", "/quran/surahs/36");
  expect(surah.status).toBe(200);
  const source = dataset.verses.filter((v) => v.surah === 36).sort((a, b) => a.ayah - b.ayah);
  expect(surah.json.verses).toHaveLength(source.length);
  const first = surah.json.opening ? `${surah.json.opening} ${surah.json.verses[0].text}` : surah.json.verses[0].text;
  expect(first).toBe(source[0]!.text);
  expect(surah.json.verses.at(-1).text).toBe(source.at(-1)!.text);
  expect(surah.json.source.attribution).toContain("Tanzil");

  for (const missing of ["2", "115", "abc"]) {
    const r = await api(page, "GET", `/quran/surahs/${missing}`);
    expect(r.status, missing).toBe(404);
    expect(r.json.error.code).toBe("NOT_FOUND");
  }
});

test("live T3c: stored prayer times, with the range rules", async ({ page }, info) => {
  await signInAndOnboard(page, mail("prayer", info.project.name), info.project.name);
  const today = await api(page, "GET", "/prayer-times?include_maghrib=true");
  expect(today.status).toBe(200);
  expect(today.json.region.timezone).toBe("Asia/Jakarta");
  expect(today.json.days).toHaveLength(1);
  expect(today.json.days[0]).toMatchObject({ source: "provider" });
  expect(today.json.days[0].fajr_at).toMatch(/T21:30:00\.000Z$/);
  expect(today.json.days[0].maghrib_at).not.toBeNull();

  const range = await api(
    page,
    "GET",
    `/prayer-times?from=${today.json.days[0].local_date}&to=${today.json.days[0].local_date}`,
  );
  expect(range.json.days[0].maghrib_at).toBeNull();
  expect((await api(page, "GET", "/prayer-times?from=2026-11-14&to=2026-11-12")).status).toBe(400);
  expect((await api(page, "GET", "/prayer-times?region_id=jakarta")).status).toBe(404);
});

test("live T3c: push subscriptions, and SECURITY-04 in a real browser", async ({ page, browser }, info) => {
  const a = mail("push-a", info.project.name);
  const b = mail("push-b", info.project.name);
  await signInAndOnboard(page, a, info.project.name);
  const mine = await api(page, "POST", "/me/push-subscriptions", SUB(`a-${info.project.name}`));
  expect(mine.status).toBe(201);
  expect(Object.keys(mine.json).sort()).toEqual(["created_at", "id", "is_active"]);
  expect(mine.text).not.toContain("p256dh");

  const ctx: BrowserContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const other = await ctx.newPage();
  try {
    await signInAndOnboard(other, b, info.project.name);
    const theirs = await api(other, "POST", "/me/push-subscriptions", SUB(`b-${info.project.name}`));
    expect(theirs.status).toBe(201);

    // A tries to delete B's subscription
    const attack = await api(page, "DELETE", `/me/push-subscriptions/${theirs.json.id}`);
    expect(attack.status).toBe(404);
    expect(attack.json.error.code).toBe("NOT_FOUND");
    // B can still remove it, A removes their own
    expect((await api(other, "DELETE", `/me/push-subscriptions/${theirs.json.id}`)).status).toBe(204);
    expect((await api(page, "DELETE", `/me/push-subscriptions/${mine.json.id}`)).status).toBe(204);
    expect((await api(page, "DELETE", `/me/push-subscriptions/${mine.json.id}`)).status).toBe(404);
  } finally {
    await ctx.close();
  }

  const history = await api(page, "GET", "/me/notifications");
  expect(history.status).toBe(200);
  expect(history.json).toEqual({ notifications: [] });
});

test("live T3c: a foreign Origin is 403 FORBIDDEN_ORIGIN on the new mutations", async ({ page }, info) => {
  await signInAndOnboard(page, mail("origin", info.project.name), info.project.name);
  const evil = { origin: "https://evil.example" };
  for (const [path, data] of [
    ["/api/v1/me/push-subscriptions", SUB("evil")],
    ["/api/v1/me/data-export", {}],
    ["/api/v1/me/delete-account", { confirm: true }],
  ] as const) {
    const res = await page.request.post(path, { data, headers: evil });
    expect(res.status(), path).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");
  }
  // nothing was deleted
  expect((await api(page, "GET", "/me/access")).json.access_status).toBe("active");
});

test("live T3c: a user without access cannot read paid content, but can still export and delete", async ({
  page,
}, info) => {
  const email = mail("lapsed", info.project.name);
  await page.goto("/login");
  const headers = { origin: new URL(page.url()).origin, "x-forwarded-for": nextIp(info.project.name) };
  const login = await page.request.post("/api/v1/auth/login", {
    data: { email, password: LIVE_PASSWORD, device_label: "Chrome lapsed" },
    headers,
  });
  expect(login.status()).toBe(200);
  for (const path of ["/quran/surahs", "/quran/surahs/18", "/prayer-times", "/me/notifications"]) {
    const r = await api(page, "GET", path);
    expect(r.status, path).toBe(403);
    expect(r.json.error.code).toBe("ENTITLEMENT_INACTIVE");
  }
  const exp = await api(page, "POST", "/me/data-export", {});
  expect(exp.status).toBe(200);
  expect(exp.json.account.email).toBe(email);
  expect(exp.json.access[0].status).toBe("suspended");
  expect((await api(page, "POST", "/me/delete-account", { confirm: true })).status).toBe(200);
});

test("live T3c: export, then delete the account; the session is gone and the data with it", async ({ page }, info) => {
  const email = mail("del", info.project.name);
  await signInAndOnboard(page, email, info.project.name);
  const session = await api(page, "POST", "/me/night-sessions", {});
  expect(session.status).toBe(200);
  const counter = session.json.activities.find(
    (a: { kind: string; key: string }) => a.kind === "counter" && a.key === "istighfar",
  );
  const ops = await api(page, "POST", `/session-activities/${counter.id}/counter-operations`, {
    operations: [{ kind: "delta", operation_id: "e2e-del-1", delta: 9, client_recorded_at: new Date().toISOString() }],
  });
  expect(ops.json.results[0].authoritative_count).toBe(9);
  await api(page, "POST", "/me/push-subscriptions", SUB(`del-${info.project.name}`));

  const exp = await api(page, "POST", "/me/data-export", {});
  expect(exp.status).toBe(200);
  expect(exp.headers["cache-control"]).toBe("private, no-store");
  expect(exp.json.format_version).toBe(1);
  expect(exp.json.account.email).toBe(email);
  expect(exp.json.sessions).toHaveLength(1);
  expect(exp.json.sessions[0].activities.find((a: { key: string }) => a.key === "istighfar").count).toBe(9);
  for (const leak of ["p256dh", "push.example.test", "token_hash", "SESSION_PEPPER"])
    expect(exp.text).not.toContain(leak);

  // not confirmed: nothing happens
  expect((await api(page, "POST", "/me/delete-account", {})).status).toBe(400);
  expect((await api(page, "GET", "/me/access")).json.access_status).toBe("active");

  const del = await api(page, "POST", "/me/delete-account", { confirm: true });
  expect(del.status).toBe(200);
  expect(del.json).toMatchObject({ ok: true });
  expect((await page.context().cookies()).find((c) => c.name === "tt_session")).toBeUndefined();
  expect((await api(page, "GET", "/me/dashboard")).status).toBe(401);
  expect((await api(page, "GET", "/me")).json).toMatchObject({ authenticated: false });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});
