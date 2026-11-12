/** "Baru saja", "3 hari lalu". Plain buckets, no library. */
export function formatRelative(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 2) return "Baru saja";
  if (min < 60) return `${min} menit lalu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}
