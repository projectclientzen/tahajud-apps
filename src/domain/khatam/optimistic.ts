import { isValidDay, slotPages, type Prayer } from "./plan";
import { adjustmentFor, pagesRead, positionAfterMark, type KhatamState } from "./progress";

/** A change the user made that the server has not confirmed yet (it sits in the offline queue). */
export type PendingOp =
  | { kind: "slot"; day: number; prayer: Prayer; done: boolean }
  | { kind: "mark"; page: number };

/**
 * What the screen shows while changes wait to sync: the server state with the waiting changes applied in order,
 * by the same rules the server uses. Pure. When the server answers, its state replaces this one.
 */
export function applyPending(state: KhatamState, ops: readonly PendingOp[]): KhatamState {
  let reads = [...state.reads];
  let adjustment = state.adjustment;
  for (const op of ops) {
    if (op.kind === "slot") {
      if (!isValidDay(op.day)) continue;
      const i = reads.findIndex((r) => r.day === op.day && r.prayer === op.prayer);
      if (op.done && i < 0) reads.push({ day: op.day, prayer: op.prayer, pages: slotPages(state.khatamCount, op.day, op.prayer) });
      if (!op.done && i >= 0) reads = reads.filter((_, j) => j !== i);
    } else if (Number.isInteger(op.page) && op.page >= 1 && op.page <= 604) {
      const cur = pagesRead({ khatamCount: state.khatamCount, adjustment, reads });
      adjustment = adjustmentFor(positionAfterMark(cur, op.page, state.khatamCount), reads);
    }
  }
  return { ...state, reads, adjustment };
}
