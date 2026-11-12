/**
 * Who may do what in /admin (PRD §18.2). One table, read by the API pipeline and by the screens.
 * The database re-checks that the actor really holds one of the roles passed to it, so this table is not the only gate.
 */
export const ADMIN_ROLES = ["super_admin", "content_admin", "support_admin", "reporting_admin"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

const SUPER: AdminRole = "super_admin";

export const PERMISSIONS = {
  /** Aggregates on the dashboard (always passed through the 20 user rule). */
  "dashboard.aggregates": [SUPER, "reporting_admin"],
  /** Integration health on the dashboard and its detail pages. */
  "health.read": [SUPER, "support_admin"],
  "jobs.requeue": [SUPER, "support_admin"],
  "content.read": [SUPER, "content_admin"],
  /** Draft, submit, approve, return, publish. Four eyes is enforced per version, not per role. */
  "content.write": [SUPER, "content_admin"],
  "templates.read": [SUPER, "content_admin"],
  "templates.write": [SUPER, "content_admin"],
  "support.read": [SUPER, "support_admin"],
  "support.write": [SUPER, "support_admin"],
  "audit.read": [SUPER, "support_admin", "content_admin"],
  "roles.manage": [SUPER],
} as const satisfies Record<string, readonly AdminRole[]>;
export type Permission = keyof typeof PERMISSIONS;

export const can = (roles: readonly string[], perm: Permission): boolean =>
  (PERMISSIONS[perm] as readonly string[]).some((r) => roles.includes(r));

/** Roles that satisfy a permission, as the database wants them. */
export const rolesFor = (perm: Permission): string[] => [...PERMISSIONS[perm]];

/**
 * Entity types each role may read in the audit log. null = everything (super_admin only).
 * Support and content see their own area, not role changes or MFA events.
 */
export function auditTypesFor(roles: readonly string[]): string[] | null {
  if (roles.includes(SUPER)) return null;
  const out = new Set<string>();
  if (roles.includes("support_admin")) ["entitlement", "job"].forEach((t) => out.add(t));
  if (roles.includes("content_admin")) ["activity", "notification_template"].forEach((t) => out.add(t));
  return [...out];
}

export interface NavItem {
  href: string;
  label: string;
  perm: Permission | null;
}

/** Route list from PRD §5.3. `perm: null` means every admin role. */
export const ADMIN_NAV: readonly NavItem[] = [
  { href: "/admin", label: "Ringkasan", perm: null },
  { href: "/admin/users", label: "Pengguna", perm: "support.read" },
  { href: "/admin/purchases", label: "Pembelian", perm: "support.read" },
  { href: "/admin/entitlements", label: "Akses", perm: "support.read" },
  { href: "/admin/levels", label: "Level", perm: "content.read" },
  { href: "/admin/activities", label: "Amalan", perm: "content.read" },
  { href: "/admin/dhikr", label: "Dzikir", perm: "content.read" },
  { href: "/admin/quran-content", label: "Konten Qur'an", perm: "content.read" },
  { href: "/admin/notifications", label: "Notifikasi", perm: "templates.read" },
  { href: "/admin/prayer-times", label: "Jadwal salat", perm: "health.read" },
  { href: "/admin/jobs", label: "Job", perm: "health.read" },
  { href: "/admin/audit-logs", label: "Audit", perm: "audit.read" },
];

export const navFor = (roles: readonly string[]): NavItem[] =>
  ADMIN_NAV.filter((n) => n.perm === null || can(roles, n.perm));
