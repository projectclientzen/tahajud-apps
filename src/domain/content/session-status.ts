/** Session status as stored and computed by the server (PRD v1.2 §11.3). */
export const SESSION_STATUSES = ["completed", "partial", "missed", "excused", "upcoming"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** UI labels (PRD v1.2 §7.7). Supportive wording, no "berhasil/gagal". */
export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  completed: "Tuntas",
  partial: "Sebagian",
  missed: "Terlewat",
  excused: "Berhalangan",
  upcoming: "Belum waktunya",
};

/** Active-session UI state that has no stored status. Owner decision 12 Nov 2026: label "Sedang berjalan" (PRD v1.2.3 §7.7). */
export const IN_PROGRESS_LABEL = "Sedang berjalan";
export type DisplayStatus = SessionStatus | "in_progress";
export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  ...SESSION_STATUS_LABEL,
  in_progress: IN_PROGRESS_LABEL,
};
