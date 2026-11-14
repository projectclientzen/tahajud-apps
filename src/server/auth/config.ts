import { DbConfigError } from "@/server/db";
import { DEFAULT_SCRYPT, type ScryptParams } from "./password";

export interface AuthConfig {
  /** Secret mixed into every hash we store (cookie secrets, phone proof, rate limit keys). Server only. */
  pepper: string;
  /**
   * Key for the hash of the order phone (`purchase_orders.customer_phone_hash`). Separate from the pepper so rotating
   * the pepper (sessions, tokens) does not break activation. Dev and test fall back to the pepper.
   */
  phoneKey: string;
  /** Key that seals admin TOTP secrets at rest. Separate from the pepper. Dev and test fall back to the pepper. */
  mfaKey: string;
  /** Version numbers written next to rows made with these keys, so a rotation can find the rows still on the old key. */
  phoneKeyVersion: number;
  mfaKeyVersion: number;
  /** True in production unless ALLOW_INSECURE_COOKIES=true: cookies always carry Secure, whatever the proxy header says. */
  forceSecureCookies: boolean;
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

/** Production = NODE_ENV=production and not the PGlite test database. */
export function isProductionEnv(env: Record<string, string | undefined> = process.env): boolean {
  const isTestDb = env.DB_DRIVER === "pglite" && env.TAHAJUD_ALLOW_TEST_DB === "true";
  return env.NODE_ENV === "production" && !isTestDb;
}

/**
 * Where links we hand out point (admin reset links). Production must set APP_BASE_URL: behind a proxy the request origin
 * can read as http://localhost or another host, and the link carries a token (T9 F10). Returns null when production
 * has none, so the caller can refuse with a clear message. Outside production the request origin is the fallback.
 */
export function appBaseUrl(requestOrigin: string, env: Record<string, string | undefined> = process.env): string | null {
  const set = env.APP_BASE_URL?.trim();
  if (set) return set;
  return isProductionEnv(env) ? null : requestOrigin;
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

  const separateKey = (name: string): string => {
    const v = env[name] ?? "";
    if (!v) {
      if (production) throw new DbConfigError(`${name} is not set. Use at least 32 random characters, different from SESSION_PEPPER.`);
      return pepper;
    }
    if (v.length < 32) throw new DbConfigError(`${name} must be at least 32 characters.`);
    return v;
  };
  const version = (name: string): number => {
    const raw = env[name]?.trim();
    if (!raw) return 1;
    if (!/^[1-9]\d{0,3}$/.test(raw)) throw new DbConfigError(`${name} must be a whole number from 1 to 9999.`);
    return Number(raw);
  };
  const phoneKey = separateKey("PHONE_HASH_KEY");
  const mfaKey = separateKey("MFA_ENC_KEY");

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

  // Behind no trusted proxy every visitor looks like one address. Production refuses to start that way (T9 F3).
  if (production && hops < 1) {
    throw new DbConfigError(
      "TRUSTED_PROXY_HOPS must be at least 1 in production. With 0 the client address is unknown and the IP limits cannot work.",
    );
  }

  return {
    pepper,
    phoneKey,
    mfaKey,
    phoneKeyVersion: version("PHONE_HASH_KEY_VERSION"),
    mfaKeyVersion: version("MFA_ENC_KEY_VERSION"),
    forceSecureCookies: production && env.ALLOW_INSECURE_COOKIES?.trim().toLowerCase() !== "true",
    allowedOrigins: (env.APP_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    trustedProxyHops: hops,
    scrypt: DEFAULT_SCRYPT,
  };
}
