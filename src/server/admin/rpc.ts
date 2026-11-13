import type { Deps } from "@/server/api/deps";
import { one } from "@/server/db";
import { rolesFor, type Permission } from "./rules/permissions";
import type { AdminSession } from "./session";

/** A Postgres array literal. Passed as text and cast, so both drivers (pg and PGlite) read it the same way. */
export const pgArray = (items: readonly string[]): string =>
  `{${items.map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

interface Ctx {
  d: Deps;
  admin: AdminSession;
}

/**
 * Calls app_private.<fn>(actor, roles, ...args[, now]). The roles are the ones the permission table allows for this
 * action. The function checks the actor really holds one of them, so the check happens twice, in two places.
 * `casts` are the SQL types of `args`, in order.
 */
export function rpc<T>(
  c: Ctx,
  perm: Permission,
  fn: string,
  casts: readonly string[],
  args: readonly unknown[],
  opts: { now?: boolean } = {},
): Promise<T> {
  const types = ["uuid", "text[]", ...casts];
  const params: unknown[] = [c.admin.userId, pgArray(rolesFor(perm)), ...args];
  if (opts.now) {
    types.push("timestamptz");
    params.push(c.d.now().toISOString());
  }
  const call = `app_private.${fn}(${types.map((t, i) => `$${i + 1}::${t}`).join(", ")})`;
  return c.d.db.asService((q) => one<T>(q, call, params));
}
