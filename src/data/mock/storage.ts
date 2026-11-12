import { openDB, type IDBPDatabase } from "idb";
import type { MockState, StateStorage } from "./state";

const KEY = "mock";
const STORE = "state";

/** The mock "server" for one user. Not on the device in real life, so it is NOT in `tahajud-<userId>`. */
export const mockDbName = (userId: string): string => `tahajud-mock-${userId}`;

const open = new Map<string, Promise<IDBPDatabase>>();

function openMock(userId: string): Promise<IDBPDatabase> {
  const name = mockDbName(userId);
  let p = open.get(name);
  if (!p) {
    p = openDB(name, 1, {
      upgrade: (db) => void db.createObjectStore(STORE),
      blocking() {
        open.delete(name);
        void p?.then((db) => db.close());
      },
      terminated: () => void open.delete(name),
    });
    open.set(name, p);
  }
  return p;
}

/**
 * IndexedDB database `tahajud-mock-<userId>`. Kept apart from the device database `tahajud-<userId>` (offline
 * queue) so that logout wipes the device copy (SECURITY-06) but the demo account survives, like a real server.
 */
export function idbStorage(userId: string): StateStorage {
  return {
    async load() {
      return ((await (await openMock(userId)).get(STORE, KEY)) as MockState | undefined) ?? null;
    },
    async save(state) {
      await (await openMock(userId)).put(STORE, state, KEY);
    },
    async clear() {
      await (await openMock(userId)).delete(STORE, KEY);
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
