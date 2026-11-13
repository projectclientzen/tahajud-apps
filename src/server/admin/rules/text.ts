/**
 * Text rules for what the CMS accepts. The database enforces the same rules again (admin_text, admin_template_text).
 * Owner content stays owner content: no Arabic from a form, no HTML, only two template variables (PRD §15.2, SEC-10).
 */
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const CONTROL = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const hasArabic = (s: string): boolean => ARABIC.test(s);

export const TEMPLATE_VARIABLES = ["nama", "level"] as const;
export type TemplateTextIssue = "empty" | "too_long" | "arabic_not_allowed" | "control_characters" | "html_not_allowed" | "unknown_variable";

export function checkTemplateText(raw: string, max: number): TemplateTextIssue | null {
  const s = raw.trim();
  if (!s) return "empty";
  if ([...s].length > max) return "too_long";
  if (ARABIC.test(s)) return "arabic_not_allowed";
  if (CONTROL.test(s)) return "control_characters";
  if (/[<>]/.test(s)) return "html_not_allowed";
  if (s.replace(/\{(nama|level)\}/g, "").match(/[{}]/)) return "unknown_variable";
  return null;
}

export const TEMPLATE_LIMITS = { title: 60, body: 240 } as const;

export const TEMPLATE_CATEGORIES: readonly { value: string; label: string }[] = [
  { value: "bedtime_persiapan_tidur", label: "Bedtime: persiapan tidur" },
  { value: "bedtime_refleksi_malam", label: "Bedtime: refleksi malam" },
  { value: "bedtime_motivasi", label: "Bedtime: motivasi" },
  { value: "bedtime_istiqomah", label: "Bedtime: istiqomah" },
  { value: "bedtime_menjaga_energi", label: "Bedtime: menjaga energi" },
  { value: "bedtime_doa_harapan", label: "Bedtime: doa dan harapan" },
  { value: "tahajud", label: "Tahajud" },
  { value: "fajr", label: "Subuh" },
  { value: "alkahfi", label: "Al-Kahfi" },
  { value: "achievement", label: "Pencapaian" },
];

/** Sample values for the phone preview. The preview says so: these are not real users. */
export const PREVIEW_SAMPLE = { nama: "Fulan", level: "2" } as const;

export function renderTemplate(text: string, vars: Record<string, string> = PREVIEW_SAMPLE): string {
  return text.replace(/\{(nama|level)\}/g, (_, k: string) => vars[k] ?? "");
}
