import amalanJson from "@content/amalan.v1.json";
import { z } from "zod";
import type { LevelNumber } from "../config/provisional";

/**
 * Typed loader for content/amalan.v1.json (owner content, never edited here).
 * Arabic text is passed through untouched. Transliteration and meaning stay null until the owner supplies them.
 */
export const PHASES = ["night", "fajr", "post_fajr"] as const;
export type Phase = (typeof PHASES)[number];
export type ActivityType = "prayer" | "dhikr" | "checklist" | "quran";
/** counter = tap counter with a target. checklist = single done/not-done tick. */
export type ActivityKind = "counter" | "checklist";

const activitySchema = z.object({
  activity_key: z.string(),
  type: z.enum(["prayer", "dhikr", "checklist", "quran"]),
  title: z.string(),
  target: z.number().int().positive().optional(),
  unit: z.string().nullish(),
  required: z.boolean(),
  dhikr_ref: z.string().optional(),
  quran_ref: z.unknown().optional(),
  guidance: z.string().nullish(),
  note: z.string().nullish(),
});

const dhikrSchema = z.object({
  key: z.string(),
  title: z.string(),
  arabic_text: z.string(),
  transliteration: z.string().nullable(),
  meaning_id: z.string().nullable(),
  source_classification: z.string().nullable(),
  review_status: z.string(),
});

const amalanSchema = z.object({
  content_version: z.string(),
  review_status: z.string(),
  provisional: z.boolean(),
  dhikr: z.record(z.string(), dhikrSchema),
  levels: z.array(
    z.object({
      level: z.number().int().min(1).max(3),
      title: z.string(),
      night: z.array(activitySchema),
      fajr: z.array(activitySchema),
      post_fajr: z.array(activitySchema),
    }),
  ),
});

export interface ActivityConfig {
  /** Unique per level as `${phase}:${key}`. The same key (e.g. "tahlil") exists in night and post_fajr. */
  id: string;
  key: string;
  phase: Phase;
  order: number;
  type: ActivityType;
  kind: ActivityKind;
  title: string;
  /** Counter target, rakaat for prayers, or null for plain checklists. */
  target: number | null;
  unit: string | null;
  required: boolean;
  dhikrRef: string | null;
  guidance: string | null;
}

export interface DhikrText {
  key: string;
  title: string;
  arabicText: string;
  transliteration: string | null;
  meaningId: string | null;
  sourceClassification: string | null;
  reviewStatus: string;
}

export interface LevelConfig {
  level: LevelNumber;
  title: string;
  activities: ActivityConfig[];
}

export interface AmalanContent {
  contentVersion: string;
  reviewStatus: string;
  provisional: boolean;
  levels: Record<LevelNumber, LevelConfig>;
  dhikr: Record<string, DhikrText>;
}

export function activityId(phase: Phase, key: string): string {
  return `${phase}:${key}`;
}

/** Only dhikr items are tap counters. Prayers, checklists and Qur'an reading are ticked once. */
export function kindOf(type: ActivityType): ActivityKind {
  return type === "dhikr" ? "counter" : "checklist";
}

export function parseAmalan(raw: unknown): AmalanContent {
  const data = amalanSchema.parse(raw);
  const dhikr: Record<string, DhikrText> = {};
  for (const [k, v] of Object.entries(data.dhikr)) {
    dhikr[k] = {
      key: v.key,
      title: v.title,
      arabicText: v.arabic_text,
      transliteration: v.transliteration,
      meaningId: v.meaning_id,
      sourceClassification: v.source_classification,
      reviewStatus: v.review_status,
    };
  }
  const levels = {} as Record<LevelNumber, LevelConfig>;
  for (const L of data.levels) {
    const activities: ActivityConfig[] = [];
    for (const phase of PHASES) {
      L[phase].forEach((a, i) => {
        if (a.type === "dhikr" && (!a.dhikr_ref || !dhikr[a.dhikr_ref])) {
          throw new Error(`Level ${L.level} ${phase}:${a.activity_key} has no dhikr text`);
        }
        activities.push({
          id: activityId(phase, a.activity_key),
          key: a.activity_key,
          phase,
          order: i + 1,
          type: a.type,
          kind: kindOf(a.type),
          title: a.title,
          target: a.target ?? null,
          unit: a.unit ?? null,
          required: a.required,
          dhikrRef: a.dhikr_ref ?? null,
          guidance: a.guidance ?? null,
        });
      });
    }
    const ids = new Set(activities.map((a) => a.id));
    if (ids.size !== activities.length) throw new Error(`Level ${L.level} has duplicate activity ids`);
    levels[L.level as LevelNumber] = { level: L.level as LevelNumber, title: L.title, activities };
  }
  return {
    contentVersion: data.content_version,
    reviewStatus: data.review_status,
    provisional: data.provisional,
    levels,
    dhikr,
  };
}

let cached: AmalanContent | null = null;
/** Content shipped in the repo (single source for mock repository and DB seed). */
export function getAmalan(): AmalanContent {
  cached ??= parseAmalan(amalanJson);
  return cached;
}

export function getLevelConfig(level: LevelNumber, content: AmalanContent = getAmalan()): LevelConfig {
  return content.levels[level];
}

/** Required night dhikr counts summed (PRD §9.1: 400 / 1.550 / 1.863). */
export function nightDhikrTotal(cfg: LevelConfig): number {
  return cfg.activities
    .filter((a) => a.phase === "night" && a.type === "dhikr" && a.required)
    .reduce((n, a) => n + (a.target ?? 0), 0);
}

/** Night rakaat summed (PRD §9.1: 5 / 9 / 11). */
export function nightRakaatTotal(cfg: LevelConfig): number {
  return cfg.activities
    .filter((a) => a.phase === "night" && a.type === "prayer")
    .reduce((n, a) => n + (a.target ?? 0), 0);
}
