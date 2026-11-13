/**
 * Integration cards for the dashboard and the health pages (PRD §23.1). Built from counts the database gives us and from
 * whether a secret is set. A card says "unknown" when there is nothing to judge from. It never invents a green light.
 */
export type CardState = "ok" | "warn" | "error" | "unknown" | "not_configured";

export interface IntegrationCard {
  key: "scalev" | "prayer" | "push" | "email" | "jobs";
  label: string;
  state: CardState;
  summary: string;
  facts: { label: string; value: string }[];
}

export interface RawHealth {
  jobs: Record<string, number>;
  webhooks: { by_status: Record<string, number>; last_received_at: string | null };
  entitlements_pending: number;
  prayer: {
    regions_supported: number;
    covered_today: number;
    covered_3_days: number;
    last_fetched_at: string | null;
    needs_review: number;
    by_provider: { provider: string; rows: number; last_fetched_at: string | null }[];
    sync_jobs: Record<string, number>;
  };
  push: { subscriptions_active: number; subscriptions_failing: number; deliveries_24h: Record<string, number> };
  email: { by_status: Record<string, number> };
  content_in_review: number;
}

const n = (v: unknown): number => Number(v ?? 0);
const get = (o: Record<string, number> | undefined, k: string): number => n(o?.[k]);
const when = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : "belum pernah";

export interface HealthEnv {
  vapidConfigured: boolean;
  sihatConfigured: boolean;
}

export function healthEnv(env: Record<string, string | undefined> = process.env): HealthEnv {
  return {
    vapidConfigured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    sihatConfigured: Boolean(env.SIHAT_API_TOKEN),
  };
}

