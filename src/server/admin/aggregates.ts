import { K, mergeSmallGroups, suppressCount, type Group, type Shown } from "./rules/k-anon";

/** What `app_private.admin_aggregates` returns: counts only, no row per user. */
export interface RawAggregates {
  entitlements: Group[];
  accounts: number;
  onboarding: Group[];
  levels: Group[];
  active_users: number;
  recent_activity: Group[];
  completed_nights: Group[];
  notifications_7_days: { type: string; status: string; n: number }[];
}

/** What a screen may see. Every number is at least K, or null. */
export interface Aggregates {
  k: number;
  accounts: number | null;
  active_users: number | null;
  entitlements: Shown;
  onboarding: Shown;
  levels: Shown;
  completed_nights: Shown;
  recent_activity: { key: string; n: number | null }[];
  notifications_7_days: Shown;
}

const num = (v: unknown): number => Number(v);
const groups = (g: Group[] | null | undefined): Group[] => (g ?? []).map((x) => ({ key: x.key, n: num(x.n) }));

/** The only door from raw counts to a screen. Every group below K is merged or hidden here (PRIV-01, PRD §22.5). */
export function shapeAggregates(raw: RawAggregates): Aggregates {
  return {
    k: K,
    accounts: suppressCount(num(raw.accounts)),
    active_users: suppressCount(num(raw.active_users)),
    entitlements: mergeSmallGroups(groups(raw.entitlements)),
    onboarding: mergeSmallGroups(groups(raw.onboarding)),
    levels: mergeSmallGroups(groups(raw.levels)),
    completed_nights: mergeSmallGroups(groups(raw.completed_nights)),
    // Windows overlap, so each is its own count and is hidden on its own.
    recent_activity: groups(raw.recent_activity).map((g) => ({ key: g.key, n: suppressCount(g.n) })),
    notifications_7_days: mergeSmallGroups(
      (raw.notifications_7_days ?? []).map((x) => ({ key: `${x.type}:${x.status}`, n: num(x.n) })),
    ),
  };
}
