import { ApiError } from "@/data/contracts";
import type { DataLayer } from "@/data/repositories";
import type {
  CounterDeltaPayload,
  ChecklistPayload,
  KhatamMarkPayload,
  KhatamSlotPayload,
  QueueItem,
  QueueSender,
  SendOutcome,
} from "./types";

/** Errors worth retrying. Everything else is a refusal the user must see. */
// INTERNAL_ERROR / FORBIDDEN_ORIGIN are retried: an unexpected 500 or a proxy origin glitch must never drop a user note.
const TRANSIENT = new Set([
  "OFFLINE",
  "NOT_AVAILABLE",
  "RATE_LIMITED",
  "UNAUTHENTICATED",
  "ENTITLEMENT_INACTIVE",
  "INTERNAL_ERROR",
  "FORBIDDEN_ORIGIN",
]);

const MAX_BATCH = 50;

function fromError(e: unknown): SendOutcome {
  if (e instanceof ApiError) {
    return TRANSIENT.has(e.code) ? { kind: "retry", error: e.code } : { kind: "rejected", code: e.code };
  }
  return { kind: "retry", error: e instanceof Error ? e.message : "NETWORK" };
}

/** Sends queue items through a DataLayer (mock now, HTTP in S5). Needs no knowledge of either. */
export function createLayerSender(
  layer: Pick<DataLayer, "session"> & Partial<Pick<DataLayer, "khatam">>,
): QueueSender {
  async function checklist(it: QueueItem): Promise<SendOutcome> {
    const p = it.payload as ChecklistPayload;
    let version = p.version;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await layer.session.setChecklist(it.entity_id, { checked: p.checked, version });
        return { kind: "synced" };
      } catch (e) {
        if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
          // Server value wins. Apply the user's tick again only if it still changes something.
          const server = (e.details as { server?: { checked: boolean; version: number } } | undefined)?.server;
          if (!server) return { kind: "retry", error: "VERSION_CONFLICT" };
          if (server.checked === p.checked) return { kind: "synced" };
          version = server.version;
          continue;
        }
        return fromError(e);
      }
    }
    return { kind: "retry", error: "VERSION_CONFLICT" };
  }

  /** Khatam ops are sets, so there is nothing to merge: one call per item, in order. */
  async function khatam(it: QueueItem): Promise<SendOutcome> {
    if (!layer.khatam) return { kind: "retry", error: "NOT_AVAILABLE" };
    try {
      if (it.operation_type === "khatam_slot_set") await layer.khatam.setSlot(it.payload as KhatamSlotPayload);
      else await layer.khatam.markPosition(it.payload as KhatamMarkPayload);
      return { kind: "synced" };
    } catch (e) {
      return fromError(e);
    }
  }

  async function counterBatch(batch: QueueItem[]): Promise<SendOutcome[]> {
    const entity = batch[0]!.entity_id;
    try {
      const res = await layer.session.applyCounterOperations(entity, {
        operations: batch.map((it) =>
          it.operation_type === "counter_set_zero"
            ? {
                kind: "set_zero" as const,
                operation_id: it.operation_id,
                client_recorded_at: (it.payload as CounterDeltaPayload).client_recorded_at,
              }
            : {
                kind: "delta" as const,
                operation_id: it.operation_id,
                delta: (it.payload as CounterDeltaPayload).delta,
                client_recorded_at: (it.payload as CounterDeltaPayload).client_recorded_at,
              },
        ),
      });
      return batch.map((it) => {
        const r = res.results.find((x) => x.operation_id === it.operation_id);
        if (!r) return { kind: "retry", error: "NO_RESULT" };
        if (r.status === "rejected") return { kind: "rejected", code: r.error_code ?? "REJECTED" };
        return { kind: "synced" }; // accepted or duplicate: the server has it exactly once
      });
    } catch (e) {
      return batch.map(() => fromError(e));
    }
  }

  return {
    async send(items) {
      const out: SendOutcome[] = [];
      let i = 0;
      while (i < items.length) {
        const it = items[i]!;
        if (it.operation_type === "checklist_set") {
          out.push(await checklist(it));
          i++;
          continue;
        }
        if (it.operation_type === "khatam_slot_set" || it.operation_type === "khatam_mark") {
          out.push(await khatam(it));
          i++;
          continue;
        }
        let j = i;
        while (
          j < items.length &&
          j - i < MAX_BATCH &&
          items[j]!.operation_type !== "checklist_set" &&
          items[j]!.operation_type !== "khatam_slot_set" &&
          items[j]!.operation_type !== "khatam_mark" &&
          items[j]!.entity_id === it.entity_id
        )
          j++;
        out.push(...(await counterBatch(items.slice(i, j))));
        i = j;
      }
      return out;
    },
  };
}
