import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "@/data/contracts";
import { one, type Db } from "@/server/db";
import type { AuthConfig } from "./config";
import { hmacHex, newOtp } from "./crypto";

/** Proof of a mailbox. Everything after it (devices, cookies, access) is the same for every provider. */
export interface OtpProvider {
  readonly name: "local" | "supabase";
  /** Sends a code. Throws RATE_LIMITED when the email asked too often. Never says whether the email has access. */
  request(email: string, now: Date): Promise<void>;
  /** The user id when the code is right, null for every failure (wrong, expired, used, too many tries). */
  verify(email: string, code: string, now: Date): Promise<{ userId: string } | null>;
}

const rateLimited = (reason: string, retryAfter: number) =>
  new ApiError("RATE_LIMITED", "Terlalu sering meminta kode. Coba lagi sebentar.", {
    reason,
    retry_after_seconds: retryAfter,
  });

/**
 * Local provider: the server makes the code, stores only its hash, and "emails" it by writing a file. For tests and
 * local runs with PGlite. The config loader refuses it anywhere else (AUTH_PROVIDER=local needs three opt-in flags).
 */
export function createLocalProvider(db: Db, cfg: AuthConfig): OtpProvider {
  const emailHash = (email: string) => hmacHex(cfg.pepper, "email", email);
  return {
    name: "local",
    async request(email, now) {
      const code = newOtp();
      const eh = emailHash(email);
      const res = await db.asService((q) =>
        one<{ ok: boolean; reason?: string; retry_after_seconds?: number }>(
          q,
          "app_private.otp_issue($1, $2, $3::timestamptz)",
          [eh, hmacHex(cfg.pepper, `code:${eh}`, code), now.toISOString()],
        ),
      );
      if (!res.ok) throw rateLimited(res.reason ?? "limit", res.retry_after_seconds ?? 60);
      if (!cfg.mailDir) return; // nothing to deliver to; tests read the code from the database state they control
      mkdirSync(cfg.mailDir, { recursive: true });
      const file = join(cfg.mailDir, `${email.replace(/[^a-z0-9@._+-]/gi, "_")}.json`);
      writeFileSync(file, JSON.stringify({ to: email, code, sentAt: now.toISOString() }));
    },
    async verify(email, code, now) {
      const eh = emailHash(email);
      return db.asService(async (q) => {
        const ok = await one<boolean>(q, "app_private.otp_verify($1, $2, $3::timestamptz)", [
          eh,
          hmacHex(cfg.pepper, `code:${eh}`, code),
          now.toISOString(),
        ]);
        if (!ok) return null;
        // Test-only function created by the PGlite adapter. It does not exist on a real database.
        const userId = await one<string>(q, "app_private.local_auth_user($1)", [email]);
        return { userId };
      });
    },
  };
}

/**
 * Supabase Auth (GoTrue) over its REST API. UNVERIFIED against a real project: no credentials in this build.
 * Sending and checking the code are GoTrue's job. We add the limits GoTrue does not give us (cooldown, hourly, tries).
 */
export function createSupabaseProvider(db: Db, cfg: AuthConfig, fetchImpl: typeof fetch = fetch): OtpProvider {
  const headers = { apikey: cfg.supabaseAnonKey!, "Content-Type": "application/json" };
  const hit = (key: string, now: Date, windowSeconds: number, limit: number) =>
    db.asService((q) =>
      one<{ allowed: boolean; retry_after_seconds: number }>(q, "app_private.rate_hit($1, $2::timestamptz, $3, $4)", [
        key,
        now.toISOString(),
        windowSeconds,
        limit,
      ]),
    );
  return {
    name: "supabase",
    async request(email, now) {
      const eh = hmacHex(cfg.pepper, "email", email);
      const cd = await hit(`otp:cd:${eh}`, now, 60, 1);
      if (!cd.allowed) throw rateLimited("cooldown", cd.retry_after_seconds);
      const hr = await hit(`otp:email:${eh}`, now, 3600, 5);
      if (!hr.allowed) throw rateLimited("hourly_limit", hr.retry_after_seconds);
      const res = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/otp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email, create_user: true }),
      });
      // The answer must not depend on the email, so a refusal from GoTrue is reported as an outage, not as "unknown email".
      if (!res.ok) throw new ApiError("NOT_AVAILABLE", "Pengiriman kode sedang bermasalah. Coba lagi sebentar.");
    },
    async verify(email, code, now) {
      const eh = hmacHex(cfg.pepper, "email", email);
      const tries = await hit(`otp:verify:${eh}`, now, 600, 10);
      if (!tries.allowed) return null;
      const res = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify({ type: "email", email, token: code }),
      });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as { user?: { id?: string } } | null;
      return body?.user?.id ? { userId: body.user.id } : null;
    },
  };
}

export function createProvider(db: Db, cfg: AuthConfig): OtpProvider {
  return cfg.provider === "local" ? createLocalProvider(db, cfg) : createSupabaseProvider(db, cfg);
}
