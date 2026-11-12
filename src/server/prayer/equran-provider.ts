import type { LatLon } from "./crosscheck";
import { crossCheckMonth } from "./crosscheck";
import { validateEquranMonth, type EquranMonth, type EquranRequest } from "./equran-schema";
import { EQURAN_ATTRIBUTION, crosscheckCoordinates, parseEquranRegionId, timezoneForProvince } from "./regions";
import { localToUtcIso } from "./time";
import { PrayerError, type PrayerDay, type PrayerTimeProvider } from "./types";

export type LogEntry = { event: string; [k: string]: unknown };

export interface EquranProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** Retries after the first try. Default 2. */
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  userAgent?: string;
  coordinates?: (provinsi: string, kabkota: string) => LatLon | null;
  log?: (entry: LogEntry) => void;
  fetchImpl?: typeof fetch;
}

const defaultLog = (e: LogEntry) => console.warn(JSON.stringify({ scope: "prayer.equran", ...e }));

export class EquranProvider implements PrayerTimeProvider {
  readonly name = "equran";
  private readonly o: Required<EquranProviderOptions>;

  constructor(opts: EquranProviderOptions = {}) {
    this.o = {
      baseUrl: "https://equran.id/api/v2/shalat",
      timeoutMs: 8000,
      maxRetries: 2,
      baseDelayMs: 500,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => new Date(),
      userAgent: "tahajud-tracker/0.1",
      coordinates: crosscheckCoordinates,
      log: defaultLog,
      fetchImpl: fetch,
      ...opts,
    };
  }

  /** regionId format: see makeEquranRegionId. */
  async fetchMonth(regionId: string, year: number, month: number): Promise<PrayerDay[]> {
    const { provinsi, kabkota } = parseEquranRegionId(regionId);
    const timezone = timezoneForProvince(provinsi);
    const req: EquranRequest = { provinsi, kabkota, bulan: month, tahun: year };

    const raw = await this.post(req);
    let body: EquranMonth;
    try {
      body = validateEquranMonth(raw, req);
    } catch (err) {
      this.o.log({ event: "month_rejected", provinsi, kabkota, month, year, reason: err instanceof Error ? err.message : String(err) });
      throw err;
    }

    let verification: PrayerDay["verification"] = "unchecked";
    const at = this.o.coordinates(provinsi, kabkota);
    if (at) {
      const cc = crossCheckMonth(body.data.jadwal, year, month, timezone, at);
      verification = cc.withinThreshold ? "verified" : "needs_review";
      if (!cc.withinThreshold) {
        this.o.log({ event: "crosscheck_failed", provinsi, kabkota, month, year, maxDiffMin: Math.round(cc.maxDiffMin * 10) / 10 });
      }
    } else {
      this.o.log({ event: "crosscheck_skipped_no_coordinates", provinsi, kabkota });
    }

    const lastDay = body.data.jadwal.length;
    const lastDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const validUntil = localToUtcIso(lastDate, "23:59", timezone);
    const fetchedAt = this.o.now().toISOString();

    return body.data.jadwal.map((row) => ({
      regionId,
      date: row.tanggal_lengkap,
      fajrAt: localToUtcIso(row.tanggal_lengkap, row.subuh, timezone),
      maghribAt: localToUtcIso(row.tanggal_lengkap, row.maghrib, timezone),
      timezone,
      provider: "equran",
      fetchedAt,
      validUntil,
      verification,
      attribution: EQURAN_ATTRIBUTION,
    }));
  }

  private async post(req: EquranRequest): Promise<unknown> {
    let lastErr = "";
    for (let attempt = 0; attempt <= this.o.maxRetries; attempt++) {
      try {
        const res = await this.o.fetchImpl(this.o.baseUrl, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": this.o.userAgent },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
        if (res.ok) return await res.json();
        lastErr = `HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500) {
          throw new PrayerError("PROVIDER_FAILED", `EQuran request failed: ${lastErr}`);
        }
      } catch (err) {
        if (err instanceof PrayerError) throw err;
        lastErr = err instanceof Error ? err.message : String(err);
      }
      if (attempt < this.o.maxRetries) await this.o.sleep(this.o.baseDelayMs * 2 ** attempt);
    }
    throw new PrayerError("PROVIDER_FAILED", `EQuran request failed after ${this.o.maxRetries + 1} tries: ${lastErr}`);
  }
}
