import { z } from "zod";
import { normalizeEmail } from "@/domain/auth/email";
import { jsonResponse, readBody } from "@/server/api/http";
import { UUID_RE, one } from "@/server/db";
import { shapeAggregates, type RawAggregates } from "./aggregates";
import { AdminError } from "./errors";
import { buildCards, healthEnv, type RawHealth } from "./health";
import { adminRoute, type AdminCtx, type AdminHandler, type Access } from "./route";
import { ADMIN_ROLES, auditTypesFor, can, navFor, rolesFor, type Permission } from "./rules/permissions";
import { TEMPLATE_CATEGORIES } from "./rules/text";
import { pgArray, rpc } from "./rpc";
import { beginMfa, confirmMfa, endAdminSession, verifyMfa } from "./session";

// ---------- request bodies. Strict: an unknown key is an error, not ignored. ----------
const code = z.object({ code: z.string().regex(/^\d{6}$/, "6 digit") }).strict();
const text = (max: number) => z.string().max(max);
const draftBody = z.object({ patch: z.record(z.string(), z.unknown()), note: text(300).optional() }).strict();
const noteBody = z.object({ note: text(300).optional() }).strict();
const templateCreateBody = z.object({ category: text(40), title: text(200), body: text(1000) }).strict();
const activeBody = z.object({ active: z.boolean(), reason: text(500) }).strict();
const reasonBody = z.object({ reason: text(500) }).strict();
const approveBody = z.object({ reason: text(500), approval_reference: text(200) }).strict();
const transferBody = z.object({ to_email: text(254), reason: text(500) }).strict();
const statusBody = z.object({ to: z.enum(["suspended", "active", "revoked"]), reason: text(500) }).strict();
const grantBody = z.object({ email: text(254), role: z.enum(ADMIN_ROLES), reason: text(500) }).strict();
const revokeBody = z.object({ user_id: z.string(), role: z.enum(ADMIN_ROLES), reason: text(500) }).strict();
const resetBody = z.object({ user_id: z.string(), reason: text(500) }).strict();

const uuid = (v: string | undefined): string => {
  if (!v || !UUID_RE.test(v)) throw new AdminError("NOT_FOUND");
  return v;
};
const intParam = (v: string | null, dflt: number, max: number): number => {
  const n = v === null ? dflt : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new AdminError("VALIDATION_ERROR", undefined, { issues: [{ path: "query", message: "angka tidak valid" }] });
  return n;
};

const body = <T>(c: AdminCtx, schema: z.ZodType<T>) => readBody(c.req, schema);

interface Def {
  method: "GET" | "POST" | "PUT";
  path: string;
  access: Access;
  perm?: Permission | null;
  handler: AdminHandler;
}