export function buildCards(h: RawHealth, env: HealthEnv): IntegrationCard[] {
  const cards: IntegrationCard[] = [];

  // Scalev: judged by the webhooks we received and by orders waiting for a manual check.
  const wh = h.webhooks.by_status;
  const whTotal = Object.values(wh).reduce((s, v) => s + n(v), 0);
  const whBad = get(wh, "failed");
  const whWait = get(wh, "awaiting_order_verification");
  cards.push({
    key: "scalev",
    label: "Scalev",
    state: h.webhooks.last_received_at === null && whTotal === 0 ? "unknown" : whBad > 0 ? "error" : whWait > 0 || h.entitlements_pending > 0 ? "warn" : "ok",
    summary:
      h.webhooks.last_received_at === null && whTotal === 0
        ? "Belum ada webhook masuk. Integrasi Scalev belum tersambung."
        : whBad > 0
          ? `${whBad} webhook gagal diproses dalam 7 hari.`
          : whWait > 0
            ? `${whWait} pesanan menunggu verifikasi ke Scalev.`
            : h.entitlements_pending > 0
              ? `${h.entitlements_pending} akses menunggu persetujuan manual.`
              : "Webhook masuk dan terproses.",
    facts: [
      { label: "Webhook terakhir", value: when(h.webhooks.last_received_at) },
      { label: "Gagal (7 hari)", value: String(whBad) },
      { label: "Menunggu verifikasi", value: String(whWait) },
      { label: "Akses menunggu persetujuan", value: String(h.entitlements_pending) },
    ],
  });

  // Prayer times: coverage of the next three days for every supported region.
  const p = h.prayer;
  const noRows = p.by_provider.length === 0;
  const full = p.regions_supported > 0 && n(p.covered_3_days) >= n(p.regions_supported);
  cards.push({
    key: "prayer",
    label: "Jadwal salat",
    state: noRows ? "unknown" : n(p.covered_today) === 0 ? "error" : !full || n(p.needs_review) > 0 ? "warn" : "ok",
    summary: noRows
      ? env.sihatConfigured
        ? "Belum ada jadwal tersimpan. Sinkron belum jalan."
        : "Belum ada jadwal tersimpan dan token SIHAT belum diisi."
      : n(p.covered_today) === 0
        ? "Tidak ada jadwal untuk hari ini."
        : !full
          ? `${n(p.covered_3_days)} dari ${n(p.regions_supported)} wilayah punya jadwal 3 hari ke depan.`
          : n(p.needs_review) > 0
            ? `${n(p.needs_review)} jadwal perlu ditinjau (selisih antar sumber).`
            : "Semua wilayah punya jadwal 3 hari ke depan.",
    facts: [
      { label: "Wilayah didukung", value: String(n(p.regions_supported)) },
      { label: "Punya jadwal hari ini", value: String(n(p.covered_today)) },
      { label: "Punya jadwal 3 hari", value: String(n(p.covered_3_days)) },
      { label: "Sinkron terakhir", value: when(p.last_fetched_at) },
      { label: "Token SIHAT", value: env.sihatConfigured ? "terisi" : "belum diisi" },
    ],
  });

  // Push: needs VAPID keys, then judged by delivery results.
  const dl = h.push.deliveries_24h;
  const dlTotal = Object.values(dl).reduce((s, v) => s + n(v), 0);
  const dlBad = Object.entries(dl).filter(([k]) => /fail|error/i.test(k)).reduce((s, [, v]) => s + n(v), 0);
  cards.push({
    key: "push",
    label: "Notifikasi push",
    state: !env.vapidConfigured ? "not_configured" : dlTotal === 0 ? "unknown" : dlBad / dlTotal > 0.2 ? "error" : dlBad > 0 || n(h.push.subscriptions_failing) > 0 ? "warn" : "ok",
    summary: !env.vapidConfigured
      ? "Kunci VAPID belum diisi."
      : dlTotal === 0
        ? "Belum ada pengiriman dalam 24 jam."
        : dlBad > 0
          ? `${dlBad} dari ${dlTotal} pengiriman gagal dalam 24 jam.`
          : "Pengiriman 24 jam terakhir berhasil.",
    facts: [
      { label: "Langganan aktif", value: String(n(h.push.subscriptions_active)) },
      { label: "Langganan bermasalah", value: String(n(h.push.subscriptions_failing)) },
      { label: "Pengiriman 24 jam", value: String(dlTotal) },
      { label: "Kunci VAPID", value: env.vapidConfigured ? "terisi" : "belum diisi" },
    ],
  });

  // Email: judged by the outbox.
  const em = h.email.by_status;
  const emTotal = Object.values(em).reduce((s, v) => s + n(v), 0);
  cards.push({
    key: "email",
    label: "Email",
    state: emTotal === 0 ? "unknown" : get(em, "failed") > 0 ? "error" : get(em, "queued") > 0 || get(em, "sending") > 0 ? "warn" : "ok",
    summary:
      emTotal === 0
        ? "Belum ada email di antrean."
        : get(em, "failed") > 0
          ? `${get(em, "failed")} email gagal terkirim.`
          : get(em, "queued") > 0
            ? `${get(em, "queued")} email menunggu dikirim.`
            : "Semua email terkirim.",
    facts: [
      { label: "Menunggu", value: String(get(em, "queued")) },
      { label: "Terkirim", value: String(get(em, "sent")) },
      { label: "Gagal", value: String(get(em, "failed")) },
    ],
  });

  // Jobs.
  const j = h.jobs;
  const jTotal = Object.values(j).reduce((s, v) => s + n(v), 0);
  cards.push({
    key: "jobs",
    label: "Job latar belakang",
    state: jTotal === 0 ? "unknown" : get(j, "dead") > 0 ? "error" : get(j, "failed") > 0 ? "warn" : "ok",
    summary:
      jTotal === 0
        ? "Belum ada job. Worker belum pernah jalan."
        : get(j, "dead") > 0
          ? `${get(j, "dead")} job mati dan perlu ditangani.`
          : get(j, "failed") > 0
            ? `${get(j, "failed")} job gagal dan akan dicoba lagi.`
            : "Tidak ada job gagal.",
    facts: [
      { label: "Antre", value: String(get(j, "queued")) },
      { label: "Berjalan", value: String(get(j, "running")) },
      { label: "Gagal", value: String(get(j, "failed")) },
      { label: "Mati", value: String(get(j, "dead")) },
    ],
  });
  return cards;
}
