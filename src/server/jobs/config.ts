/** What the job runner reads from the environment. Nothing here has a default that sends anything real. */
export interface JobsConfig {
  /** Shared secret for POST /api/internal/cron. Null = the endpoint refuses every request. */
  cronSecret: string | null;
  /**
   * Placeholder bedtime messages (DEMO) may be used. Needs NOTIF_ALLOW_DEMO_BANK=true AND NODE_ENV other than
   * "production". Off by default, so a production deployment can never send them.
   */
  allowDemoBank: boolean;
  /** Which provider fills prayer_times. Null = the prayer_sync job fails with a clear message. */
  prayerProvider: "equran" | null;
}

export const MIN_CRON_SECRET_LENGTH = 32;

export function loadJobsConfig(env: Record<string, string | undefined> = process.env): JobsConfig {
  const secret = env.CRON_SECRET?.trim();
  const provider = env.PRAYER_PROVIDER?.trim().toLowerCase();
  return {
    cronSecret: secret && secret.length >= MIN_CRON_SECRET_LENGTH ? secret : null,
    allowDemoBank: env.NOTIF_ALLOW_DEMO_BANK === "true" && env.NODE_ENV !== "production",
    prayerProvider: provider === "equran" ? "equran" : null,
  };
}
