export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type NotificationType = "bedtime" | "tahajud" | "fajr" | "alkahfi" | "achievement";

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  /** Relative app URL opened on click. */
  url: string;
  /** Collapses repeated notifications of the same kind on the device. */
  tag?: string;
}

export type SendOutcome =
  | { status: "sent"; statusCode: number; attempts: number }
  /** 404/410: the subscription is gone. Caller sets is_active = false. */
  | { status: "deactivate"; statusCode: number; attempts: number }
  /** Retries exhausted or a non-retryable error. Caller increments failure_count. */
  | { status: "failed"; statusCode: number | null; attempts: number; error: string };

/** What the dispatcher needs from a sender. WebPushSender is the real one; tests pass a fake. */
export interface PushSender {
  /** `ttlSeconds` overrides the sender default for this one message (T6: the notification type's expiry). */
  send(sub: PushSubscriptionRecord, payload: NotificationPayload, opts?: { ttlSeconds?: number }): Promise<SendOutcome>;
}

export class PushConfigError extends Error {
  readonly code = "PUSH_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "PushConfigError";
  }
}
