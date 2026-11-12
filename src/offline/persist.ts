export type PersistResult = "granted" | "already" | "denied" | "unsupported";

/**
 * Asks the browser not to evict this site's data (PRD §21.1, BUG-12). Call once during onboarding.
 * Chrome decides on its own, Safari and Firefox may show a prompt. "denied" is normal: keep syncing often.
 */
export async function requestPersistentStorage(
  storage: Pick<StorageManager, "persist" | "persisted"> | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.storage,
): Promise<PersistResult> {
  if (!storage?.persist || !storage.persisted) return "unsupported";
  if (await storage.persisted()) return "already";
  return (await storage.persist()) ? "granted" : "denied";
}
