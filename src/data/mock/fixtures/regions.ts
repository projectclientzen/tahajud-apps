// DEMO DATA: bukan data asli
import type { Region } from "../../contracts";

/** Sample regions only. The real list comes from the prayer-time provider (S7). */
export const DEMO_REGIONS: Region[] = [
  { id: "demo-jakarta", name: "Contoh: Jakarta (WIB)", timezone: "Asia/Jakarta" },
  { id: "demo-makassar", name: "Contoh: Makassar (WITA)", timezone: "Asia/Makassar" },
  { id: "demo-jayapura", name: "Contoh: Jayapura (WIT)", timezone: "Asia/Jayapura" },
];

export const DEMO_SCHEDULE_NOTE = "Jadwal contoh, bukan dari Kemenag";

/** Fixed local times used for every date in demo mode. */
export const DEMO_FAJR_LOCAL = "04:30";
export const DEMO_MAGHRIB_LOCAL = "17:55";
