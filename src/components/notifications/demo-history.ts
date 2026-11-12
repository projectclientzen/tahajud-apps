// DEMO DATA: bukan data asli. Riwayat notifikasi belum punya endpoint (permintaan ke orchestrator).
export interface HistoryItem {
  id: string;
  title: string;
  when: string;
  outcome: "sent" | "expired";
}

export const DEMO_HISTORY: HistoryItem[] = [
  { id: "h1", title: "Pengingat tidur", when: "Kemarin, 21.30", outcome: "sent" },
  { id: "h2", title: "Pengingat tahajud", when: "Hari ini, 03.20", outcome: "sent" },
  { id: "h3", title: "Pengingat Subuh", when: "Hari ini, 04.30", outcome: "expired" },
];
