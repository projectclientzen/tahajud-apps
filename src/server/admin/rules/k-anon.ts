/**
 * The 20 user rule (PRD §18.2, §22.5, PRIV-01). Nothing about fewer than K people reaches a screen.
 *
 * Small groups are merged, not hidden. Hiding one group while showing the total would let anyone subtract and
 * recover it. Merging keeps every total true and every shown number at K or more.
 */
export const K = 20;

export interface Group {
  key: string;
  n: number;
}
export interface ShownGroup {
  key: string;
  n: number;
  /** Set on the merged bucket: the keys that were folded in. */
  merged?: string[];
}
export interface Shown {
  /** True when the whole set is below K, so nothing is shown. */
  hidden: boolean;
  total: number | null;
  groups: ShownGroup[];
}

export const OTHER_KEY = "other";

/** One count on its own, such as "users active in 7 days". Below K it is hidden. */
export const suppressCount = (n: number, k = K): number | null => (n >= k ? n : null);

/** Groups that split one population into parts. Every returned group is at least K. */
export function mergeSmallGroups(groups: readonly Group[], k = K): Shown {
  const live = groups.filter((g) => g.n > 0);
  const total = live.reduce((s, g) => s + g.n, 0);
  if (total < k) return { hidden: true, total: null, groups: [] };
  const big = live.filter((g) => g.n >= k).map((g): ShownGroup => ({ key: g.key, n: g.n }));
  const small = live.filter((g) => g.n < k);
  const smallSum = small.reduce((s, g) => s + g.n, 0);
  if (smallSum === 0) return { hidden: false, total, groups: big };
  const merged = small.map((g) => g.key);
  if (smallSum >= k) {
    return { hidden: false, total, groups: [...big, { key: OTHER_KEY, n: smallSum, merged }] };
  }
  // The small ones together are still under K: fold in the smallest big group so the bucket reaches K.
  if (big.length === 0) {
    // Cannot happen when total >= k and every group is small and the sum is below k. Kept for safety.
    return { hidden: true, total: null, groups: [] };
  }
  big.sort((a, b) => a.n - b.n);
  const [donor, ...rest] = big;
  return {
    hidden: false,
    total,
    groups: [...rest, { key: OTHER_KEY, n: smallSum + donor!.n, merged: [...merged, donor!.key] }],
  };
}
