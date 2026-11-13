/**
 * Gives an admin role to an email. Use it once to make the first super_admin.
 *   pnpm exec tsx scripts/admin-grant-role.ts owner@example.com
 *   pnpm exec tsx scripts/admin-grant-role.ts owner@example.com --print-link     (terminal only)
 *   pnpm exec tsx scripts/admin-grant-role.ts cs@example.com --role=support_admin --allow-another-super-admin
 * Reads DATABASE_URL, SESSION_PEPPER and (for --print-link) APP_BASE_URL from the environment.
 * There is no password in this script: an account made here cannot sign in until its owner opens the one time link.
 * The link goes to the terminal only. It is not written to a file or a log, and it works once for 60 minutes.
 */
import { grantAdminRole, BootstrapError } from "../src/server/admin/bootstrap";
import { loadAuthConfig } from "../src/server/auth/config";
import { getDb } from "../src/server/db";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"));
  if (!email) {
    console.error("Pemakaian: admin-grant-role.ts <email> [--role=super_admin] [--print-link] [--allow-another-super-admin]");
    return 2;
  }
  const role = args.find((a) => a.startsWith("--role="))?.split("=")[1];
  const db = await getDb();
  try {
    const r = await grantAdminRole(
      { db, cfg: loadAuthConfig(), now: () => new Date() },
      {
        email,
        role,
        printLink: args.includes("--print-link"),
        isTty: Boolean(process.stdout.isTTY),
        appBaseUrl: process.env.APP_BASE_URL,
        allowAnotherSuperAdmin: args.includes("--allow-another-super-admin"),
      },
    );
    console.log(`${r.email}: ${r.role}${r.roleGranted ? " diberikan" : " (sudah ada)"}`);
    for (const n of r.notes) console.log(`- ${n}`);
    if (r.link) {
      console.log("\nTautan sekali pakai (60 menit). Buka di browser pemilik akun:\n");
      console.log(r.link);
    }
    return 0;
  } catch (e) {
    console.error(e instanceof BootstrapError ? e.message : `Gagal: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await db.close();
  }
}

main().then((c) => process.exit(c));
