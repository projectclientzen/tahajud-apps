import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { CalculationMethod, Coordinates, PrayerTimes } from "adhan";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import regionsSnapshot from "@content/regions/equran-regions.json";
import provinceTimezones from "@content/regions/province-timezones.json";
import {
  EquranProvider,
  PrayerService,
  crossCheckMonth,
  makeEquranRegionId,
  parseEquranRegionId,
  timezoneForProvince,
  validateEquranMonth,
  type LogEntry,
} from "@/server/prayer";

const REQ = { provinsi: "DKI Jakarta", kabkota: "Kota Jakarta", bulan: 11, tahun: 2026 };
const JKT = { lat: -6.21, lon: 106.85 };
const REGION = makeEquranRegionId(REQ.provinsi, REQ.kabkota);
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const fmt = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/** Test fixture: times computed with adhan, rounded to the minute. Not real EQuran data. */
function fixtureMonth(shiftMin = 0, req = REQ): Record<string, unknown> {
  const params = CalculationMethod.Singapore();
  const days = new Date(Date.UTC(req.tahun, req.bulan, 0)).getUTCDate();
  const shift = (d: Date) => fmt(new Date(d.getTime() + shiftMin * 60000));
  const jadwal = Array.from({ length: days }, (_, i) => {
    const n = i + 1;
    const pt = new PrayerTimes(new Coordinates(JKT.lat, JKT.lon), new Date(req.tahun, req.bulan - 1, n), params);
    return {
      tanggal: n,
      tanggal_lengkap: `${req.tahun}-${String(req.bulan).padStart(2, "0")}-${String(n).padStart(2, "0")}`,
      hari: HARI[new Date(Date.UTC(req.tahun, req.bulan - 1, n)).getUTCDay()],
      imsak: fmt(new Date(pt.fajr.getTime() - 10 * 60000)),
      subuh: shift(pt.fajr),
      terbit: fmt(pt.sunrise),
      dhuha: fmt(new Date(pt.sunrise.getTime() + 28 * 60000)),
      dzuhur: fmt(pt.dhuhr),
      ashar: fmt(pt.asr),
      maghrib: shift(pt.maghrib),
      isya: fmt(pt.isha),
    };
  });
  return {
    code: 200,
    message: "ok",
    data: { provinsi: req.provinsi, kabkota: req.kabkota, bulan: req.bulan, tahun: req.tahun, bulan_nama: "November", jadwal },
  };
}

type Mutator = (m: ReturnType<typeof clone>) => void;
const clone = () => structuredClone(fixtureMonth()) as {
  code: number;
  data: { provinsi: string; kabkota: string; bulan: number; tahun: number; jadwal: Record<string, unknown>[] };
};
const mutated = (fn: Mutator) => {
  const m = clone();
  fn(m);
  return m;
};

describe("validateEquranMonth", () => {
  it("accepts a valid month", () => {
    expect(validateEquranMonth(fixtureMonth(), REQ).data.jadwal).toHaveLength(30);
  });

  const broken: [string, Mutator, RegExp][] = [
    ["code is not 200", (m) => (m.code = 500), /code 500/],
    ["region differs from request", (m) => (m.data.kabkota = "Kota Lain"), /does not match/],
    ["month differs from request", (m) => (m.data.bulan = 10), /does not match/],
    ["year differs from request", (m) => (m.data.tahun = 2025), /does not match/],
    ["day count is short", (m) => m.data.jadwal.pop(), /expected 30 days/],
    ["a day is missing (gap)", (m) => m.data.jadwal.splice(9, 1), /expected 30 days/],
    ["dates are out of sequence", (m) => (m.data.jadwal[4]!.tanggal_lengkap = "2026-11-09"), /date gap/],
    ["time format is wrong", (m) => (m.data.jadwal[0]!.subuh = "4:06"), /schema/],
    ["prayer order is wrong", (m) => (m.data.jadwal[2]!.imsak = "04:30"), /out of order/],
    ["subuh is out of range", (m) => {
      m.data.jadwal[1]!.subuh = "03:00";
      m.data.jadwal[1]!.imsak = "02:50";
    }, /subuh .* out of range/],
    ["maghrib is out of range", (m) => {
      m.data.jadwal[1]!.maghrib = "19:10";
      m.data.jadwal[1]!.isya = "19:40";
    }, /maghrib .* out of range/],
    ["an unknown field appears (strict)", (m) => (m.data.jadwal[0]!.extra = "x"), /schema/],
  ];
  it.each(broken)("rejects the whole month when %s", (_name, fn, re) => {
    expect(() => validateEquranMonth(mutated(fn), REQ)).toThrow(re);
  });

  it("rejects a body that is not an object", () => {
    expect(() => validateEquranMonth("nope", REQ)).toThrow(/schema/);
  });
});

