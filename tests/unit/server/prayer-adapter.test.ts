import { describe, expect, it } from "vitest";
import {
  InMemoryPrayerCache,
  PrayerError,
  PrayerService,
  SihatProvider,
  localToUtcIso,
  resolveManualDay,
  type PrayerDay,
  type PrayerTimeProvider,
} from "@/server/prayer";

function monthDays(regionId: string, year: number, month: number, fajrLocal: string, tz: string): PrayerDay[] {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const validUntil = new Date(Date.UTC(year, month - 1, last, 23, 59)).toISOString();
  return Array.from({ length: last }, (_, i) => {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
    return {
      regionId,
      date,
      fajrAt: localToUtcIso(date, fajrLocal, tz),
      maghribAt: localToUtcIso(date, "17:55", tz),
      timezone: tz,
      provider: "fake",
      fetchedAt: "2026-11-01T00:00:00.000Z",
      validUntil,
    };
  });
}

class FakeProvider implements PrayerTimeProvider {
  readonly name = "fake";
  calls: string[] = [];
  fail = false;
  async fetchMonth(regionId: string, year: number, month: number): Promise<PrayerDay[]> {
    this.calls.push(`${regionId}:${year}-${month}`);
    if (this.fail) throw new PrayerError("PROVIDER_FAILED", "upstream down");
    const tz = regionId.startsWith("makassar") ? "Asia/Makassar" : "Asia/Jakarta";
    const fajr = regionId.startsWith("makassar") ? "04:30" : "04:00";
    return monthDays(regionId, year, month, fajr, tz);
  }
}

const now = () => new Date("2026-11-12T00:00:00Z");

describe("PRAYER-01 location change recalculates fajr", () => {
  it("uses the new region data and timezone", async () => {
    const provider = new FakeProvider();
    const svc = new PrayerService({ provider, now });
    const jkt = await svc.getDay("jakarta", "2026-11-13");
    const mks = await svc.getDay("makassar", "2026-11-13");
    expect(jkt.day.fajrAt).toBe("2026-11-12T21:00:00.000Z"); // 04:00 WIB
    expect(mks.day.fajrAt).toBe("2026-11-12T20:30:00.000Z"); // 04:30 WITA
    expect(mks.day.timezone).toBe("Asia/Makassar");
    expect(provider.calls).toEqual(["jakarta:2026-11", "makassar:2026-11"]);
  });
});

describe("PRAYER-02 provider fails", () => {
  it("serves valid cache labelled cached", async () => {
    const provider = new FakeProvider();
    const svc = new PrayerService({ provider, now });
    await svc.getDay("jakarta", "2026-11-13");
    provider.fail = true;
    const res = await svc.getDay("jakarta", "2026-11-13", { forceRefresh: true });
    expect(res.source).toBe("cached");
    expect(res.day.fajrAt).toBe("2026-11-12T21:00:00.000Z");
  });

  it("throws SCHEDULE_UNAVAILABLE when no cache exists", async () => {
    const provider = new FakeProvider();
    provider.fail = true;
    const svc = new PrayerService({ provider, now });
    await expect(svc.getDay("jakarta", "2026-11-13")).rejects.toMatchObject({ code: "SCHEDULE_UNAVAILABLE" });
  });

  it("does not show expired cache as a schedule", async () => {
    const provider = new FakeProvider();
    let clock = new Date("2026-11-12T00:00:00Z");
    const svc = new PrayerService({ provider, now: () => clock });
    await svc.getDay("jakarta", "2026-11-13");
    clock = new Date("2026-12-02T00:00:00Z");
    provider.fail = true;
    await expect(svc.getDay("jakarta", "2026-11-13", { forceRefresh: true })).rejects.toMatchObject({
      code: "SCHEDULE_UNAVAILABLE",
    });
  });

  it("rejects a date the cache does not cover", async () => {
    const provider = new FakeProvider();
    const svc = new PrayerService({ provider, now });
    await svc.getDay("jakarta", "2026-11-13");
    provider.fail = true;
    await expect(svc.getDay("jakarta", "2026-12-01")).rejects.toBeInstanceOf(PrayerError);
  });
});

describe("cache and refresh", () => {
  it("fetches once per region per month", async () => {
    const provider = new FakeProvider();
    const svc = new PrayerService({ provider, now });
    await svc.getDay("jakarta", "2026-11-13");
    await svc.getDay("jakarta", "2026-11-14");
    expect(provider.calls).toHaveLength(1);
  });

  it("prefetches next month within 7 days of month end", async () => {
    const provider = new FakeProvider();
    const cache = new InMemoryPrayerCache();
    const svc = new PrayerService({ provider, cache, now: () => new Date("2026-11-26T00:00:00Z") });
    await svc.getDay("jakarta", "2026-11-26");
    await new Promise((r) => setTimeout(r, 0));
    expect(provider.calls).toContain("jakarta:2026-12");
    expect(cache.get("jakarta:2026-12")).toBeDefined();
  });
});

describe("manual schedule", () => {
  it("is labelled manual and converts the timezone", () => {
    const res = resolveManualDay("2026-11-13", { fajr: "04:10", maghrib: "17:50", timezone: "Asia/Jayapura" });
    expect(res.source).toBe("manual");
    expect(res.day.fajrAt).toBe("2026-11-12T19:10:00.000Z");
    expect(res.day.maghribAt).toBe("2026-11-13T08:50:00.000Z");
  });
});

describe("SihatProvider", () => {
  it("fails with PROVIDER_NOT_CONFIGURED without a token", async () => {
    const p: PrayerTimeProvider = new SihatProvider({});
    await expect(p.fetchMonth("x", 2026, 11)).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    await expect(p.fetchMonth("x", 2026, 11)).rejects.toThrow(/SIHAT_API_TOKEN/);
  });

  it("does not guess an API even with a token", async () => {
    const p: PrayerTimeProvider = new SihatProvider({ SIHAT_API_TOKEN: "dummy" });
    await expect(p.fetchMonth("x", 2026, 11)).rejects.toMatchObject({ code: "PROVIDER_NOT_IMPLEMENTED" });
  });

  it("service surfaces PROVIDER_NOT_CONFIGURED", async () => {
    const svc = new PrayerService({ provider: new SihatProvider({}), now });
    await expect(svc.getDay("jakarta", "2026-11-13")).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });
});
