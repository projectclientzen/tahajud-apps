/** Delay before try number `attempt` (1 = first retry): 2 s, 4 s, 8 s ... capped at 5 minutes. */
export function backoffMs(attempt: number): number {
  // shortcut: no jitter, add some when many devices retry against one server (S5+)
  return Math.min(2_000 * 2 ** Math.max(0, attempt - 1), 300_000);
}
