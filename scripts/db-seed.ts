import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROVISIONAL_AUTH, PROVISIONAL_SETTINGS } from "../src/domain/config/provisional";

/**
 * Builds supabase/seed.sql from content/amalan.v1.json and the provisional settings.
 * Run `pnpm db:seed` to rewrite the file, `pnpm db:seed --check` to fail when it is out of date.
 * The owner's Arabic text is copied byte for byte, nothing here reformats or corrects it.
 */
const ROOT = join(import.meta.dirname, "..");
export const CONTENT_FILE = join(ROOT, "content", "amalan.v1.json");
export const SEED_OUT = join(ROOT, "supabase", "seed.sql");

interface RawActivity {
  activity_key: string;
  type: "prayer" | "dhikr" | "checklist" | "quran";
  title: string;
  target?: number;
  unit?: string | null;
  required: boolean;
  dhikr_ref?: string;
  quran_ref?: unknown;
  guidance?: string | null;
  note?: string | null;
}
interface RawDhikr {
  title: string;
  arabic_text: string;
  transliteration: string | null;
  meaning_id: string | null;
  source_classification: string | null;
}
export interface RawContent {
  content_version: string;
  review_status: string;
  dhikr: Record<string, RawDhikr>;
  levels: { level: number; title: string; night: RawActivity[]; fajr: RawActivity[]; post_fajr: RawActivity[] }[];
}

const PHASES = ["night", "fajr", "post_fajr"] as const;
const KNOWN_KEYS = new Set([
  "activity_key",
  "type",
  "title",
  "target",
  "unit",
  "required",
  "dhikr_ref",
  "quran_ref",
  "guidance",
  "note",
]);

/** Dollar-quoted literal with a tag that cannot appear in the text, so no escaping touches the content. */
export function lit(v: string | null | undefined): string {
  if (v === null || v === undefined) return "null";
  let n = 0;
  let tag = "s";
  while (v.includes(`$${tag}`)) tag = `s${++n}`;
  return `$${tag}$${v}$${tag}$`;
}
const num = (v: number | null | undefined): string => (v === null || v === undefined ? "null" : String(v));
const json = (v: unknown): string => `${lit(JSON.stringify(v))}::jsonb`;

