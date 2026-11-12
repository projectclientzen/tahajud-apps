/** Offline mutation queue item (PRD §21.2). Stored in IndexedDB database `tahajud-<userId>`, store `queue`. */
export type OperationType = "counter_delta" | "counter_set_zero" | "checklist_set";
/** Synced items are deleted. Rejected ones stay until the user has seen them. */
export type SyncStatus = "pending" | "syncing" | "rejected";

export interface CounterDeltaPayload {
  delta: number;
  client_recorded_at: string;
}
export interface CounterSetZeroPayload {
  client_recorded_at: string;
}
export interface ChecklistPayload {
  checked: boolean;
  /** Version the user saw when they ticked it. */
  version: number;
}
export type QueuePayload = CounterDeltaPayload | CounterSetZeroPayload | ChecklistPayload;

export interface QueueItem {
  /** Assigned by IndexedDB, gives the order. */
  seq: number;
  operation_id: string;
  user_id: string;
  /** API id of the session activity. */
  entity_id: string;
  operation_type: OperationType;
  payload: QueuePayload;
  client_timestamp: string;
  sync_status: SyncStatus;
  attempt_count: number;
  /** Epoch ms. Null means due now. */
  next_attempt_at: number | null;
  /** Error code or message from the last try. For rejected items it is the reason shown to the user. */
  last_error: string | null;
}

export type NewQueueItem = Pick<QueueItem, "operation_id" | "entity_id" | "operation_type" | "payload"> & {
  client_timestamp?: string;
};

export type SendOutcome =
  | { kind: "synced" }
  /** The server refused for good (session locked, validation). Kept and shown, never dropped quietly. */
  | { kind: "rejected"; code: string }
  /** Network or server trouble. Stays pending and retries with backoff. */
  | { kind: "retry"; error: string };

export interface QueueSender {
  /** One outcome per item, same order. */
  send(items: QueueItem[]): Promise<SendOutcome[]>;
}

export interface QueueSnapshot {
  /** Waiting or being sent. */
  pending: number;
  /** Refused by the server, not yet dismissed. */
  rejected: number;
  lastSyncedAt: number | null;
  flushing: boolean;
  /** Error code of the last send that had to be retried (for example OFFLINE). Null after a clean send. */
  lastError: string | null;
}

export type FlushResult = { status: "offline" } | { status: "done"; synced: number; rejected: number; retry: number };
