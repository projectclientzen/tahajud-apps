/**
 * Fixed-window attempt counting for the demo (mock) sign-in. The real server counts in the database
 * (`app_private.rate_hit`). Times are epoch milliseconds passed in by the caller.
 */
export function recentCount(times: readonly number[], now: number, windowMs: number): number {
  return times.filter((t) => now - t < windowMs).length;
}

export const isThrottled = (times: readonly number[], now: number, windowMs: number, limit: number): boolean =>
  recentCount(times, now, windowMs) >= limit;

/** Adds one attempt and drops the ones older than the window, so the saved state stays small. */
export const addAttempt = (times: readonly number[], now: number, windowMs: number): number[] => [
  ...times.filter((t) => now - t < windowMs),
  now,
];
