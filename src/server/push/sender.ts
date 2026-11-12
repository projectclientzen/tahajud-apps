import type { Agent } from "node:https";
import { WebPushError, sendNotification, setVapidDetails } from "web-push";
import { buildPayload } from "./payload";
import { PushConfigError, type NotificationPayload, type PushSubscriptionRecord, type SendOutcome } from "./types";

export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export function vapidFromEnv(env: Record<string, string | undefined> = process.env): VapidConfig {
  const missing = ["VAPID_SUBJECT", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"].filter((k) => !env[k]?.trim());
  if (missing.length > 0) {
    throw new PushConfigError(
      `Missing env: ${missing.join(", ")}. Generate keys with "npx web-push generate-vapid-keys".`,
    );
  }
  return {
    subject: env.VAPID_SUBJECT!.trim(),
    publicKey: env.VAPID_PUBLIC_KEY!.trim(),
    privateKey: env.VAPID_PRIVATE_KEY!.trim(),
  };
}

export interface SenderOptions {
  vapid: VapidConfig;
  /** Total tries including the first. Default 3. */
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Test hook: custom TLS agent. */
  agent?: Agent;
  /** Seconds the push service keeps the message. Default 900 (15 min), within every expiry in PRD 15.1. */
  ttlSeconds?: number;
  timeoutMs?: number;
}

const RETRYABLE = (code: number) => code === 429 || code >= 500;

export class WebPushSender {
  private readonly o: Required<Omit<SenderOptions, "agent">> & { agent?: Agent };

  constructor(opts: SenderOptions) {
    this.o = {
      maxAttempts: 3,
      baseDelayMs: 1000,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ttlSeconds: 900,
      timeoutMs: 10000,
      ...opts,
    };
    // Validates key format early.
    setVapidDetails(opts.vapid.subject, opts.vapid.publicKey, opts.vapid.privateKey);
  }

  async send(sub: PushSubscriptionRecord, payload: NotificationPayload): Promise<SendOutcome> {
    const body = buildPayload(payload);
    let lastCode: number | null = null;
    let lastError = "";

    for (let attempt = 1; attempt <= this.o.maxAttempts; attempt++) {
      try {
        const res = await sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          {
            vapidDetails: {
              subject: this.o.vapid.subject,
              publicKey: this.o.vapid.publicKey,
              privateKey: this.o.vapid.privateKey,
            },
            TTL: this.o.ttlSeconds,
            timeout: this.o.timeoutMs,
            ...(this.o.agent ? { agent: this.o.agent } : {}),
          },
        );
        return { status: "sent", statusCode: res.statusCode, attempts: attempt };
      } catch (err) {
        const code = err instanceof WebPushError ? err.statusCode : null;
        lastCode = code;
        lastError = err instanceof Error ? err.message : String(err);
        if (code === 404 || code === 410) return { status: "deactivate", statusCode: code, attempts: attempt };
        const retry = code === null || RETRYABLE(code);
        if (!retry) return { status: "failed", statusCode: code, attempts: attempt, error: lastError };
        if (attempt < this.o.maxAttempts) await this.o.sleep(this.o.baseDelayMs * 2 ** (attempt - 1));
      }
    }
    return { status: "failed", statusCode: lastCode, attempts: this.o.maxAttempts, error: lastError };
  }
}
