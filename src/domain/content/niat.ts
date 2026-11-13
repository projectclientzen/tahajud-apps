import niatJson from "@content/niat.v1.json";
import { z } from "zod";

/**
 * Typed loader for content/niat.v1.json: the intention (niat) text for each prayer step of the night session.
 * The owner fills Arabic, Latin and translation. Nothing here writes, trims, normalises or guesses any of it.
 * A field that is null (or empty) means "not available yet" and the UI says so.
 */
const entrySchema = z.object({
  activity_key: z.string(),
  title: z.string(),
  arabic: z.string().nullable(),
  latin: z.string().nullable(),
  translation: z.string().nullable(),
});

const fileSchema = z.object({
  content_version: z.string(),
  review_status: z.string(),
  approved_by: z.string().nullable(),
  niat: z.array(entrySchema),
});

export interface NiatEntry {
  activityKey: string;
  title: string;
  arabic: string | null;
  latin: string | null;
  translation: string | null;
}

export interface NiatContent {
  contentVersion: string;
  reviewStatus: string;
  entries: NiatEntry[];
}

export function parseNiat(raw: unknown): NiatContent {
  const f = fileSchema.parse(raw);
  return {
    contentVersion: f.content_version,
    reviewStatus: f.review_status,
    entries: f.niat.map((e) => ({
      activityKey: e.activity_key,
      title: e.title,
      arabic: e.arabic,
      latin: e.latin,
      translation: e.translation,
    })),
  };
}

let cached: NiatContent | null = null;
export function getNiat(): NiatContent {
  cached ??= parseNiat(niatJson);
  return cached;
}

/** The entry for a session activity key (for example "salat_tahajud"), or null when the step has no niat entry. */
export function niatFor(content: NiatContent, activityKey: string): NiatEntry | null {
  return content.entries.find((e) => e.activityKey === activityKey) ?? null;
}

const filled = (v: string | null): v is string => v !== null && v.trim() !== "";

/** What the sheet shows. Any filled Arabic or Latin line makes it "available"; each line is shown only when filled. */
export interface NiatView {
  state: "available" | "unavailable";
  title: string;
  arabic: string | null;
  latin: string | null;
  translation: string | null;
  /** True when the text shown is not marked `published` by the owner. The sheet then shows a review badge. */
  needsReview: boolean;
}

export function niatView(content: NiatContent, entry: NiatEntry): NiatView {
  const available = filled(entry.arabic) || filled(entry.latin);
  return {
    state: available ? "available" : "unavailable",
    title: entry.title,
    arabic: filled(entry.arabic) ? entry.arabic : null,
    latin: filled(entry.latin) ? entry.latin : null,
    translation: available && filled(entry.translation) ? entry.translation : null,
    needsReview: available && content.reviewStatus !== "published",
  };
}
