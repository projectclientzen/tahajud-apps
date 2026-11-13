import { one } from "@/server/db";
import type { Services } from "@/server/jobs/services";

/** Empties payload_encrypted of events older than the retention (90 days, PROVISIONAL setting). Returns how many. */
export async function purgePayloads(svc: Services): Promise<{ purged: number }> {
  const purged = await svc.db.asService((q) =>
    one<number>(q, "app_private.scalev_purge_payloads($1::timestamptz)", [svc.now().toISOString()]),
  );
  return { purged };
}
