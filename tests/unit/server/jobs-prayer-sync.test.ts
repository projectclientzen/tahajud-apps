import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PgliteDb } from "@/server/db/pglite";
import { silentLogger } from "@/server/jobs/log";
import { monthsNeeded, providerRegionId, syncPrayerTimes, type RegionRow } from "@/server/jobs/prayer-sync";
import { JobError } from "@/server/jobs/types";
import { makeEquranRegionId } from "@/server/prayer/regions";
import { PrayerError, type PrayerDay, type PrayerTimeProvider } from "@/server/prayer/types";
import { addUser, createJobsDb, resetJobsTables } from "./jobs-harness";

let db: PgliteDb;
beforeAll(async () => {
  db = await createJobsDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetJobsTables(db);
  await db.exec("delete from public.regions where province_name <> 'DEMO'");
});

const NOW = new Date("2026-11-12T03:00:00Z");

async function addRegion(province: string, city: string, tz: string, code: string | null = null): Promise<string> {
  const rows = await db.exec(
    "insert into public.regions (province_name, city_name, provider_region_code, timezone) values ($1, $2, $3, $4) returning id",
    [province, city, code ?? makeEquranRegionId(province, city), tz],
  );
  return rows[0]!.id as string;
}

async function userIn(regionId: string): Promise<void> {
  const u = await addUser(db, { region: null });
  await db.exec("update public.profiles set region_id = $2 where user_id = $1", [u.id, regionId]);
}

