import { DbConfigError } from "@/server/db";

export type ProviderName = "local" | "supabase";

export interface AuthConfig {
  provider: ProviderName;
  /** Secret mixed into every hash we store (codes, cookie secrets, rate limit keys). Server only. */
  pepper: string;
  /** Extra origins allowed to send mutating requests, besides the one the request itself targets. */
  allowedOrigins: string[];
  /** Local provider only: folder where "emails" are written as files. */
  mailDir: string | null;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
}

const DEV_PEPPER = "local-test-pepper-not-for-production-0123456789";

/**
 * Reads the auth settings from the environment. Fails with a plain message when something is missing, so the
 * server never starts half configured. No default can open a production deployment.
 */
export function loadAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const provider = (env.AUTH_PROVIDER ?? "supabase") as ProviderName;
  if (provider !== "local" && provider !== "supabase") {
    throw new DbConfigError(`AUTH_PROVIDER must be "supabase" or "local", got "${provider}".`);
  }
  if (provider === "local") {
    if (env.TAHAJUD_ALLOW_LOCAL_AUTH !== "true" || env.DB_DRIVER !== "pglite" || env.TAHAJUD_ALLOW_TEST_DB !== "true") {
      throw new DbConfigError(
        "AUTH_PROVIDER=local is for tests only. It needs TAHAJUD_ALLOW_LOCAL_AUTH=true, DB_DRIVER=pglite and TAHAJUD_ALLOW_TEST_DB=true.",
      );
    }
  } else if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new DbConfigError("SUPABASE_URL and SUPABASE_ANON_KEY are required for AUTH_PROVIDER=supabase.");
  }
  let pepper = env.SESSION_PEPPER ?? "";
  if (!pepper) {
    if (provider === "local") pepper = DEV_PEPPER;
    else throw new DbConfigError("SESSION_PEPPER is not set. Use at least 32 random characters.");
  } else if (pepper.length < 32) {
    throw new DbConfigError("SESSION_PEPPER must be at least 32 characters.");
  }
  return {
    provider,
    pepper,
    allowedOrigins: (env.APP_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    mailDir: provider === "local" ? (env.TAHAJUD_MAIL_DIR ?? null) : null,
    supabaseUrl: env.SUPABASE_URL?.replace(/\/+$/, "") ?? null,
    supabaseAnonKey: env.SUPABASE_ANON_KEY ?? null,
  };
}
