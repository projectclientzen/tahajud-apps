import { DbConfigError } from "@/server/db";
import { DEFAULT_SCRYPT, type ScryptParams } from "./password";

export interface AuthConfig {
  /** Secret mixed into every hash we store (cookie secrets, phone proof, rate limit keys). Server only. */
  pepper: string;
  /** Extra origins allowed to send mutating requests, besides the one the request itself targets. */
  allowedOrigins: string[];
  /**
   * Proxies we trust between the internet and this server. The client address is the entry that many places from the
   * end of X-Forwarded-For. 0 means no trusted proxy: the header is ignored and every caller shares one IP bucket.
   */
  trustedProxyHops: number;
  /** Settings for new password hashes. Existing hashes keep the settings stored inside them. */
  scrypt: ScryptParams;
}

const DEV_PEPPER = "local-test-pepper-not-for-production-0123456789";

/**
 * Reads the auth settings from the environment. Fails with a plain message when something is missing, so the
 * server never starts half configured. No default can open a production deployment.
 */
export function loadAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  const isTestDb = env.DB_DRIVER === "pglite" && env.TAHAJUD_ALLOW_TEST_DB === "true";
  const production = env.NODE_ENV === "production" && !isTestDb;

  // Activation proves ownership by email + order phone. Turning the phone check off would remove the proof.
  const phoneRequired = env.ACTIVATION_PHONE_REQUIRED?.trim().toLowerCase();
  if (phoneRequired !== undefined && phoneRequired !== "" && phoneRequired !== "true") {
    throw new DbConfigError("ACTIVATION_PHONE_REQUIRED cannot be turned off. Remove it or set it to true.");
  }

  let pepper = env.SESSION_PEPPER ?? "";
  if (!pepper) {
    if (isTestDb) pepper = DEV_PEPPER;
    else throw new DbConfigError("SESSION_PEPPER is not set. Use at least 32 random characters.");
  } else if (pepper.length < 32) {
    throw new DbConfigError("SESSION_PEPPER must be at least 32 characters.");
  }

  let hops = 1;
  const rawHops = env.TRUSTED_PROXY_HOPS?.trim();
  if (rawHops) {
    if (!/^[0-5]$/.test(rawHops)) throw new DbConfigError("TRUSTED_PROXY_HOPS must be a whole number from 0 to 5.");
    hops = Number(rawHops);
  } else if (production) {
    throw new DbConfigError(
      "TRUSTED_PROXY_HOPS is not set. Use the number of reverse proxies in front of the app (1 for Caddy or nginx).",
    );
  }

  return {
    pepper,
    allowedOrigins: (env.APP_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    trustedProxyHops: hops,
    scrypt: DEFAULT_SCRYPT,
  };
}
