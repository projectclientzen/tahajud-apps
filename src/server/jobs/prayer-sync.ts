import { localDate } from "@/domain/time/tz";
import { type Queryable } from "@/server/db";
import { makeEquranRegionId, parseEquranRegionId, timezoneForProvince } from "@/server/prayer/regions";
import type { PrayerDay, PrayerTimeProvider } from "@/server/prayer/types";
import { JobError } from "./types";
import type { Logger } from "./log";

export interface RegionRow {
  id: string;
  province_name: string;
  city_name: string;
  provider_region_code: string | null;
  timezone: string;
}

export interface SyncDeps {
  provider: PrayerTimeProvider | null;
  /** Why provider is null, for the failure message. */
  providerProblem?: string;
  now: () => Date;
  log: Logger;
  /** Refetch the next month when the current one has this many days or fewer left (PRD §14.4). */
  leadDays?: number;
}

export interface SyncResult {
  regions: number;
  fetched: number;
  fresh: number;
  rowsWritten: number;
  failures: { region_id: string; month: string; reason: string }[];
}

/** DEMO regions have no provider behind them. */
export const isDemoRegion = (r: RegionRow): boolean => (r.provider_region_code ?? "").startsWith("DEMO-") || r.province_name === "DEMO";

/** The provider's own id for a region: the stored code if it has the provider format, else built from the names. */
export function providerRegionId(r: RegionRow): string {
  const code = r.provider_region_code;
  if (code && code.includes("::")) return code;
  return makeEquranRegionId(r.province_name, r.city_name);
}

/** Regions that real, active users have chosen. Others are not worth a provider call. */
export async function listRegionsInUse(q: Queryable, nowIso: string): Promise<RegionRow[]> {
  return q.query<RegionRow>(
    `select distinct r.id, r.province_name, r.city_name, r.provider_region_code, r.timezone
     from public.regions r
     join public.profiles p on p.region_id = r.id
     where r.is_supported and p.onboarding_completed
       and exists (select 1 from public.access_entitlements e where e.user_id = p.user_id and e.status = 'active'
                   and e.starts_at <= $1::timestamptz and (e.expires_at is null or e.expires_at > $1::timestamptz))
     order by r.id`,
    [nowIso],
  );
}

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The months a region needs now: this one, and the next when this one is about to run out. */
export function monthsNeeded(now: Date, tz: string, leadDays: number): { year: number; month: number }[] {
  const today = localDate(now, tz);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const out = [{ year: y, month: m }];
  const left = daysInMonth(y, m) - d;
  if (left <= leadDays) out.push(m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 });
  return out;
}

async function isFresh(q: Queryable, regionId: string, provider: string, year: number, month: number, now: Date): Promise<boolean> {
  const first = `${ym(year, month)}-01`;
  const last = `${ym(year, month)}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
  const rows = await q.query<{ n: number }>(
    `select count(*)::int as n from public.prayer_times
     where region_id = $1::uuid and provider = $2 and local_date between $3::date and $4::date
       and (valid_until is null or valid_until >= $5::timestamptz)`,
    [regionId, provider, first, last, now.toISOString()],
  );
  return (rows[0]?.n ?? 0) >= daysInMonth(year, month);
}

/** Writes the provider's days into the cache table. Same (region, date, provider) is replaced, so re-running is safe. */
export async function upsertDays(q: Queryable, regionId: string, provider: string, days: readonly PrayerDay[]): Promise<number> {
  if (days.length === 0) return 0;
  const payload = days.map((d) => ({
    local_date: d.date,
    fajr_at: d.fajrAt,
    maghrib_at: d.maghribAt,
    fetched_at: d.fetchedAt,
    valid_until: d.validUntil,
    source_revision: d.methodVersion ?? null,
    verification: d.verification ?? null,
    attribution: d.attribution ?? null,
  }));
  const rows = await q.query(
    `insert into public.prayer_times
       (region_id, local_date, fajr_at, maghrib_at, provider, fetched_at, valid_until, source_revision, verification, attribution)
     select $1::uuid, t.local_date, t.fajr_at, t.maghrib_at, $2, t.fetched_at, t.valid_until, t.source_revision, t.verification, t.attribution
     from jsonb_to_recordset($3::jsonb) as t(local_date date, fajr_at timestamptz, maghrib_at timestamptz, fetched_at timestamptz,
                                              valid_until timestamptz, source_revision text, verification text, attribution text)
     on conflict (region_id, local_date, provider) do update set
       fajr_at = excluded.fajr_at, maghrib_at = excluded.maghrib_at, fetched_at = excluded.fetched_at,
       valid_until = excluded.valid_until, source_revision = excluded.source_revision,
       verification = excluded.verification, attribution = excluded.attribution
     returning id`,
    [regionId, provider, JSON.stringify(payload)],
  );
  return rows.length;
}

/**
 * Fills prayer_times for the regions people use (PRD §14.4): this month, and next month when this one is running out.
 * The table is the cache. A month that is already complete and valid is not fetched again, so a retry after a partial
 * failure only repeats the work that failed. If the provider fails, rows already stored keep serving until valid_until
 * (the API labels them), and this function reports the failure: nothing is invented.
 * The provider does the validation and the cross-check against the astronomical calculation (T4b, T4c) and sets `verification`.
 */
export async function syncPrayerTimes(
  withTx: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>,
  deps: SyncDeps,
): Promise<SyncResult> {
  if (!deps.provider) {
    throw new JobError(
      deps.providerProblem ?? "No prayer-time provider is configured. Set PRAYER_PROVIDER=equran once permission to use it is confirmed.",
      false,
    );
  }
  const provider = deps.provider;
  const now = deps.now();
  const regions = (await withTx((q) => listRegionsInUse(q, now.toISOString()))).filter((r) => !isDemoRegion(r));
  const out: SyncResult = { regions: regions.length, fetched: 0, fresh: 0, rowsWritten: 0, failures: [] };

  for (const r of regions) {
    let providerId: string;
    try {
      providerId = providerRegionId(r);
      const tz = timezoneForProvince(parseEquranRegionId(providerId).provinsi);
      if (tz !== r.timezone) throw new Error(`timezone mismatch: region ${r.timezone}, provider ${tz}`);
    } catch (e) {
      out.failures.push({ region_id: r.id, month: "-", reason: e instanceof Error ? e.message : String(e) });
      continue;
    }
    for (const { year, month } of monthsNeeded(now, r.timezone, deps.leadDays ?? 7)) {
      try {
        if (await withTx((q) => isFresh(q, r.id, provider.name, year, month, now))) {
          out.fresh += 1;
          continue;
        }
        const days = await provider.fetchMonth(providerId, year, month);
        out.rowsWritten += await withTx((q) => upsertDays(q, r.id, provider.name, days));
        out.fetched += 1;
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        out.failures.push({ region_id: r.id, month: ym(year, month), reason });
        deps.log("prayer_sync_region_failed", { region_id: r.id, month: ym(year, month), reason });
      }
    }
  }
  if (out.failures.length > 0) {
    throw new JobError(
      `prayer_sync: ${out.failures.length} of ${regions.length} region(s) failed (first: ${out.failures[0]!.reason}). Fetched ${out.fetched}, already fresh ${out.fresh}.`,
      true,
    );
  }
  return out;
}
