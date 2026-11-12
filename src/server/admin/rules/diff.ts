/** Field by field difference between two content snapshots, for the review screen. Pure, no IO. */
export interface FieldChange {
  /** Path a person can read, e.g. "Level 2, malam: target". */
  label: string;
  before: string;
  after: string;
}

interface ConfigRow {
  config_id: string;
  level_number: number;
  phase: string;
  sequence_order: number;
  required_for_completion: boolean;
  target_count: number | null;
  title_override: string | null;
}
type Snap = Record<string, unknown>;

const FIELD_LABELS: Record<string, string> = {
  title: "Judul",
  description: "Deskripsi",
  counter_unit: "Satuan hitung",
  source_reference: "Referensi",
  category: "Kategori",
  body: "Isi pesan",
};
export const PHASE_LABELS: Record<string, string> = { night: "malam", fajr: "Subuh", post_fajr: "setelah Subuh" };
const CONFIG_LABELS: Record<keyof Omit<ConfigRow, "config_id" | "level_number">, string> = {
  phase: "fase",
  sequence_order: "urutan",
  required_for_completion: "wajib",
  target_count: "target",
  title_override: "judul di level ini",
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "kosong";
  if (typeof v === "boolean") return v ? "wajib" : "opsional";
  if (v === "night" || v === "fajr" || v === "post_fajr") return PHASE_LABELS[v]!;
  return String(v);
};

export function diffSnapshots(before: Snap | null, after: Snap | null): FieldChange[] {
  if (!before || !after) return [];
  const out: FieldChange[] = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    if (!(key in before) && !(key in after)) continue;
    if (before[key] !== after[key]) out.push({ label: FIELD_LABELS[key]!, before: show(before[key]), after: show(after[key]) });
  }
  const b = (before.configs as ConfigRow[] | undefined) ?? [];
  const a = (after.configs as ConfigRow[] | undefined) ?? [];
  for (const row of a) {
    const old = b.find((x) => x.config_id === row.config_id);
    if (!old) continue;
    for (const f of Object.keys(CONFIG_LABELS) as (keyof typeof CONFIG_LABELS)[]) {
      if (old[f] !== row[f]) {
        out.push({
          label: `Level ${row.level_number}, ${PHASE_LABELS[old.phase] ?? old.phase}: ${CONFIG_LABELS[f]}`,
          before: show(old[f]),
          after: show(row[f]),
        });
      }
    }
  }
  return out;
}