// ---------- the table ----------
export const ROUTES: Def[] = [
  // --- sign-in steps (no admin session yet) ---
  {
    method: "GET",
    path: "me",
    access: "public",
    handler: async (c) => {
      const s = c.state;
      if (s.state === "anonymous") return { state: "anonymous" };
      if (s.state === "not_admin") return { state: "not_admin", email: s.email };
      if (s.state === "ok") {
        return {
          state: "ok",
          email: s.email,
          roles: s.admin.roles,
          expires_at: s.admin.expiresAt,
          nav: navFor(s.admin.roles),
          can: Object.fromEntries((["roles.manage", "content.write", "templates.write", "support.write", "jobs.requeue"] as const).map((p) => [p, can(s.admin.roles, p)])),
        };
      }
      return { state: s.state, email: s.email, roles: s.roles };
    },
  },
  {
    method: "POST",
    path: "mfa/begin",
    access: "user",
    handler: async (c) => beginMfa(c.d, c.user),
  },
  {
    method: "POST",
    path: "mfa/confirm",
    access: "user",
    handler: async (c) => {
      c.cookies.push(await confirmMfa(c.d, c.user, (await body(c, code)).code, c.caller));
      return { ok: true };
    },
  },
  {
    method: "POST",
    path: "mfa/verify",
    access: "user",
    handler: async (c) => {
      c.cookies.push(await verifyMfa(c.d, c.user, (await body(c, code)).code, c.caller));
      return { ok: true };
    },
  },
  {
    method: "POST",
    path: "logout",
    access: "public",
    handler: async (c) => {
      // Signed out of the admin only. The user sign-in cookie stays, so the person is still signed in to the app.
      if ("user" in c.state) c.cookies.push(await endAdminSession(c.d, c.req, c.state.user.userId, c.caller.secure));
      return { ok: true };
    },
  },

  // --- dashboard ---
  {
    method: "GET",
    path: "dashboard",
    access: "admin",
    perm: null,
    handler: async (c) => {
      const roles = c.admin.roles;
      const out: Record<string, unknown> = { roles };
      if (can(roles, "dashboard.aggregates")) {
        out.aggregates = shapeAggregates(await rpc<RawAggregates>(c, "dashboard.aggregates", "admin_aggregates", [], [], { now: true }));
      }
      if (can(roles, "health.read")) {
        const h = await rpc<RawHealth>(c, "health.read", "admin_health", [], [], { now: true });
        out.integrations = buildCards(h, healthEnv());
        out.queues = { ...(out.queues as object), entitlements_pending: Number(h.entitlements_pending) };
      }
      if (can(roles, "content.read")) {
        const h = await rpc<RawHealth>(c, "content.read", "admin_health", [], [], { now: true });
        out.queues = { ...(out.queues as object), content_in_review: Number(h.content_in_review) };
      }
      return out;
    },
  },

  // --- levels, amalan, dhikr, Qur'an metadata (content.read) ---
  { method: "GET", path: "levels", access: "admin", perm: "content.read", handler: (c) => rpc(c, "content.read", "admin_levels_overview", [], []) },
  { method: "GET", path: "quran-content", access: "admin", perm: "content.read", handler: (c) => rpc(c, "content.read", "admin_quran_overview", [], []) },
  {
    method: "GET",
    path: "activities",
    access: "admin",
    perm: "content.read",
    handler: async (c) => {
      const group = c.url.searchParams.get("group");
      if (group !== "activities" && group !== "dhikr") throw new AdminError("VALIDATION_ERROR", undefined, { issues: [{ path: "group", message: "activities atau dhikr" }] });
      const types = group === "dhikr" ? ["dhikr"] : ["prayer", "checklist", "quran"];
      return rpc(c, "content.read", "admin_activity_list", ["text[]"], [pgArray(types)]);
    },
  },
  {
    method: "GET",
    path: "activities/:id",
    access: "admin",
    perm: "content.read",
    handler: (c) => rpc(c, "content.read", "admin_activity_detail", ["uuid"], [uuid(c.params.id)]),
  },
  {
    method: "PUT",
    path: "activities/:id/draft",
    access: "admin",
    perm: "content.write",
    handler: async (c) => {
      const b = await body(c, draftBody);
      return rpc(c, "content.write", "admin_draft_save", ["text", "uuid", "jsonb", "text"], ["activity", uuid(c.params.id), JSON.stringify(b.patch), b.note ?? null], { now: true });
    },
  },
  {
    method: "GET",
    path: "content-versions/:id",
    access: "admin",
    perm: null,
    handler: async (c) => {
      // A version of a template needs the template permission, a version of an activity the content one.
      const id = uuid(c.params.id);
      const type = await c.d.db.asService((q) => one<string | null>(q, "(select content_type from public.content_versions where id = $1::uuid)", [id]));
      if (!type) throw new AdminError("NOT_FOUND");
      const perm: Permission = type === "notification_template" ? "templates.read" : "content.read";
      if (!can(c.admin.roles, perm)) throw new AdminError("FORBIDDEN");
      return rpc(c, perm, "admin_version_get", ["uuid"], [id]);
    },
  },
  ...(["submit", "approve", "return", "publish"] as const).map(
    (step): Def => ({
      method: "POST",
      path: `content-versions/:id/${step}`,
      access: "admin",
      perm: null,
      handler: async (c) => {
        const id = uuid(c.params.id);
        const type = await c.d.db.asService((q) => one<string | null>(q, "(select content_type from public.content_versions where id = $1::uuid)", [id]));
        if (!type) throw new AdminError("NOT_FOUND");
        const perm: Permission = type === "notification_template" ? "templates.write" : "content.write";
        if (!can(c.admin.roles, perm)) throw new AdminError("FORBIDDEN");
        if (step === "submit" || step === "publish") return rpc(c, perm, `admin_version_${step}`, ["uuid"], [id], { now: true });
        const b = await body(c, noteBody);
        return rpc(c, perm, `admin_version_${step}`, ["uuid", "text"], [id, b.note ?? null], { now: true });
      },
    }),
  ),

  // --- notification templates ---
  {
    method: "GET",
    path: "templates",
    access: "admin",
    perm: "templates.read",
    handler: async (c) => ({ templates: await rpc(c, "templates.read", "admin_template_list", [], []), categories: TEMPLATE_CATEGORIES }),
  },
  {
    method: "POST",
    path: "templates",
    access: "admin",
    perm: "templates.write",
    handler: async (c) => {
      const b = await body(c, templateCreateBody);
      return rpc(c, "templates.write", "admin_template_create", ["text", "text", "text"], [b.category, b.title, b.body], { now: true });
    },
  },
  { method: "GET", path: "templates/:id", access: "admin", perm: "templates.read", handler: (c) => rpc(c, "templates.read", "admin_template_detail", ["uuid"], [uuid(c.params.id)]) },
  {
    method: "PUT",
    path: "templates/:id/draft",
    access: "admin",
    perm: "templates.write",
    handler: async (c) => {
      const b = await body(c, draftBody);
      return rpc(c, "templates.write", "admin_draft_save", ["text", "uuid", "jsonb", "text"], ["notification_template", uuid(c.params.id), JSON.stringify(b.patch), b.note ?? null], { now: true });
    },
  },
  {
    method: "POST",
    path: "templates/:id/active",
    access: "admin",
    perm: "templates.write",
    handler: async (c) => {
      const b = await body(c, activeBody);
      return rpc(c, "templates.write", "admin_template_set_active", ["uuid", "boolean", "text"], [uuid(c.params.id), b.active, b.reason], { now: true });
    },
  },
  {
    method: "GET",
    path: "notifications/summary",
    access: "admin",
    perm: "templates.read",
    // Delivery history, aggregated. Same raw counts and same 20 user rule as the dashboard.
    handler: async (c) => {
      const raw = await rpc<RawAggregates>(c, "templates.read", "admin_aggregates", [], [], { now: true });
      return { k: shapeAggregates(raw).k, notifications_7_days: shapeAggregates(raw).notifications_7_days };
    },
  },

  // --- support: search, orders, entitlements ---
  {
    method: "GET",
    path: "search",
    access: "admin",
    perm: "support.read",
    handler: (c) => rpc(c, "support.read", "admin_search", ["text"], [c.url.searchParams.get("q") ?? ""]),
  },
  { method: "GET", path: "users/:id", access: "admin", perm: "support.read", handler: (c) => rpc(c, "support.read", "admin_user_detail", ["uuid"], [uuid(c.params.id)]) },
  {
    method: "GET",
    path: "orders",
    access: "admin",
    perm: "support.read",
    handler: (c) =>
      rpc(c, "support.read", "admin_orders_list", ["text", "int", "int"], [c.url.searchParams.get("filter") ?? "all", intParam(c.url.searchParams.get("limit"), 25, 100), intParam(c.url.searchParams.get("offset"), 0, 100000)]),
  },
  {
    method: "GET",
    path: "entitlements",
    access: "admin",
    perm: "support.read",
    handler: (c) =>
      rpc(c, "support.read", "admin_entitlements_list", ["text", "int", "int"], [c.url.searchParams.get("status") ?? "all", intParam(c.url.searchParams.get("limit"), 25, 100), intParam(c.url.searchParams.get("offset"), 0, 100000)]),
  },
  {
    method: "POST",
    path: "entitlements/:id/approve",
    access: "admin",
    perm: "support.write",
    handler: async (c) => {
      const b = await body(c, approveBody);
      return rpc(c, "support.write", "admin_entitlement_approve", ["uuid", "text", "text"], [uuid(c.params.id), b.reason, b.approval_reference], { now: true });
    },
  },
  {
    method: "POST",
    path: "entitlements/:id/transfer",
    access: "admin",
    perm: "support.write",
    handler: async (c) => {
      const b = await body(c, transferBody);
      return rpc(c, "support.write", "admin_entitlement_transfer", ["uuid", "text", "text"], [uuid(c.params.id), normalizeEmail(b.to_email), b.reason], { now: true });
    },
  },
  {
    method: "POST",
    path: "entitlements/:id/status",
    access: "admin",
    perm: "support.write",
    handler: async (c) => {
      const b = await body(c, statusBody);
      return rpc(c, "support.write", "admin_entitlement_set_status", ["uuid", "text", "text"], [uuid(c.params.id), b.to, b.reason], { now: true });
    },
  },
  {
    method: "POST",
    path: "entitlements/:id/resend-email",
    access: "admin",
    perm: "support.write",
    handler: (c) => rpc(c, "support.write", "admin_resend_access_email", ["uuid"], [uuid(c.params.id)], { now: true }),
  },

  // --- health and jobs ---
  {
    method: "GET",
    path: "health",
    access: "admin",
    perm: "health.read",
    handler: async (c) => {
      const h = await rpc<RawHealth>(c, "health.read", "admin_health", [], [], { now: true });
      return { cards: buildCards(h, healthEnv()), prayer: h.prayer };
    },
  },
  { method: "GET", path: "jobs", access: "admin", perm: "health.read", handler: (c) => rpc(c, "health.read", "admin_jobs_overview", [], [], { now: true }) },
  {
    method: "POST",
    path: "jobs/:id/requeue",
    access: "admin",
    perm: "jobs.requeue",
    handler: async (c) => {
      const b = await body(c, reasonBody);
      return rpc(c, "jobs.requeue", "admin_job_requeue", ["uuid", "text"], [uuid(c.params.id), b.reason], { now: true });
    },
  },

  // --- audit log (read only: there is no write route) ---
  {
    method: "GET",
    path: "audit-logs",
    access: "admin",
    perm: "audit.read",
    handler: async (c) => {
      const types = auditTypesFor(c.admin.roles);
      const before = c.url.searchParams.get("before");
      if (before !== null && Number.isNaN(Date.parse(before))) throw new AdminError("VALIDATION_ERROR", undefined, { issues: [{ path: "before", message: "waktu tidak valid" }] });
      const entityId = c.url.searchParams.get("entity_id");
      const rows = await rpc(c, "audit.read", "admin_audit_list", ["text[]", "timestamptz", "int", "text"], [
        types === null ? null : pgArray(types),
        before,
        intParam(c.url.searchParams.get("limit"), 50, 100),
        entityId,
      ]);
      return { entries: rows };
    },
  },

  // --- roles (super_admin only) ---
  { method: "GET", path: "roles", access: "admin", perm: "roles.manage", handler: (c) => rpc(c, "roles.manage", "admin_roles_list", [], []) },
  {
    method: "POST",
    path: "roles/grant",
    access: "admin",
    perm: "roles.manage",
    handler: async (c) => {
      const b = await body(c, grantBody);
      const target = await rpc<string>(c, "roles.manage", "admin_find_user", ["text"], [normalizeEmail(b.email)]);
      return rpc(c, "roles.manage", "admin_role_grant", ["uuid", "text", "text"], [target, b.role, b.reason], { now: true });
    },
  },
  {
    method: "POST",
    path: "roles/revoke",
    access: "admin",
    perm: "roles.manage",
    handler: async (c) => {
      const b = await body(c, revokeBody);
      return rpc(c, "roles.manage", "admin_role_revoke", ["uuid", "text", "text"], [uuid(b.user_id), b.role, b.reason], { now: true });
    },
  },
  {
    method: "POST",
    path: "roles/reset-mfa",
    access: "admin",
    perm: "roles.manage",
    handler: async (c) => {
      const b = await body(c, resetBody);
      await rpc(c, "roles.manage", "admin_mfa_reset", ["uuid", "text"], [uuid(b.user_id), b.reason], { now: true });
      return { ok: true };
    },
  },
];

// ---------- tiny router: one catch-all route file dispatches here ----------
interface Compiled {
  def: Def;
  segs: string[];
  run: (req: Request, params: Record<string, string>) => Promise<Response>;
}
let compiled: Compiled[] | null = null;
function table(): Compiled[] {
  compiled ??= ROUTES.map((def) => ({
    def,
    segs: def.path.split("/"),
    run: adminRoute({ access: def.access, perm: def.perm, handler: def.handler }),
  }));
  return compiled;
}

/** The roles the table gives each permission, exported so a test can compare the table to the SQL checks. */
export const permissionRoles = rolesFor;

export async function dispatchAdmin(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/v1\/admin\/?/, "").split("/").filter(Boolean);
  for (const r of table()) {
    if (r.segs.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < r.segs.length; i++) {
      const s = r.segs[i]!;
      if (s.startsWith(":")) params[s.slice(1)] = decodeURIComponent(parts[i]!);
      else if (s !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (r.def.method !== req.method) continue;
    return r.run(req, params);
  }
  return jsonResponse(new AdminError("NOT_FOUND", "Endpoint admin tidak ditemukan.").toJSON(), 404);
}
