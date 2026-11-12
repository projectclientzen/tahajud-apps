import { ApiError, dataExportSchema, type DataExport, type DeleteAccountResponse } from "@/data/contracts";
import { hmacHex } from "@/server/auth/crypto";
import { clearSessionCookie } from "@/server/auth/cookie";
import type { AuthedUser } from "@/server/auth/service";
import { one } from "@/server/db";
import type { Deps } from "./deps";

async function userLimit(d: Deps, scope: string, userId: string, windowSeconds: number, limit: number): Promise<void> {
  const res = await d.db.asService((q) =>
    one<{ allowed: boolean; retry_after_seconds: number }>(q, "app_private.rate_hit($1, $2::timestamptz, $3, $4)", [
      `${scope}:user:${hmacHex(d.cfg.pepper, "user", userId)}`,
      d.now().toISOString(),
      windowSeconds,
      limit,
    ]),
  );
  if (!res.allowed) {
    throw new ApiError("RATE_LIMITED", "Terlalu sering mencoba. Coba lagi sebentar.", {
      reason: "user_limit",
      retry_after_seconds: res.retry_after_seconds,
    });
  }
}

/** POST /me/data-export. A big read, so a few per hour. Works for a user whose access ended. */
export async function exportData(d: Deps, user: AuthedUser): Promise<DataExport> {
  await userLimit(d, "export", user.userId, 3600, 5);
  const raw = await d.db.asService((q) =>
    one<unknown>(q, "app_private.export_user_data($1::uuid, $2::timestamptz)", [user.userId, d.now().toISOString()]),
  );
  return dataExportSchema.parse(raw);
}

/**
 * POST /me/delete-account (PRD §24.4). One transaction: the user's data goes, orders and entitlements keep a keyed hash
 * of the email instead of the address. The user id always comes from the verified cookie, never from the body.
 */
export async function deleteAccount(
  d: Deps,
  user: AuthedUser,
  secure: boolean,
): Promise<{ body: DeleteAccountResponse; cookie: string }> {
  await userLimit(d, "delete", user.userId, 3600, 5);
  const now = d.now().toISOString();
  const out = await d.db.asService(async (q) => {
    const rows = await q.query<{ email: string }>(
      "select email_normalized as email from public.profiles where user_id = $1::uuid",
      [user.userId],
    );
    if (!rows[0]) throw new ApiError("NOT_FOUND", "Akun tidak ditemukan.");
    const hash = `deleted:${hmacHex(d.cfg.pepper, "deleted-email", rows[0].email)}`;
    return one<{ deleted_at: string }>(q, "app_private.delete_account($1::uuid, $2::timestamptz, $3)", [
      user.userId,
      now,
      hash,
    ]);
  });
  return { body: { ok: true, deleted_at: out.deleted_at }, cookie: clearSessionCookie(secure) };
}