export function buildSeedSql(content: RawContent, sourceSha256: string): string {
  // One definition per activity key. Levels must agree on everything except the title, so nothing is dropped silently.
  const defs = new Map<string, RawActivity>();
  const overrides: string[] = [];
  const rows: string[] = [];
  for (const L of content.levels) {
    for (const phase of PHASES) {
      L[phase].forEach((a, i) => {
        for (const k of Object.keys(a))
          if (!KNOWN_KEYS.has(k)) throw new Error(`Unknown field "${k}" on ${a.activity_key}`);
        if (a.type === "dhikr" && !(a.dhikr_ref && content.dhikr[a.dhikr_ref])) {
          throw new Error(`No dhikr text for ${a.activity_key}`);
        }
        const first = defs.get(a.activity_key);
        if (!first) defs.set(a.activity_key, a);
        else if (first.type !== a.type || first.dhikr_ref !== a.dhikr_ref || first.unit !== a.unit) {
          throw new Error(`Activity ${a.activity_key} differs between levels in more than its title`);
        }
        const titleOverride = first && first.title !== a.title ? a.title : null;
        if (titleOverride) overrides.push(`${a.activity_key}@L${L.level}`);
        rows.push(
          `(${L.level}, ${lit(a.activity_key)}, ${lit(phase)}, ${i + 1}, ${a.required}, ${num(a.target)}, ${lit(titleOverride)})`,
        );
      });
    }
  }

  const defRows = [...defs.values()].map((a) => {
    const d = a.dhikr_ref ? content.dhikr[a.dhikr_ref]! : null;
    const description = [a.guidance, a.note].filter(Boolean).join("\n") || null;
    return `(${lit(a.activity_key)}, ${lit(a.type)}, ${lit(a.title)}, ${lit(d?.arabic_text)}, ${lit(d?.transliteration)}, ${lit(d?.meaning_id)}, ${lit(description)}, ${lit(a.guidance)}, ${lit(a.unit)}, ${lit(d?.source_classification ?? "unverified")}, ${lit(content.review_status)}, 1, ${a.quran_ref ? json(a.quran_ref) : "null"})`;
  });

  const s = PROVISIONAL_SETTINGS;
  const levelRows = content.levels.map((L) => {
    const cfg = s.levels[L.level as 1 | 2 | 3];
    return `(${L.level}, ${lit(L.title)}, ${cfg.requiredSuccessfulNights}, ${cfg.suggestedPeriodNights}, ${cfg.estimatedDurationMinutes}, true)`;
  });

  // Provisional until the owner approves them (PRD §30.2). Re-running the seed never overwrites an admin's change.
  const settings: [string, unknown, boolean][] = [
    [
      "cutoff_local_time",
      `${String(s.cutoff.hour).padStart(2, "0")}:${String(s.cutoff.minute).padStart(2, "0")}`,
      true,
    ],
    ["correction_window_hours", s.correctionWindowHours, true],
    ["wake_buffer_minutes", s.wakeBufferMinutes, true],
    ["min_sleep_hours", s.minSleepHours, true],
    ["excuse_max_days_per_action", s.excuseMaxDaysPerAction, true],
    ["notification_expiry_minutes", s.notificationExpiryMinutes, true],
    ["bedtime_avoid_last", s.bedtimeAvoidLast, true],
    ["bedtime_bank_minimum", s.bedtimeBankMinimum, true],
    ["al_kahfi_fallback_maghrib", s.alKahfiFallbackMaghrib, true],
    ["max_active_devices", PROVISIONAL_AUTH.maxActiveDevices, true],
    ["session_days", PROVISIONAL_AUTH.sessionDays, true],
  ];
  const settingRows = settings.map(([k, v, p]) => `(${lit(k)}, ${json(v)}, ${p})`);

  return `-- GENERATED by scripts/db-seed.ts. Do not edit by hand. Run \`pnpm db:seed\` to rebuild.
-- Source: content/amalan.v1.json v${content.content_version} (sha256 ${sourceSha256}).
-- Arabic text is copied unchanged. Transliteration and meaning stay null until the owner supplies them.
-- Titles that differ per level: ${overrides.join(", ") || "none"}.

insert into public.levels (level_number, title, required_successful_nights, suggested_period_nights, estimated_duration_minutes, provisional)
values ${levelRows.join(",\n       ")}
on conflict (level_number) do update set title = excluded.title;

insert into public.activity_definitions
  (activity_key, activity_type, title, arabic_text, transliteration, meaning, description, guidance, counter_unit, source_classification, review_status, published_version, quran_ref)
values ${defRows.join(",\n       ")}
on conflict (activity_key) do update set
  activity_type = excluded.activity_type, title = excluded.title, arabic_text = excluded.arabic_text,
  transliteration = excluded.transliteration, meaning = excluded.meaning, description = excluded.description,
  guidance = excluded.guidance, counter_unit = excluded.counter_unit, source_classification = excluded.source_classification,
  review_status = excluded.review_status, published_version = excluded.published_version, quran_ref = excluded.quran_ref;

insert into public.level_activity_config
  (level_id, activity_definition_id, sequence_order, phase, required_for_completion, target_count, title_override, config_version, provisional)
select l.id, d.id, v.seq, v.phase, v.req, v.target, v.title_override, 1, true
from (values ${rows.join(",\n       ")}) as v(level_number, activity_key, phase, seq, req, target, title_override)
join public.levels l on l.level_number = v.level_number
join public.activity_definitions d on d.activity_key = v.activity_key
on conflict (level_id, activity_definition_id, phase) do update set
  sequence_order = excluded.sequence_order, required_for_completion = excluded.required_for_completion,
  target_count = excluded.target_count, title_override = excluded.title_override;

insert into public.app_settings (key, value, provisional)
values ${settingRows.join(",\n       ")}
on conflict (key) do nothing;

-- DEMO DATA: sample regions, not an official list. The real list comes from the prayer-time provider.
insert into public.regions (province_name, city_name, provider_region_code, timezone)
values ('DEMO', 'Jakarta (contoh)', 'DEMO-JKT', 'Asia/Jakarta'),
       ('DEMO', 'Makassar (contoh)', 'DEMO-MKS', 'Asia/Makassar'),
       ('DEMO', 'Jayapura (contoh)', 'DEMO-DJJ', 'Asia/Jayapura')
on conflict (provider_region_code) do nothing;
`;
}

export function generateSeed(): string {
  const raw = readFileSync(CONTENT_FILE);
  const sha = createHash("sha256").update(raw).digest("hex");
  return buildSeedSql(JSON.parse(raw.toString("utf8")) as RawContent, sha);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const sql = generateSeed();
  if (process.argv.includes("--check")) {
    if (readFileSync(SEED_OUT, "utf8") !== sql) {
      console.error("supabase/seed.sql is out of date. Run `pnpm db:seed`.");
      process.exit(1);
    }
    console.log("supabase/seed.sql is up to date.");
  } else {
    writeFileSync(SEED_OUT, sql);
    console.log(`Wrote ${SEED_OUT}`);
  }
}
