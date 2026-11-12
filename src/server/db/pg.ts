import { Pool } from "pg";
import type { Db, Queryable } from "./types";

/** Postgres over the network (Supabase, or any PostgreSQL with the migrations applied). Credentials come from DATABASE_URL. */
export function createPgDb(connectionString: string, max = Number(process.env.DB_POOL_MAX ?? 5)): Db {
  const pool = new Pool({ connectionString, max });

  async function run<T>(role: "authenticated" | "service_role", uid: string | null, fn: (q: Queryable) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Same claims PostgREST sets. `true` = local to this transaction, so nothing leaks to the next user of the connection.
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        uid ? JSON.stringify({ sub: uid, role }) : "",
      ]);
      await client.query(`set local role ${role}`);
      const out = await fn({ query: async (sql, params) => (await client.query(sql, params as unknown[])).rows });
      await client.query("commit");
      return out;
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  return {
    asUser: (uid, fn) => run("authenticated", uid, fn),
    asService: (fn) => run("service_role", null, fn),
    close: () => pool.end(),
  };
}