describe("crossCheckMonth", () => {
  it("passes within 6 minutes and fails beyond", () => {
    const ok = validateEquranMonth(fixtureMonth(), REQ).data.jadwal;
    expect(crossCheckMonth(ok, 2026, 11, "Asia/Jakarta", JKT).withinThreshold).toBe(true);
    const shifted = validateEquranMonth(fixtureMonth(9), REQ).data.jadwal;
    const res = crossCheckMonth(shifted, 2026, 11, "Asia/Jakarta", JKT);
    expect(res.withinThreshold).toBe(false);
    expect(res.maxDiffMin).toBeGreaterThan(6);
  });
});

describe("regions", () => {
  it("maps every province in the API snapshot to a valid timezone", () => {
    expect(regionsSnapshot.provinces).toHaveLength(34);
    for (const p of regionsSnapshot.provinces) {
      expect(["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]).toContain(timezoneForProvince(p));
    }
    expect(Object.keys(provinceTimezones.timezones).sort()).toEqual([...regionsSnapshot.provinces].sort());
  });

  it("covers the known zone boundaries", () => {
    expect(timezoneForProvince("DKI Jakarta")).toBe("Asia/Jakarta");
    expect(timezoneForProvince("Kalimantan Tengah")).toBe("Asia/Jakarta");
    expect(timezoneForProvince("Kalimantan Timur")).toBe("Asia/Makassar");
    expect(timezoneForProvince("Bali")).toBe("Asia/Makassar");
    expect(timezoneForProvince("Sulawesi Selatan")).toBe("Asia/Makassar");
    expect(timezoneForProvince("Maluku")).toBe("Asia/Jayapura");
    expect(timezoneForProvince("Papua")).toBe("Asia/Jayapura");
  });

  it("rejects an unknown province and a bad region id", () => {
    expect(() => timezoneForProvince("Papua Selatan")).toThrow(/No timezone/);
    expect(() => parseEquranRegionId("nodelimiter")).toThrow(/Invalid/);
  });

  it("round-trips region ids", () => {
    expect(parseEquranRegionId(REGION)).toEqual({ provinsi: REQ.provinsi, kabkota: REQ.kabkota });
  });
});

describe("EquranProvider with a fake server", () => {
  let server: Server;
  let baseUrl: string;
  let queue: ((req: IncomingMessage, res: ServerResponse) => void)[] = [];
  let seen: { headers: IncomingMessage["headers"]; body: string }[] = [];
  let logs: LogEntry[] = [];

  const json = (status: number, body: unknown) => (_req: IncomingMessage, res: ServerResponse) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const hang = () => undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ headers: req.headers, body });
        (queue.shift() ?? json(500, {}))(req, res);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2/shalat`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });
  beforeEach(() => {
    queue = [];
    seen = [];
    logs = [];
  });

  const make = (extra = {}) =>
    new EquranProvider({ baseUrl, sleep: async () => {}, log: (e) => logs.push(e), now: () => new Date("2026-11-12T00:00:00Z"), ...extra });

  it("returns verified days with source metadata", async () => {
    queue = [json(200, fixtureMonth())];
    const days = await make().fetchMonth(REGION, 2026, 11);
    expect(days).toHaveLength(30);
    const d = days[11]!; // 12 Nov
    expect(d).toMatchObject({
      provider: "equran",
      date: "2026-11-12",
      timezone: "Asia/Jakarta",
      verification: "verified",
      attribution: "Bimas Islam Kemenag RI via EQuran.id",
      fetchedAt: "2026-11-12T00:00:00.000Z",
      validUntil: "2026-11-30T16:59:00.000Z", // 23:59 WIB on 30 Nov
    });
    expect(new Date(d.fajrAt).getTime()).toBeLessThan(new Date(d.maghribAt as string).getTime());
  });

  it("sends only the region and a generic user agent", async () => {
    queue = [json(200, fixtureMonth())];
    await make().fetchMonth(REGION, 2026, 11);
    expect(JSON.parse(seen[0]!.body)).toEqual(REQ);
    expect(seen[0]!.headers["user-agent"]).toBe("tahajud-tracker/0.1");
    expect(Object.keys(seen[0]!.headers)).not.toContain("authorization");
    expect(Object.keys(seen[0]!.headers)).not.toContain("cookie");
  });

  it("marks the month needs_review when the cross-check fails", async () => {
    queue = [json(200, fixtureMonth(9))];
    const days = await make().fetchMonth(REGION, 2026, 11);
    expect(new Set(days.map((d) => d.verification))).toEqual(new Set(["needs_review"]));
    expect(logs.some((l) => l.event === "crosscheck_failed")).toBe(true);
  });

  it("marks the month unchecked when coordinates are unknown", async () => {
    queue = [json(200, fixtureMonth())];
    const days = await make({ coordinates: () => null }).fetchMonth(REGION, 2026, 11);
    expect(days[0]!.verification).toBe("unchecked");
  });

  it.each([503, 429])("retries on %i and then succeeds", async (status) => {
    queue = [json(status, {}), json(200, fixtureMonth())];
    const days = await make().fetchMonth(REGION, 2026, 11);
    expect(days).toHaveLength(30);
    expect(seen).toHaveLength(2);
  });

  it("gives up after 2 retries (3 tries) on 5xx", async () => {
    queue = [json(500, {}), json(502, {}), json(503, {})];
    await expect(make().fetchMonth(REGION, 2026, 11)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(seen).toHaveLength(3);
  });

  it("does not retry other 4xx", async () => {
    queue = [json(404, { code: 404 })];
    await expect(make().fetchMonth(REGION, 2026, 11)).rejects.toThrow(/HTTP 404/);
    expect(seen).toHaveLength(1);
  });

  it("times out and retries", async () => {
    queue = [hang, hang, hang];
    await expect(make({ timeoutMs: 40 }).fetchMonth(REGION, 2026, 11)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(seen).toHaveLength(3);
  });

  it("backs off exponentially", async () => {
    queue = [json(500, {}), json(500, {}), json(200, fixtureMonth())];
    const delays: number[] = [];
    await make({ baseDelayMs: 100, sleep: async (ms: number) => void delays.push(ms) }).fetchMonth(REGION, 2026, 11);
    expect(delays).toEqual([100, 200]);
  });

  it("rejects and logs a malformed month", async () => {
    queue = [json(200, mutated((m) => m.data.jadwal.pop()))];
    await expect(make().fetchMonth(REGION, 2026, 11)).rejects.toThrow(/expected 30 days/);
    expect(logs.find((l) => l.event === "month_rejected")).toMatchObject({ provinsi: REQ.provinsi, month: 11, year: 2026 });
  });

  it("rejects a non-JSON body", async () => {
    queue = [json(200, "<html>oops</html>")];
    await expect(make().fetchMonth(REGION, 2026, 11)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
  });

  describe("through PrayerService", () => {
    const now = () => new Date("2026-11-12T00:00:00Z");

    it("PRAYER-01: a region change recalculates fajr", async () => {
      const mks = { ...REQ, provinsi: "Sulawesi Selatan", kabkota: "Kota Makassar" };
      queue = [json(200, fixtureMonth()), json(200, fixtureMonth(0, mks))];
      const svc = new PrayerService({ provider: make({ coordinates: () => null }), now });
      const jkt = await svc.getDay(REGION, "2026-11-13");
      const mksRes = await svc.getDay(makeEquranRegionId(mks.provinsi, mks.kabkota), "2026-11-13");
      expect(jkt.day.timezone).toBe("Asia/Jakarta");
      expect(mksRes.day.timezone).toBe("Asia/Makassar");
      expect(mksRes.day.fajrAt).not.toBe(jkt.day.fajrAt);
    });

    it("PRAYER-02: provider fails, valid cache is served as cached", async () => {
      queue = [json(200, fixtureMonth()), json(500, {}), json(500, {}), json(500, {})];
      const svc = new PrayerService({ provider: make(), now });
      const first = await svc.getDay(REGION, "2026-11-13");
      const res = await svc.getDay(REGION, "2026-11-13", { forceRefresh: true });
      expect(res.source).toBe("cached");
      expect(res.day.fajrAt).toBe(first.day.fajrAt);
    });

    it("PRAYER-02: a rejected month falls back to cache, never to bad data", async () => {
      queue = [json(200, fixtureMonth()), json(200, mutated((m) => (m.data.jadwal[12]!.subuh = "02:00")))];
      const svc = new PrayerService({ provider: make(), now });
      await svc.getDay(REGION, "2026-11-13");
      const res = await svc.getDay(REGION, "2026-11-13", { forceRefresh: true });
      expect(res.source).toBe("cached");
    });

    it("PRAYER-02: no cache and provider down gives SCHEDULE_UNAVAILABLE", async () => {
      queue = [json(500, {}), json(500, {}), json(500, {})];
      const svc = new PrayerService({ provider: make(), now });
      await expect(svc.getDay(REGION, "2026-11-13")).rejects.toMatchObject({ code: "SCHEDULE_UNAVAILABLE" });
    });
  });
});

// Optional live check. Run: EQURAN_LIVE_TEST=1 NODE_USE_ENV_PROXY=1 pnpm vitest run tests/unit/server/prayer-equran.test.ts
describe.runIf(process.env.EQURAN_LIVE_TEST === "1")("EQuran live (opt-in)", () => {
  const cities = [
    ["DKI Jakarta", "Kota Jakarta", -6.21, 106.85],
    ["Sulawesi Selatan", "Kota Makassar", -5.15, 119.43],
    ["Papua", "Kota Jayapura", -2.53, 140.72],
  ] as const;
  it.each(cities)("%s / %s passes validation and cross-check", async (prov, kab, lat, lon) => {
    const days = await new EquranProvider().fetchMonth(makeEquranRegionId(prov, kab), 2026, 11);
    expect(days.length).toBe(30);
    const params = CalculationMethod.Singapore();
    let maxFajr = 0;
    let maxMaghrib = 0;
    const lines: string[] = [];
    days.forEach((d, i) => {
      const pt = new PrayerTimes(new Coordinates(lat, lon), new Date(2026, 10, i + 1), params);
      const f = (new Date(d.fajrAt).getTime() - pt.fajr.getTime()) / 60000;
      const m = (new Date(d.maghribAt as string).getTime() - pt.maghrib.getTime()) / 60000;
      maxFajr = Math.max(maxFajr, Math.abs(f));
      maxMaghrib = Math.max(maxMaghrib, Math.abs(m));
      if ([0, 11, 29].includes(i)) {
        const t = (iso: string) =>
          new Intl.DateTimeFormat("en-GB", { timeZone: d.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
        lines.push(`${d.date} subuh EQ ${t(d.fajrAt)} adhan ${t(pt.fajr.toISOString())} (${f.toFixed(1)}m) | maghrib EQ ${t(d.maghribAt as string)} adhan ${t(pt.maghrib.toISOString())} (${m.toFixed(1)}m)`);
      }
    });
    console.log(`LIVE ${kab} verification=${days[0]?.verification} maxFajr=${maxFajr.toFixed(1)} maxMaghrib=${maxMaghrib.toFixed(1)}\n${lines.join("\n")}`);
  }, 30000);
});
