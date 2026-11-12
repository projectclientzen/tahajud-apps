import { deleteDB, openDB, type IDBPDatabase } from "idb";

/** One IndexedDB database per user: `tahajud-<userId>` (PRD §21.2). Stores: mock `state`, offline `queue`. */
export const USER_DB_VERSION = 2;
export const STORE_STATE = "state";
export const STORE_QUEUE = "queue";

export const userDbName = (userId: string): string => `tahajud-${userId}`;

const open = new Map<string, Promise<IDBPDatabase>>();

/** Connections are shared and closed when another tab upgrades or deletes the database, so purge never hangs. */
export function openUserDb(userId: string): Promise<IDBPDatabase> {
  const name = userDbName(userId);
  let p = open.get(name);
  if (!p) {
    p = openDB(name, USER_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_STATE)) db.createObjectStore(STORE_STATE);
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          const q = db.createObjectStore(STORE_QUEUE, { keyPath: "seq", autoIncrement: true });
          q.createIndex("operation_id", "operation_id", { unique: true });
        }
      },
      blocking() {
        open.delete(name);
        void p?.then((db) => db.close());
      },
      terminated() {
        open.delete(name);
      },
    });
    open.set(name, p);
  }
  return p;
}

/** Delete everything stored for this user on this device (logout, SECURITY-06). */
export async function purgeUserDb(userId: string): Promise<void> {
  const name = userDbName(userId);
  const cached = open.get(name);
  open.delete(name);
  if (cached) (await cached).close();
  await deleteDB(name);
}
