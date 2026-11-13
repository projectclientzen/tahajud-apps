import { ApiError } from "@/data/contracts";
import { PROVISIONAL_AUTH } from "@/domain/config/provisional";
import { one } from "@/server/db";
import { hmacHex, newSecret } from "./crypto";
import type { AuthDeps } from "./service";

/** Where an admin reset link points. The token sits in the fragment (`#t=`): it never reaches server logs or Referer. */
export const RESET_LINK_PATH = "/reset";

export function buildResetLink(appBaseUrl: string, token: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}${RESET_LINK_PATH}#t=${token}`;
}

export interface IssuedResetToken {
  /** Shown to the admin once. Only its keyed hash is stored, so it cannot be shown again. */
  token: string;
  expires_at: string;
}

/**
 * Interface for the admin task (X8). Makes a single-use reset token for an existing account. A new token revokes the
 * open ones of that account. `reason` is required and the action goes to `admin_audit_logs` in the same transaction.
 * The caller (an admin endpoint) must already have checked that `actorId` may do this.
 */
export async function issueAdminResetToken(
  d: AuthDeps,
  input: { actorId: string; targetUserId: string; reason: string; ttlSeconds?: number },
): Promise<IssuedResetToken> {
  if (input.reason.trim().length < 3) throw new ApiError("VALIDATION_ERROR", "Alasan wajib diisi.", { reason: "reason" });
  const token = newSecret();
  const res = await d.db.asService((q) =>
    one<{ expires_at: string }>(q, "app_private.password_token_issue($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::int)", [
      input.actorId,
      input.targetUserId,
      hmacHex(d.cfg.pepper, "pwtoken", token),
      input.reason,
      d.now().toISOString(),
      input.ttlSeconds ?? PROVISIONAL_AUTH.adminResetTokenMinutes * 60,
    ]),
  );
  return { token, expires_at: res.expires_at };
}
