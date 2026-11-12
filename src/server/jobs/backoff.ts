/**
 * Seconds to wait before the next try. Exponential: 30s, 1m, 2m, 4m, ... capped at 1 hour (PRD §17.7).
 * `attempt` is the number of tries made so far (1 after the first failure). No random jitter: with a few workers the
 * claim query already spreads load, and a fixed schedule is easy to reason about and to test.
 */
export function backoffSeconds(attempt: number, baseSeconds = 30, capSeconds = 3600): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(capSeconds, baseSeconds * 2 ** (n - 1));
}
