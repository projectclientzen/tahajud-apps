import { openDB } from "idb";
import type { MockState, StateStorage } from "./state";

const STORE = "state";
const KEY = "mock";

/** IndexedDB database `tahajud-<userId>`: one database per user (PRD §21.2). */
export function idbStorage(userId: string): StateStorage {
  const db = () =>
    openDB(`tahajud-${userId}`, 1, {
      upgrade(d) {
        d.createObjectStore(STORE);
      },
    });
  return {
    async load() {
      return ((await (await db()).get(STORE, KEY)) as MockState | undefined) ?? null;
    },
    async save(state) {
      await (await db()).put(STORE, state, KEY);
    },
    async clear() {
      await (await db()).delete(STORE, KEY);
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
