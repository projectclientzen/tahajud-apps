import { openUserDb, STORE_STATE } from "../user-db";
import type { MockState, StateStorage } from "./state";

const KEY = "mock";

/** IndexedDB database `tahajud-<userId>`, shared with the offline queue (see ../user-db). */
export function idbStorage(userId: string): StateStorage {
  return {
    async load() {
      return ((await (await openUserDb(userId)).get(STORE_STATE, KEY)) as MockState | undefined) ?? null;
    },
    async save(state) {
      await (await openUserDb(userId)).put(STORE_STATE, state, KEY);
    },
    async clear() {
      await (await openUserDb(userId)).delete(STORE_STATE, KEY);
    },
  };
}

export function memoryStorage(): StateStorage {
  let s: MockState | null = null;
  return {
    async load() {
      return s ? structuredClone(s) : null;
    },
    async save(state) {
      s = structuredClone(state);
    },
    async clear() {
      s = null;
    },
  };
}
