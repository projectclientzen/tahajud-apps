import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError, dataExportSchema, quranSurahDetailSchema, quranSurahListSchema } from "@/data/contracts";
import { createHttpDataLayer } from "@/data/http";
import { hmacHex } from "@/server/auth/crypto";
import { getSurah, listSurahs } from "@/server/api/quran";
import { createApiEnv, dispatch, ORIGIN, type ApiEnv, type TestBrowser } from "./api-harness";

interface Verse {
  surah: number;
  ayah: number;
  text: string;
}
// Read from disk, not through the app's own import, so the test checks the file and not the loader.
const DATASET = JSON.parse(readFileSync(join(process.cwd(), "content", "quran", "uthmani.json"), "utf8")) as {
  source: string;
  sha256: string;
  verses: Verse[];
};

const SUB = (n: string | number) => ({
  endpoint: `https://push.example.test/send/${n}`,
  keys: { p256dh: `p256dh-secret-${n}`, auth: `auth-secret-${n}` },
});
const UNKNOWN_UUID = "00000000-0000-4000-8000-0000000000ee";

describe("Qur'an catalog (PRD §19.6)", () => {
  let env: ApiEnv;
  let b: TestBrowser;
  beforeAll(async () => {
    env = await createApiEnv();
    b = await env.onboarded("quran@ngajigaes.test");
  });
  afterAll(async () => env.close());

  it("lists the six readings with source, checksum and licence, in number order", async () => {
    const res = await b.raw("/quran/surahs");
    expect(res.status).toBe(200);
    const body = quranSurahListSchema.parse(await res.json());
    expect(body.surahs.map((s) => s.number)).toEqual([18, 36, 55, 56, 65, 67]);
    expect(body.surahs.find((s) => s.number === 18)).toMatchObject({
      name: "Al-Kahfi",
      first_ayah: 1,
      last_ayah: 110,
      ayah_count: 110,
    });
    expect(body.surahs.find((s) => s.number === 65)).toMatchObject({
      name: "At-Talaq",
      first_ayah: 2,
      last_ayah: 3,
      ayah_count: 2,
    });
    expect(body.source.sha256).toBe(DATASET.sha256);
    expect(body.source.name).toBe("tanzil-uthmani");
    expect(body.source.attribution).toContain("Tanzil");
    expect(body.source.license_url).toMatch(/^https:\/\/tanzil\.net\//);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("gives every ayah byte for byte as the dataset has it, for every surah in the file", async () => {
    for (const n of [...new Set(DATASET.verses.map((v) => v.surah))]) {
      const res = await b.raw(`/quran/surahs/${n}`);
      expect(res.status, String(n)).toBe(200);
      const body = quranSurahDetailSchema.parse(await res.json());
      const source = DATASET.verses.filter((v) => v.surah === n).sort((x, y) => x.ayah - y.ayah);
      expect(body.verses.map((v) => v.number)).toEqual(source.map((v) => v.ayah));
      source.forEach((v, i) => {
        const got = i === 0 && body.opening ? `${body.opening} ${body.verses[0]!.text}` : body.verses[i]!.text;
        expect(Buffer.from(got, "utf8").equals(Buffer.from(v.text, "utf8")), `${n}:${v.ayah}`).toBe(true);
      });
      expect(body.surah.ayah_count).toBe(source.length);
      expect(body.source.sha256).toBe(DATASET.sha256);
    }
  });

  it("the detail carries the attribution the licence asks for", async () => {
    const body = quranSurahDetailSchema.parse(await (await b.raw("/quran/surahs/36")).json());
    expect(body.source.attribution).toMatch(/Tanzil/);
    expect(body.source.source_url).toBe("https://tanzil.net");
    expect(body.surah.name).toBe("Yasin");
  });

  it.each(["2", "114", "0", "115", "-1", "abc", "1e2", "18.5", " 18", "018x", "%00", "18%2F1", "9999"])(
    "a surah the dataset does not have (%s) is 404, never made-up text",
    async (id) => {
      const res = await b.raw(`/quran/surahs/${id}`);
      expect(res.status).toBe(404);
      const err = (await res.json()).error;
      expect(err.code).toBe("NOT_FOUND");
      expect(JSON.stringify(err)).not.toMatch(/[؀-ۿ]/);
    },
  );

  it("needs a session and an active entitlement", async () => {
    expect((await env.browser().raw("/quran/surahs")).status).toBe(401);
    expect((await env.browser().raw("/quran/surahs/18")).status).toBe(401);
    for (const state of ["pending_verification", "suspended", "revoked", "expired"] as const) {
      const email = `quran-${state}@ngajigaes.test`;
      await env.grant(email, state);
      const u = await env.signIn(email);
      for (const path of ["/quran/surahs", "/quran/surahs/18"]) {
        const res = await u.raw(path);
        expect(res.status, `${state} ${path}`).toBe(403);
        expect((await res.json()).error.code).toBe("ENTITLEMENT_INACTIVE");
      }
    }
  });

  it("takes effect at once when access is taken away, with no new sign-in", async () => {
    const email = "quran-live@ngajigaes.test";
    const u = await env.onboarded(email);
    expect((await u.raw("/quran/surahs/18")).status).toBe(200);
    await env.db.exec("update public.access_entitlements set status = 'revoked' where email_normalized = $1", [email]);
    expect((await u.raw("/quran/surahs/18")).status).toBe(403);
  });

  it("is read-only: mutating methods are not routes", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await b.raw("/quran/surahs/18", {
        method,
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status, method).toBeGreaterThanOrEqual(404);
      expect(res.status, method).toBeLessThanOrEqual(405);
    }
  });

  describe("the catalog module", () => {
    it("with an empty dataset lists nothing and finds nothing", () => {
      const empty = { source: "x", sha256: "y", verses: [] };
      expect(listSurahs(empty).surahs).toEqual([]);
      expect(getSurah(18, empty)).toBeNull();
    });

    it("a surah missing from the dataset is null even if it exists in the Qur'an", () => {
      expect(getSurah(2)).toBeNull();
      expect(getSurah(18)).not.toBeNull();
    });

    it("does not alter a verse: a dataset with a marker is passed through unchanged", () => {
      const ds = { source: "t", sha256: "s", verses: [{ surah: 18, ayah: 1, text: "  xـy ۜ " }] };
      expect(getSurah(18, ds)!.verses[0]!.text).toBe("  xـy ۜ ");
    });
  });
});

