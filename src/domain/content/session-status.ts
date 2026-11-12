/** Session status as stored and computed by the server (PRD v1.2 §11.3). */
export const SESSION_STATUSES = ["completed", "partial", "missed", "excused", "upcoming"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** UI labels (PRD v1.2 §7.7). Supportive wording, no "berhasil/gagal". */
export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  completed: "Tuntas",
  partial: "Sebagian",
  missed: "Terlewat",
  excused: "Berhalangan",
  upcoming: "Akan datang",
};
