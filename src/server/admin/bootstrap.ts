import { isPlausibleEmail, normalizeEmail } from "@/domain/auth/email";
import { PROVISIONAL_AUTH } from "@/domain/config/provisional";
import { hmacHex, newSecret } from "@/server/auth/crypto";
import type { AuthDeps } from "@/server/auth/service";
import { buildResetLink } from "@/server/auth/tokens";
import { one } from "@/server/db";
import { ADMIN_ROLES, type AdminRole } from "./rules/permissions";

export interface BootstrapInput {
  email: string;
  role?: string;
  /** Print a one time link to choose a password. Only when the caller says the output is a terminal. */
  printLink?: boolean;
  isTty?: boolean;
  appBaseUrl?: string;
  /** Let a second super_admin be made from the command line. Off by default: later roles are granted in /admin. */
  allowAnotherSuperAdmin?: boolean;
}

export interface BootstrapResult {
  email: string;
  role: AdminRole;
  accountCreated: boolean;
  roleGranted: boolean;
  /** Present only when printLink was asked, the output is a terminal, and the account has no password yet. */
  link?: string;
  notes: string[];
}

export class BootstrapError extends Error {}

/**
 * Gives the first admin role to an email. There is no password anywhere in this path: an account made here has no
 * credentials, so nobody can sign in until its owner opens a one time reset link and chooses a password.
 * The link is returned only to a terminal and is never logged. Every change is written to the audit log (actor: none,
 * because no admin exists yet).
 */
export async function grantAdminRole(d: AuthDeps, input: BootstrapInput): Promise<BootstrapResult> {
  const email = normalizeEmail(input.email);
  if (!isPlausibleEmail(email)) throw new BootstrapError("Email tidak valid.");
  const role = (input.role ?? "super_admin") as AdminRole;
  if (!(ADMIN_ROLES as readonly string[]).includes(role)) {
    throw new BootstrapError(`Role tidak dikenal. Pilih salah satu: ${ADMIN_ROLES.join(", ")}.`);
  }
  const now = d.now();
  const notes: string[] = [];

  let granted: { user_id: string; created: boolean; granted: boolean; has_password: boolean };
  try {
    granted = await d.db.asService((q) =>
      one(q, "app_private.admin_bootstrap_grant($1, $2, $3::boolean, $4::timestamptz)", [email, role, Boolean(input.allowAnotherSuperAdmin), now.toISOString()]),
    );
  } catch (e) {
    if ((e as { message?: string }).message === "CONFLICT") {
      throw new BootstrapError("Sudah ada super_admin. Tambah peran lain lewat /admin/roles, atau pakai --allow-another-super-admin.");
    }
    throw e;
  }
  const out = { uid: granted.user_id, created: granted.created, granted: granted.granted, hasPassword: granted.has_password };

  if (out.created) notes.push("Akun dibuat tanpa password.");
  if (!out.granted) notes.push("Role ini sudah dimiliki akun tersebut.");

  let link: string | undefined;
  if (input.printLink) {
    if (!input.isTty) {
      notes.push("--print-link ditolak: output bukan terminal, tautan tidak dicetak ke log atau pipe.");
    } else if (out.hasPassword) {
      notes.push("Akun sudah punya password. Tautan tidak dibuat; pakai tautan reset dari admin lain atau CS.");
    } else {
      const base = input.appBaseUrl?.trim();
      if (!base) throw new BootstrapError("APP_BASE_URL belum diatur, tautan tidak bisa dibuat.");
      const token = newSecret();
      await d.db.asService((q) =>
        one(q, "app_private.password_token_issue(null::uuid, $1::uuid, $2, $3, $4::timestamptz, $5::int)", [
          out.uid,
          hmacHex(d.cfg.pepper, "pwtoken", token),
          "bootstrap admin pertama",
          now.toISOString(),
          PROVISIONAL_AUTH.adminResetTokenMinutes * 60,
        ]),
      );
      link = buildResetLink(base, token);
    }
  } else if (!out.hasPassword) {
    notes.push("Akun belum punya password. Jalankan lagi dengan --print-link di terminal untuk tautan sekali pakai.");
  }
  return { email, role, accountCreated: out.created, roleGranted: out.granted, link, notes };
}