describe("prayer times (PRD §19.3)", () => {
  let env: ApiEnv;
  let b: TestBrowser;
  let jktId: string;
  beforeAll(async () => {
    env = await createApiEnv();
    b = await env.onboarded("times@ngajigaes.test");
    jktId = String(
      (await env.db.exec("select id::text as id from public.regions where provider_region_code = 'DEMO-JKT'"))[0]!.id,
    );
  });
  afterAll(async () => env.close());

  it("answers for the user's own region and the active day by default", async () => {
    const res = await b.raw("/prayer-times");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.region).toMatchObject({ id: jktId, timezone: "Asia/Jakarta" });
    expect(body.days).toHaveLength(1);
    expect(body.days[0]).toMatchObject({
      local_date: "2026-11-12",
      fajr_at: "2026-11-11T21:30:00.000Z",
      maghrib_at: null,
      source: "provider",
    });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("takes region_id, from, to and include_maghrib", async () => {
    const r = await b.raw(`/prayer-times?region_id=${jktId}&from=2026-11-12&to=2026-11-14&include_maghrib=true`);
    const body = await r.json();
    expect(body.days.map((d: { local_date: string }) => d.local_date)).toEqual([
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
    ]);
    expect(body.days[0].maghrib_at).toBe("2026-11-12T10:55:00.000Z");
  });

  it("the http client builds the query and checks the answer", async () => {
    const d = await b
      .data()
      .prayerTimes.getPrayerTimes({ region_id: jktId, from: "2026-11-12", to: "2026-11-13", include_maghrib: true });
    expect(d.days).toHaveLength(2);
    expect(d.days[0]!.maghrib_at).not.toBeNull();
    expect((await b.data().prayerTimes.getPrayerTimes()).days).toHaveLength(1);
  });

  it.each([
    ["a bad date", "from=2026-13-40", 400, "VALIDATION_ERROR"],
    ["a date that is not a date", "to=besok", 400, "VALIDATION_ERROR"],
    ["a backwards range", "from=2026-11-14&to=2026-11-12", 400, "VALIDATION_ERROR"],
    ["a range over 45 days", "from=2026-11-01&to=2027-01-30", 400, "VALIDATION_ERROR"],
    ["a region id that is not an id", "region_id=jakarta", 404, "NOT_FOUND"],
    ["a region id that does not exist", `region_id=${UNKNOWN_UUID}`, 404, "NOT_FOUND"],
    ["an injection attempt", "region_id=1';drop%20table%20regions;--", 404, "NOT_FOUND"],
  ])("%s answers %i %s", async (_n, qs, status, code) => {
    const res = await b.raw(`/prayer-times?${qs}`);
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });

  it("a day with no stored row is not in the answer", async () => {
    const body = await (await b.raw("/prayer-times?from=2030-01-01&to=2030-01-03")).json();
    expect(body.days).toEqual([]);
  });

  it("a user with a manual schedule and no region is told to choose a region, with nothing invented", async () => {
    const u = await env.onboarded("times-manual@ngajigaes.test");
    await u.data().profile.setLocation({ mode: "manual", timezone: "Asia/Jakarta", fajr_time: "04:40" });
    const res = await u.raw("/prayer-times");
    expect(res.status).toBe(400);
    expect((await res.json()).error.details).toMatchObject({ reason: "LOCATION_REQUIRED" });
  });

  it("needs a session and an active entitlement", async () => {
    expect((await env.browser().raw("/prayer-times")).status).toBe(401);
    const email = "times-susp@ngajigaes.test";
    await env.grant(email, "suspended");
    const u = await env.signIn(email);
    expect((await u.raw("/prayer-times")).status).toBe(403);
  });
});

describe("push subscriptions over HTTP (SECURITY-04, SEC-14)", () => {
  let env: ApiEnv;
  let a: TestBrowser;
  let b: TestBrowser;
  beforeAll(async () => {
    env = await createApiEnv();
    a = await env.onboarded("push-a@ngajigaes.test");
    b = await env.onboarded("push-b@ngajigaes.test");
  });
  afterAll(async () => env.close());

  const count = async (email: string) =>
    Number(
      (
        await env.db.exec("select count(*) as n from public.push_subscriptions where user_id = $1::uuid", [
          await env.userId(email),
        ])
      )[0]!.n,
    );

  it("POST stores it and answers 201 with id, state and time only", async () => {
    const res = await a.json("/me/push-subscriptions", "POST", SUB("a1"));
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["created_at", "id", "is_active"]);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("push.example.test");
    expect(await count("push-a@ngajigaes.test")).toBe(1);
  });

  it("is tied to the device that is signed in, taken from the cookie and not from the body", async () => {
    const dev = (await a.auth().listDevices())[0]!.id;
    const res = await a.json("/me/push-subscriptions", "POST", {
      ...SUB("a2"),
      device_id: UNKNOWN_UUID,
      user_id: UNKNOWN_UUID,
    });
    expect(res.status).toBe(201);
    const row = (
      await env.db.exec(
        "select device_id::text as d, user_id::text as u from public.push_subscriptions where endpoint = $1",
        [SUB("a2").endpoint],
      )
    )[0]!;
    expect(row.d).toBe(dev);
    expect(row.u).toBe(await env.userId("push-a@ngajigaes.test"));
  });

  it("the http client round-trips add and remove", async () => {
    const layer = a.data();
    const sub = await layer.push.addSubscription(SUB("a3"));
    expect(sub).toMatchObject({ is_active: true });
    await expect(layer.push.removeSubscription(sub.id)).resolves.toBeUndefined();
    await expect(layer.push.removeSubscription(sub.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each([
    ["no body", undefined],
    ["an empty object", {}],
    ["an endpoint that is not a URL", { endpoint: "nope", keys: { p256dh: "k", auth: "s" } }],
    ["an http endpoint", { endpoint: "http://push.example.test/x", keys: { p256dh: "k", auth: "s" } }],
    ["no keys", { endpoint: "https://push.example.test/x" }],
    ["empty keys", { endpoint: "https://push.example.test/x", keys: { p256dh: "", auth: "" } }],
    ["keys of the wrong type", { endpoint: "https://push.example.test/x", keys: { p256dh: 1, auth: 2 } }],
    [
      "a key over 512 characters",
      { endpoint: "https://push.example.test/x", keys: { p256dh: "k".repeat(513), auth: "s" } },
    ],
  ])("refuses %s with 400 VALIDATION_ERROR", async (_n, body) => {
    const res = await a.json("/me/push-subscriptions", "POST", body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("subscribing twice from the same browser keeps one row", async () => {
    const before = await count("push-a@ngajigaes.test");
    const first = await (await a.json("/me/push-subscriptions", "POST", SUB("twice"))).json();
    const second = await (await a.json("/me/push-subscriptions", "POST", SUB("twice"))).json();
    expect(second.id).toBe(first.id);
    expect(await count("push-a@ngajigaes.test")).toBe(before + 1);
  });

  describe("SECURITY-04: DELETE of someone else's subscription", () => {
    let bSub: string;
    beforeAll(async () => {
      bSub = (await (await b.json("/me/push-subscriptions", "POST", SUB("b-own"))).json()).id;
    });

    it("answers 404 and B's subscription stays", async () => {
      const res = await a.raw(`/me/push-subscriptions/${bSub}`, { method: "DELETE" });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("NOT_FOUND");
      expect(await count("push-b@ngajigaes.test")).toBe(1);
      const row = (
        await env.db.exec("select is_active, user_id::text as u from public.push_subscriptions where id = $1::uuid", [
          bSub,
        ])
      )[0]!;
      expect(row).toMatchObject({ is_active: true, u: await env.userId("push-b@ngajigaes.test") });
    });

    it("looks the same as an id that does not exist, so ids cannot be probed", async () => {
      const foreign = await a.raw(`/me/push-subscriptions/${bSub}`, { method: "DELETE" });
      const missing = await a.raw(`/me/push-subscriptions/${UNKNOWN_UUID}`, { method: "DELETE" });
      expect(foreign.status).toBe(missing.status);
      expect(await foreign.json()).toEqual(await missing.json());
    });

    it("an id that is not a uuid is a clean 404", async () => {
      for (const bad of ["x", "1;drop table push_subscriptions", "..%2F..", "%00"]) {
        const res = await a.raw(`/me/push-subscriptions/${bad}`, { method: "DELETE" });
        expect(res.status, bad).toBe(404);
      }
    });

    it("B can still delete their own, and gets 204 with no body", async () => {
      const res = await b.raw(`/me/push-subscriptions/${bSub}`, { method: "DELETE" });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
      expect(await count("push-b@ngajigaes.test")).toBe(0);
    });
  });

  it("needs a session", async () => {
    const anon = env.browser();
    expect((await anon.json("/me/push-subscriptions", "POST", SUB("anon"))).status).toBe(401);
    expect((await anon.raw(`/me/push-subscriptions/${UNKNOWN_UUID}`, { method: "DELETE" })).status).toBe(401);
  });

  it("refuses a foreign Origin with 403 FORBIDDEN_ORIGIN and changes nothing", async () => {
    const before = await count("push-a@ngajigaes.test");
    const evil = { origin: "https://evil.example", "content-type": "application/json" };
    const post = await a.raw("/me/push-subscriptions", {
      method: "POST",
      headers: evil,
      body: JSON.stringify(SUB("evil")),
    });
    expect(post.status).toBe(403);
    expect((await post.json()).error.code).toBe("FORBIDDEN_ORIGIN");
    const one = (
      await env.db.exec("select id::text as id from public.push_subscriptions where user_id = $1::uuid limit 1", [
        await env.userId("push-a@ngajigaes.test"),
      ])
    )[0]!.id;
    const del = await a.raw(`/me/push-subscriptions/${one}`, {
      method: "DELETE",
      headers: { origin: "https://evil.example" },
    });
    expect(del.status).toBe(403);
    expect((await del.json()).error.code).toBe("FORBIDDEN_ORIGIN");
    expect(await count("push-a@ngajigaes.test")).toBe(before);
  });

  it("subscribing needs active access in every inactive state, removing does not", async () => {
    for (const state of ["pending_verification", "suspended", "revoked", "expired"] as const) {
      const email = `push-${state}@ngajigaes.test`;
      await env.grant(email, state);
      const u = await env.signIn(email);
      const res = await u.json("/me/push-subscriptions", "POST", SUB(state));
      expect(res.status, state).toBe(403);
      expect((await res.json()).error.code).toBe("ENTITLEMENT_INACTIVE");
    }
    const email = "push-lost@ngajigaes.test";
    const u = await env.onboarded(email);
    const id = (await (await u.json("/me/push-subscriptions", "POST", SUB("lost"))).json()).id;
    await env.db.exec("update public.access_entitlements set status = 'revoked' where email_normalized = $1", [email]);
    expect((await u.raw(`/me/push-subscriptions/${id}`, { method: "DELETE" })).status).toBe(204);
  });

  it("logging out removes this device's subscription; another device's stays", async () => {
    const email = "push-logout@ngajigaes.test";
    const first = await env.onboarded(email);
    const second = await env.signIn(email, { label: "Tablet" });
    await first.json("/me/push-subscriptions", "POST", SUB("lo-1"));
    await second.json("/me/push-subscriptions", "POST", SUB("lo-2"));
    expect(await count(email)).toBe(2);
    await first.auth().logout();
    const left = await env.db.exec("select endpoint from public.push_subscriptions where user_id = $1::uuid", [
      await env.userId(email),
    ]);
    expect(left.map((r) => r.endpoint)).toEqual([SUB("lo-2").endpoint]);
    // "keluarkan perangkat" from the other device does the same
    const devs = await second.auth().listDevices();
    const gone = devs.find((d) => !d.is_current);
    if (gone) await second.auth().revokeDevice(gone.id);
    expect(await count(email)).toBe(1);
  });
});

describe("notification history over HTTP (PRD §19.7)", () => {
  let env: ApiEnv;
  let a: TestBrowser;
  beforeAll(async () => {
    env = await createApiEnv();
    a = await env.onboarded("hist@ngajigaes.test");
    const uid = await env.userId("hist@ngajigaes.test");
    const tpl = String(
      (
        await env.db.exec(
          "insert into public.notification_templates (category, title, body) values ('bedtime', 'Waktunya tidur', 'Istirahat dulu.') returning id::text as id",
        )
      )[0]!.id,
    );
    const job = (type: string, at: string, status: string, key: string, t: string | null) =>
      env.db.exec(
        `insert into public.notification_jobs (user_id, notification_type, scheduled_at, expires_at, local_schedule_date, status, dedupe_key, template_id)
         values ($1::uuid, $2, $3::timestamptz, $3::timestamptz + interval '20 minutes', '2026-11-11', $4, $5, $6::uuid)`,
        [uid, type, at, status, key, t],
      );
    await job("bedtime", "2026-11-11T15:00:00Z", "sent", "h:1", tpl);
    await job("tahajud", "2026-11-11T20:00:00Z", "sent", "h:2", null);
    await job("fajr", "2026-11-11T21:30:00Z", "pending", "h:3", null);
  });
  afterAll(async () => env.close());

  it("returns what was sent, newest first, through the shared schema", async () => {
    const list = await a.data().push.listNotifications();
    expect(list.notifications.map((n) => n.type)).toEqual(["tahajud", "bedtime"]);
    expect(list.notifications[1]).toMatchObject({ title: "Waktunya tidur", body: "Istirahat dulu." });
  });

  it("takes a limit from 1 to 50 and refuses the rest", async () => {
    expect((await a.data().push.listNotifications(1)).notifications).toHaveLength(1);
    for (const bad of ["0", "51", "-3", "abc", "1.5"]) {
      const res = await a.raw(`/me/notifications?limit=${bad}`);
      expect(res.status, bad).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("never shows another user's history", async () => {
    const other = await env.onboarded("hist-other@ngajigaes.test");
    expect((await other.data().push.listNotifications()).notifications).toEqual([]);
  });

  it("needs a session and access", async () => {
    expect((await env.browser().raw("/me/notifications")).status).toBe(401);
    const email = "hist-susp@ngajigaes.test";
    await env.grant(email, "suspended");
    expect((await (await env.signIn(email)).raw("/me/notifications")).status).toBe(403);
  });
});

describe("account export and delete (PRD §24.4, PRIV-02)", () => {
  let env: ApiEnv;
  beforeAll(async () => {
    env = await createApiEnv();
  });
  afterAll(async () => env.close());

  async function fill(email: string): Promise<TestBrowser> {
    const u = await env.onboarded(email);
    const session = await u.data().session.ensureActiveSession();
    const counter = session.activities.find((x) => x.kind === "counter" && x.key === "istighfar")!;
    await u.data().session.applyCounterOperations(counter.id, {
      operations: [
        { kind: "delta", operation_id: `x-${email}`, delta: 11, client_recorded_at: env.now().toISOString() },
      ],
    });
    await u.data().profile.updateProfile({ display_name: "Nama Lengkap" });
    await u.data().quran.putProgress(18, { ayah: 20 });
    await u.data().excuse.addExcuse({ from: "2026-11-20" });
    await u.json("/me/push-subscriptions", "POST", SUB(email));
    return u;
  }

  describe("export", () => {
    it("returns everything the user owns, through the shared schema", async () => {
      const u = await fill("export@ngajigaes.test");
      const x = await u.data().account.exportData();
      expect(x.account).toMatchObject({ email: "export@ngajigaes.test", display_name: "Nama Lengkap" });
      expect(x.sessions).toHaveLength(1);
      expect(x.sessions[0]!.activities.find((a) => a.key === "istighfar")).toMatchObject({ count: 11 });
      expect(x.excused_dates).toEqual(["2026-11-20"]);
      expect(x.quran_progress).toMatchObject([{ surah: 18, ayah: 20 }]);
      expect(x.push_subscriptions).toHaveLength(1);
      expect(x.devices).toHaveLength(1);
      expect(x.access[0]).toMatchObject({ status: "active", entitlement_type: "lifetime" });
    });

    it("has no push keys, endpoint, cookie hash or secret, and is never cached", async () => {
      const u = await env.onboarded("export-clean@ngajigaes.test");
      await u.json("/me/push-subscriptions", "POST", SUB("clean"));
      const res = await u.json("/me/data-export", "POST", {});
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const text = await res.text();
      for (const leak of ["secret-clean", "push.example.test", "token_hash", "p256dh", env.cfg.pepper, "tt_session"]) {
        expect(text, leak).not.toContain(leak);
      }
      dataExportSchema.parse(JSON.parse(text));
    });

    it("holds nothing of another user", async () => {
      const a = await fill("export-own@ngajigaes.test");
      await fill("export-victim@ngajigaes.test");
      const text = JSON.stringify(await a.data().account.exportData());
      expect(text).not.toContain("victim");
      expect(text).not.toContain(await env.userId("export-victim@ngajigaes.test"));
    });

    it("works after access ended: the data is still the user's", async () => {
      const email = "export-ended@ngajigaes.test";
      const u = await fill(email);
      await env.db.exec("update public.access_entitlements set status = 'revoked' where email_normalized = $1", [
        email,
      ]);
      expect((await u.raw("/me/dashboard")).status).toBe(403);
      const x = await u.data().account.exportData();
      expect(x.sessions).toHaveLength(1);
      expect(x.access[0]!.status).toBe("revoked");
    });

    it("needs a session, and a foreign Origin is refused", async () => {
      expect((await env.browser().json("/me/data-export", "POST", {})).status).toBe(401);
      const u = await env.onboarded("export-origin@ngajigaes.test");
      const res = await u.raw("/me/data-export", {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: "{}",
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");
    });

    it("is not a GET: it cannot be started by a link or a prefetch", async () => {
      const u = await env.onboarded("export-get@ngajigaes.test");
      expect((await u.raw("/me/data-export")).status).toBeGreaterThanOrEqual(404);
    });

    it("allows five an hour, and then says RATE_LIMITED with Retry-After", async () => {
      const u = await env.onboarded("export-rate@ngajigaes.test");
      for (let i = 0; i < 5; i++) expect((await u.json("/me/data-export", "POST", {})).status).toBe(200);
      const res = await u.json("/me/data-export", "POST", {});
      expect(res.status).toBe(429);
      expect((await res.json()).error.code).toBe("RATE_LIMITED");
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      // the limit belongs to this user only
      const other = await env.onboarded("export-rate2@ngajigaes.test");
      expect((await other.json("/me/data-export", "POST", {})).status).toBe(200);
    });
  });

  describe("delete", () => {
    it("without confirm: true it does nothing", async () => {
      const u = await fill("del-confirm@ngajigaes.test");
      for (const body of [undefined, {}, { confirm: false }, { confirm: "true" }, { confirm: 1 }, []]) {
        const res = await u.json("/me/delete-account", "POST", body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
      }
      expect((await u.auth().getSession()).authenticated).toBe(true);
      expect(await u.data().report.getDashboard()).toBeTruthy();
    });

    it("deletes at once: data gone, cookie cleared, the old cookie is no longer a session", async () => {
      const email = "del-ok@ngajigaes.test";
      const u = await fill(email);
      const uid = await env.userId(email);
      const old = u.cookieValue!;
      const res = await u.json("/me/delete-account", "POST", { confirm: true });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, deleted_at: env.now().toISOString() });
      expect(res.headers.getSetCookie().join(";").toLowerCase()).toMatch(/tt_session=;|max-age=0/);
      expect(u.cookieValue).toBeUndefined();
      const tables = [
        "profiles",
        "night_sessions",
        "session_activities",
        "counter_operations",
        "quran_reading_progress",
        "push_subscriptions",
        "user_devices",
        "device_sessions",
        "session_excuses",
        "user_level_state",
      ];
      for (const t of tables) {
        const n = Number(
          (await env.db.exec(`select count(*) as n from public.${t} where user_id = $1::uuid`, [uid]))[0]!.n,
        );
        expect(n, t).toBe(0);
      }
      expect((await env.db.exec("select 1 from auth.users where id = $1::uuid", [uid])).length).toBe(0);
      // someone who kept the old cookie gets nothing
      const thief = env.browser();
      thief.setCookie(old);
      expect((await thief.raw("/me/dashboard")).status).toBe(401);
      expect((await thief.auth().getSession()).authenticated).toBe(false);
    });

    it("keeps the entitlement for the books under a keyed hash, not a plain address or a plain SHA-256", async () => {
      const email = "del-hash@ngajigaes.test";
      const u = await fill(email);
      await u.json("/me/delete-account", "POST", { confirm: true });
      const rows = await env.db.exec(
        "select user_id, email_normalized, status from public.access_entitlements where email_normalized like 'deleted:%' and email_normalized = $1",
        [`deleted:${hmacHex(env.cfg.pepper, "deleted-email", email)}`],
      );
      expect(rows).toEqual([
        {
          user_id: null,
          email_normalized: `deleted:${hmacHex(env.cfg.pepper, "deleted-email", email)}`,
          status: "active",
        },
      ]);
      const sha = createHash("sha256").update(email).digest("hex");
      expect(
        (await env.db.exec("select 1 from public.access_entitlements where email_normalized like $1", [`%${sha}%`]))
          .length,
      ).toBe(0);
      expect(
        (await env.db.exec("select 1 from public.access_entitlements where email_normalized = $1", [email])).length,
      ).toBe(0);
    });

    it("signing up again with the same email starts empty and without access", async () => {
      const email = "del-again@ngajigaes.test";
      const u = await fill(email);
      await u.json("/me/delete-account", "POST", { confirm: true });
      const again = await env.signIn(email);
      expect(await again.data().access.getAccess()).toMatchObject({ access_status: "none", entitlement_type: null });
      expect((await again.raw("/me/dashboard")).status).toBe(403);
      expect((await again.data().account.exportData()).sessions).toEqual([]);
    });

    it("only the signed-in user is deleted, whatever the body says", async () => {
      const victim = await fill("del-victim@ngajigaes.test");
      const attacker = await fill("del-attacker@ngajigaes.test");
      const victimId = await env.userId("del-victim@ngajigaes.test");
      const res = await attacker.json("/me/delete-account", "POST", {
        confirm: true,
        user_id: victimId,
        email: "del-victim@ngajigaes.test",
      });
      expect(res.status).toBe(200);
      expect((await victim.auth().getSession()).authenticated).toBe(true);
      expect((await victim.data().account.exportData()).sessions).toHaveLength(1);
      expect((await env.db.exec("select 1 from auth.users where id = $1::uuid", [victimId])).length).toBe(1);
    });

    it("other users' sessions, devices and push subscriptions are untouched", async () => {
      const keep = await fill("del-keep@ngajigaes.test");
      const gone = await fill("del-gone@ngajigaes.test");
      await gone.json("/me/delete-account", "POST", { confirm: true });
      const x = await keep.data().account.exportData();
      expect(x.sessions).toHaveLength(1);
      expect(x.push_subscriptions).toHaveLength(1);
      expect(x.devices).toHaveLength(1);
      expect((await keep.data().report.getDashboard()).prayer_time.available).toBe(true);
    });

    it("works for a user whose access ended", async () => {
      const email = "del-ended@ngajigaes.test";
      const u = await fill(email);
      await env.db.exec("update public.access_entitlements set status = 'revoked' where email_normalized = $1", [
        email,
      ]);
      const res = await u.json("/me/delete-account", "POST", { confirm: true });
      expect(res.status).toBe(200);
      expect((await env.db.exec("select 1 from public.profiles where email_normalized = $1", [email])).length).toBe(0);
    });

    it("needs a session; a foreign Origin is refused and nothing is deleted", async () => {
      expect((await env.browser().json("/me/delete-account", "POST", { confirm: true })).status).toBe(401);
      const email = "del-origin@ngajigaes.test";
      const u = await fill(email);
      const res = await u.raw("/me/delete-account", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");
      expect((await u.auth().getSession()).authenticated).toBe(true);
    });

    it("the http client returns the shared response, and the call cannot be repeated with the old cookie", async () => {
      const u = await fill("del-client@ngajigaes.test");
      const out = await u.data().account.deleteAccount();
      expect(out).toMatchObject({ ok: true });
      await expect(u.data().account.deleteAccount()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    });

    it("an unexpected failure inside the delete rolls everything back and answers a generic error", async () => {
      const email = "del-rollback@ngajigaes.test";
      const u = await fill(email);
      const uid = await env.userId(email);
      // A trigger that refuses the very last step, after the earlier steps already ran.
      await env.db.exec(
        "create or replace function public.tmp_block_user_delete() returns trigger language plpgsql as $f$ begin raise exception 'tmp block secret_detail'; end $f$",
      );
      await env.db.exec(
        "create trigger tmp_block before delete on auth.users for each row execute function public.tmp_block_user_delete()",
      );
      try {
        const res = await u.json("/me/delete-account", "POST", { confirm: true });
        expect(res.status).toBe(500);
        const text = await res.text();
        expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
        expect(text).not.toContain("secret_detail");
      } finally {
        await env.db.exec("drop trigger tmp_block on auth.users");
        await env.db.exec("drop function public.tmp_block_user_delete()");
      }
      expect(
        (await env.db.exec("select 1 from public.access_entitlements where user_id = $1::uuid", [uid])).length,
      ).toBe(1);
      expect(
        (await env.db.exec("select 1 from public.data_deletion_requests where user_id = $1::uuid", [uid])).length,
      ).toBe(0);
      expect((await u.auth().getSession()).authenticated).toBe(true);
    });
  });
});

describe("the http client for the new endpoints", () => {
  const calls: { url: string; method: string; body: string | undefined }[] = [];
  let reply: { status: number; body?: unknown } = { status: 200, body: {} };
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), method: String(init.method), body: init.body as string | undefined });
    return new Response(reply.status === 204 ? null : JSON.stringify(reply.body), { status: reply.status });
  }) as unknown as typeof fetch;
  const layer = createHttpDataLayer({ baseUrl: "https://app.test/api/v1", fetch: fetchStub });

  it("sends the right method, path, query and body", async () => {
    reply = { status: 200, body: { region: { id: "r", name: "n", timezone: "Asia/Jakarta" }, days: [] } };
    await layer.prayerTimes.getPrayerTimes({
      region_id: "r1",
      from: "2026-11-01",
      to: "2026-11-05",
      include_maghrib: true,
    });
    expect(calls.at(-1)).toMatchObject({
      method: "GET",
      url: "https://app.test/api/v1/prayer-times?region_id=r1&from=2026-11-01&to=2026-11-05&include_maghrib=true",
    });
    await layer.prayerTimes.getPrayerTimes();
    expect(calls.at(-1)!.url).toBe("https://app.test/api/v1/prayer-times");

    reply = { status: 204 };
    await layer.push.removeSubscription("a/b c");
    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      url: "https://app.test/api/v1/me/push-subscriptions/a%2Fb%20c",
    });

    reply = { status: 200, body: { ok: true, deleted_at: "2026-11-12T00:00:00.000Z" } };
    await layer.account.deleteAccount();
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: "https://app.test/api/v1/me/delete-account" });
    expect(JSON.parse(calls.at(-1)!.body!)).toEqual({ confirm: true });
  });

  it("an answer that does not match the schema is NOT_AVAILABLE, not data for the UI", async () => {
    reply = { status: 200, body: { surahs: "nope" } };
    await expect(layer.quranCatalog.listSurahs()).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
  });

  it("keeps the new error codes from the server", async () => {
    for (const [status, code] of [
      [403, "FORBIDDEN_ORIGIN"],
      [500, "INTERNAL_ERROR"],
    ] as const) {
      reply = { status, body: { error: { code, message: "pesan" } } };
      const e = await layer.account.exportData().catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ApiError);
      expect(e).toMatchObject({ code, message: "pesan" });
    }
  });

  it("an error page from a proxy (no JSON) is NOT_AVAILABLE, which the offline queue retries", async () => {
    reply = { status: 500, body: "<html>" };
    await expect(layer.account.exportData()).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
  });
});

describe("routes exist only where the PRD lists them", () => {
  let env: ApiEnv;
  beforeAll(async () => {
    env = await createApiEnv();
  });
  afterAll(async () => env.close());

  it.each([
    ["GET", "/me/push-subscriptions"],
    ["PUT", "/me/push-subscriptions"],
    ["POST", "/me/notifications"],
    ["PUT", "/me/delete-account"],
    ["GET", "/me/delete-account"],
    ["POST", "/prayer-times"],
    ["POST", "/quran/surahs"],
    ["GET", "/quran/surahs/18/verses"],
  ])("%s %s is not an endpoint", async (method, path) => {
    const res = await dispatch(
      new Request(`${ORIGIN}/api/v1${path}`, {
        method,
        headers: { origin: ORIGIN },
        body: method === "GET" ? undefined : "{}",
      }),
    );
    expect([404, 405]).toContain(res.status);
    if (res.status === 404) expect((await res.json()).error.code).toBe("NOT_FOUND");
  });
});
