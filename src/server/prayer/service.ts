import { localDateOf, localToUtcIso } from "./time";
import {
  PrayerError,
  type ManualSchedule,
  type PrayerCache,
  type PrayerDay,
  type PrayerTimeProvider,
  type ResolvedPrayerDay,
} from "./types";

export class InMemoryPrayerCache implements PrayerCache {
  private readonly store = new Map<string, PrayerDay[]>();
  get(key: string): PrayerDay[] | undefined {
    return this.store.get(key);
  }
  set(key: string, days: PrayerDay[]): void {
    this.store.set(key, days);
  }
}

export interface PrayerServiceOptions {
  provider: PrayerTimeProvider;
  cache?: PrayerCache;
  now?: () => Date;
  /** Prefetch next month this many days before the cached data runs out. PRD 14.4. */
  refreshLeadDays?: number;
}

const monthKey = (regionId: string, year: number, month: number) =>
  `${regionId}:${year}-${String(month).padStart(2, "0")}`;

export class PrayerService {
  private readonly provider: PrayerTimeProvider;
  private readonly cache: PrayerCache;
  private readonly now: () => Date;
  private readonly refreshLeadDays: number;

  constructor(opts: PrayerServiceOptions) {
    this.provider = opts.provider;
    this.cache = opts.cache ?? new InMemoryPrayerCache();
    this.now = opts.now ?? (() => new Date());
    this.refreshLeadDays = opts.refreshLeadDays ?? 7;
  }

  /**
   * Returns the schedule for a local date.
   * Source "provider": data came from the provider (fresh fetch or valid cached month).
   * Source "cached": provider failed and a valid cached day was used ("Jadwal tersimpan").
   * Throws SCHEDULE_UNAVAILABLE when neither exists. Nothing is invented.
   */
  async getDay(regionId: string, date: string, opts: { forceRefresh?: boolean } = {}): Promise<ResolvedPrayerDay> {
    const [y, m] = date.split("-").map(Number) as [number, number];
    const key = monthKey(regionId, y, m);
    const cached = this.cache.get(key);
    const cachedDay = cached?.find((d) => d.date === date && this.isValid(d));

    if (cachedDay && !opts.forceRefresh) {
      void this.maybePrefetchNext(regionId, y, m, cachedDay);
      return { day: cachedDay, source: "provider" };
    }

    try {
      const days = await this.provider.fetchMonth(regionId, y, m);
      this.cache.set(key, days);
      const fresh = days.find((d) => d.date === date);
      if (!fresh) throw new PrayerError("PROVIDER_FAILED", `Provider returned no data for ${date}`);
      void this.maybePrefetchNext(regionId, y, m, fresh);
      return { day: fresh, source: "provider" };
    } catch (err) {
      if (cachedDay) return { day: cachedDay, source: "cached" };
      const reason = err instanceof Error ? err.message : String(err);
      if (err instanceof PrayerError && err.code === "PROVIDER_NOT_CONFIGURED") throw err;
      throw new PrayerError("SCHEDULE_UNAVAILABLE", `No valid schedule for ${regionId} on ${date}: ${reason}`);
    }
  }

  private isValid(day: PrayerDay): boolean {
    return new Date(day.validUntil).getTime() >= this.now().getTime();
  }

  private async maybePrefetchNext(regionId: string, y: number, m: number, day: PrayerDay): Promise<void> {
    const msLeft = new Date(day.validUntil).getTime() - this.now().getTime();
    if (msLeft > this.refreshLeadDays * 86400000) return;
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    const key = monthKey(regionId, ny, nm);
    if (this.cache.get(key)) return;
    try {
      this.cache.set(key, await this.provider.fetchMonth(regionId, ny, nm));
    } catch {
      // Best effort. The next call retries.
    }
  }
}

/** Builds a day from user-entered times. Label source is always "manual". */
export function resolveManualDay(date: string, schedule: ManualSchedule, now: Date = new Date()): ResolvedPrayerDay {
  const fajrAt = localToUtcIso(date, schedule.fajr, schedule.timezone);
  const maghribAt = schedule.maghrib ? localToUtcIso(date, schedule.maghrib, schedule.timezone) : null;
  return {
    source: "manual",
    day: {
      regionId: "manual",
      date,
      fajrAt,
      maghribAt,
      timezone: schedule.timezone,
      provider: "manual",
      fetchedAt: now.toISOString(),
      validUntil: new Date(new Date(fajrAt).getTime() + 86400000).toISOString(),
    },
  };
}

export { localDateOf };
