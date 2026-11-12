import { PROVISIONAL_SETTINGS, type DomainSettings } from "../config/provisional";
import type { LocalDate } from "../time/tz";

export interface BedtimeMessage {
  id: string;
  template: string;
}

export interface SentRecord {
  messageId: string;
  /** Local date it was sent for. */
  sentOn: LocalDate;
}

/**
 * Pick tonight's bedtime message (PRD §15.2). Avoids the last N sent. If every message was used in that
 * span, takes the one unsent the longest. Deterministic: ties go to bank order, so tests need no RNG.
 */
export function selectBedtimeMessage(
  bank: readonly BedtimeMessage[],
  history: readonly SentRecord[],
  settings: DomainSettings = PROVISIONAL_SETTINGS,
): BedtimeMessage | null {
  if (bank.length === 0) return null;
  const sorted = [...history].sort((a, b) => b.sentOn.localeCompare(a.sentOn));
  const recent = new Set(sorted.slice(0, settings.bedtimeAvoidLast).map((h) => h.messageId));
  const lastSent = new Map<string, string>();
  for (const h of sorted) if (!lastSent.has(h.messageId)) lastSent.set(h.messageId, h.sentOn);
  const fresh = bank.filter((m) => !recent.has(m.id));
  const pool = fresh.length > 0 ? fresh : bank;
  let best = pool[0]!;
  for (const m of pool) {
    const a = lastSent.get(m.id) ?? "";
    const b = lastSent.get(best.id) ?? "";
    if (a < b) best = m;
  }
  return best;
}

const ALLOWED_VARS = new Set(["nama", "level"]);

/** Fill `{nama}` and `{level}`. Any other placeholder is an error, so unreviewed variables cannot ship. */
export function renderTemplate(template: string, vars: { nama: string; level: number }): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (!ALLOWED_VARS.has(name)) throw new Error(`Template variable not allowed: {${name}}`);
    return String(vars[name as "nama" | "level"]);
  });
}