/** A provider that serves the whole month with Fajr 04:06 and Maghrib 17:51 local time, and counts calls. */
class FakeProvider implements PrayerTimeProvider {
  readonly name = "equran";
  readonly calls: string[] = [];
  failFor = new Set<string>();
  verification: PrayerDay["verification"] = "verified";
  async fetchMonth(regionId: string, year: number, month: number): Promise<PrayerDay[]> {
    this.calls.push(`${regionId}@${year}-${String(month).padStart(2, "0")}`);
    if (this.failFor.has(regionId)) throw new PrayerError("PROVIDER_FAILED", "upstream 503");
    const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => {
      const d = `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
      return {
        regionId,
        date: d,
        fajrAt: new Date(`${d}T04:06:00+07:00`).toISOString(),
        maghribAt: new Date(`${d}T17:51:00+07:00`).toISOString(),
        timezone: "Asia/Jakarta",
        provider: "equran",
        fetchedAt: NOW.toISOString(),
        validUntil: new Date(`${d.slice(0, 8)}${String(n).padStart(2, "0")}T23:59:00+07:00`).toISOString(),
        verification: this.verification,
        attribution: "Bimas Islam Kemenag RI via EQuran.id",
      };
    });
  }
}

const run = (provider: PrayerTimeProvider | null, now = NOW) =>
  syncPrayerTimes((fn) => db.asService(fn), { provider, now: () => now, log: silentLogger });

describe("monthsNeeded (PRD §14.4: refresh 7 days before data runs out)", () => {
  it("this month only, until 7 days are left", () => {
    expect(monthsNeeded(new Date("2026-11-12T03:00:00Z"), "Asia/Jakarta", 7)).toEqual([{ year: 2026, month: 11 }]);
    expect(monthsNeeded(new Date("2026-11-22T03:00:00Z"), "Asia/Jakarta", 7)).toEqual([{ year: 2026, month: 11 }]); // 8 days left
    expect(monthsNeeded(new Date("2026-11-23T03:00:00Z"), "Asia/Jakarta", 7)).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
    ]);
  });
  it("rolls over the year, and uses the region's date, not the server's", () => {
    expect(monthsNeeded(new Date("2026-12-28T03:00:00Z"), "Asia/Jakarta", 7).at(-1)).toEqual({ year: 2027, month: 1 });
    // 31 Dec 18:00Z is already 1 Jan in Jayapura (UTC+9)
    expect(monthsNeeded(new Date("2026-12-31T18:00:00Z"), "Asia/Jayapura", 7)[0]).toEqual({ year: 2027, month: 1 });
  });
});

describe("providerRegionId", () => {
  const base: RegionRow = { id: "x", province_name: "DKI Jakarta", city_name: "Kota Jakarta", provider_region_code: null, timezone: "Asia/Jakarta" };
  it("builds the EQuran id from the names, or keeps a stored code that already has the format", () => {
    expect(providerRegionId(base)).toBe("DKI Jakarta::Kota Jakarta");
    expect(providerRegionId({ ...base, provider_region_code: "DKI Jakarta::Kota Jakarta" })).toBe("DKI Jakarta::Kota Jakarta");
    expect(providerRegionId({ ...base, provider_region_code: "3171" })).toBe("DKI Jakarta::Kota Jakarta");
  });
});

describe("prayer_sync job", () => {
  it("fails with a clear, non-retryable message when no provider is configured", async () => {
    const e = await run(null).catch((x) => x);
    expect(e).toBeInstanceOf(JobError);
    expect((e as JobError).retryable).toBe(false);
    expect((e as JobError).message).toMatch(/provider/i);
  });

  it("fetches this month for regions people use, stores the cross-check and attribution, and skips DEMO regions", async () => {
    const jkt = await addRegion("DKI Jakarta", "Kota Jakarta", "Asia/Jakarta");
    await addRegion("Jawa Barat", "Kota Bandung", "Asia/Jakarta"); // nobody uses it
    await userIn(jkt);
    const demo = await addUser(db); // DEMO-JKT
    expect(demo.id).toBeTruthy();
    const p = new FakeProvider();
    const r = await run(p);
    expect(p.calls).toEqual(["DKI Jakarta::Kota Jakarta@2026-11"]);
    expect(r).toMatchObject({ regions: 1, fetched: 1, fresh: 0, rowsWritten: 30 });
    const rows = await db.exec(
      "select local_date::text as d, provider, verification, attribution, fajr_at from public.prayer_times where region_id = $1 order by local_date",
      [jkt],
    );
    expect(rows).toHaveLength(30);
    expect(rows[0]).toMatchObject({ d: "2026-11-01", provider: "equran", verification: "verified", attribution: "Bimas Islam Kemenag RI via EQuran.id" });
    expect(new Date(rows[11]!.fajr_at as string).toISOString()).toBe("2026-11-11T21:06:00.000Z");
  });

  it("stores a failed cross-check as needs_review, never as verified", async () => {
    const jkt = await addRegion("DKI Jakarta", "Kota Jakarta", "Asia/Jakarta");
    await userIn(jkt);
    const p = new FakeProvider();
    p.verification = "needs_review";
    await run(p);
    expect((await db.exec("select distinct verification from public.prayer_times where region_id = $1", [jkt]))).toEqual([{ verification: "needs_review" }]);
  });

  it("is idempotent and caches: a complete valid month is not fetched again", async () => {
    const jkt = await addRegion("DKI Jakarta", "Kota Jakarta", "Asia/Jakarta");
    await userIn(jkt);
    const p = new FakeProvider();
    await run(p);
    const again = await run(p);
    expect(p.calls).toHaveLength(1);
    expect(again).toMatchObject({ fetched: 0, fresh: 1, rowsWritten: 0 });
    expect((await db.exec("select count(*)::int as n from public.prayer_times where region_id = $1", [jkt]))[0]!.n).toBe(30);
  });

  it("fetches next month too once the current one has 7 days or fewer left", async () => {
    const jkt = await addRegion("DKI Jakarta", "Kota Jakarta", "Asia/Jakarta");
    await userIn(jkt);
    const p = new FakeProvider();
    await run(p, new Date("2026-11-25T03:00:00Z"));
    expect(p.calls).toEqual(["DKI Jakarta::Kota Jakarta@2026-11", "DKI Jakarta::Kota Jakarta@2026-12"]);
  });

  it("refetches a month that was only partly stored", async () => {
    const jkt = await addRegion("DKI Jakarta", "Kota Jakarta", "Asia/Jakarta");
    await userIn(jkt);
    const p = new FakeProvider();
    await run(p);
    await db.exec("delete from public.prayer_times where region_id = $1 and local_date > '2026-11-20'", [jkt]);
    await run(p);
    expect(p.calls).toHaveLength(2);
    expect((await db.exec("select count(*)::int as n from public.prayer_times where region_id = $1", [jkt]))[0]!.n).toBe(30);
  });

  it("one failing region does not stop the others, and the job reports the failure so it is retried", async () => {
    const jkt = await addRegion("DKI Jakarta", "Kota Jakarta", "Asia/Jakarta");
    const bdg = await addRegion("Jawa Barat", "Kota Bandung", "Asia/Jakarta");
    await userIn(jkt);
    await userIn(bdg);
    const p = new FakeProvider();
    p.failFor.add("Jawa Barat::Kota Bandung");
    const e = await run(p).catch((x) => x);
    expect(e).toBeInstanceOf(JobError);
    expect((e as JobError).retryable).toBe(true);
    expect((e as JobError).message).toMatch(/1 of 2 region\(s\) failed.*upstream 503/);
    // Jakarta was still stored.
    expect((await db.exec("select count(*)::int as n from public.prayer_times where region_id = $1", [jkt]))[0]!.n).toBe(30);
    expect((await db.exec("select count(*)::int as n from public.prayer_times where region_id = $1", [bdg]))[0]!.n).toBe(0);
    // The retry only repeats the failed region.
    p.failFor.clear();
    p.calls.length = 0;
    await run(p);
    expect(p.calls).toEqual(["Jawa Barat::Kota Bandung@2026-11"]);
  });

  it("when the provider fails, rows already stored stay and nothing is invented", async () => {
    const jkt = await addRegion("DKI Jakarta", "Kota Jakarta", "Asia/Jakarta");
    await userIn(jkt);
    const p = new FakeProvider();
    await run(p, new Date("2026-11-12T03:00:00Z"));
    const before = await db.exec("select count(*)::int as n from public.prayer_times");
    p.failFor.add("DKI Jakarta::Kota Jakarta");
    await run(p, new Date("2026-11-30T03:00:00Z")).catch(() => undefined); // december is needed and fails
    expect(await db.exec("select count(*)::int as n from public.prayer_times")).toEqual(before);
  });

  it("refuses a region whose stored timezone disagrees with the province", async () => {
    const odd = await addRegion("DKI Jakarta", "Kota Jakarta", "Asia/Jayapura");
    await userIn(odd);
    const p = new FakeProvider();
    const e = await run(p).catch((x) => x);
    expect((e as JobError).message).toMatch(/timezone mismatch/);
    expect(p.calls).toHaveLength(0);
  });

  it("ignores users who are not onboarded or have no active access", async () => {
    const jkt = await addRegion("DKI Jakarta", "Kota Jakarta", "Asia/Jakarta");
    const u = await addUser(db, { region: null, entitlement: "suspended" });
    await db.exec("update public.profiles set region_id = $2 where user_id = $1", [u.id, jkt]);
    const p = new FakeProvider();
    expect(await run(p)).toMatchObject({ regions: 0 });
    expect(p.calls).toHaveLength(0);
  });
});
