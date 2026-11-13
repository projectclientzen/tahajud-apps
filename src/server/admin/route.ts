import { callerOf, type AuthedUser, type Caller } from "@/server/auth/service";
import { getDeps, type Deps } from "@/server/api/deps";
import { jsonResponse, originAllowed } from "@/server/api/http";
import { AdminError, ADMIN_HTTP_STATUS, toAdminError } from "./errors";
import { can, type Permission } from "./rules/permissions";
import { resolveAdminState, type AdminSession, type AdminState } from "./session";

export interface AdminCtx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  d: Deps;
  caller: Caller;
  state: AdminState;
  /** Only set when `access` is not "user". */
  admin: AdminSession;
  /** Set when the request carries a valid sign-in cookie. */
  user: AuthedUser;
  cookies: string[];
}

export type AdminHandler = (c: AdminCtx) => Promise<unknown | Response>;

/**
 * public no sign-in needed: the handler reads `state` and answers (GET /admin/me).
 * user   a signed-in account is enough (the steps before an admin session exists: me, MFA, logout).
 * admin  a full admin session: sign-in, a role, finished MFA, an unexpired 8 hour session.
 */
export type Access = "public" | "user" | "admin";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function adminErrorResponse(e: AdminError, cookies: string[] = []): Response {
  const res = jsonResponse(e.toJSON(), ADMIN_HTTP_STATUS[e.code] ?? 500, cookies);
  const retry = (e.details as { retry_after_seconds?: unknown } | undefined)?.retry_after_seconds;
  if (e.code === "RATE_LIMITED" && typeof retry === "number") res.headers.set("Retry-After", String(retry));
  return res;
}

/**
 * One pipeline for every admin endpoint: Origin check on mutations, sign-in, role, MFA, permission, handler, one error shape,
 * `Cache-Control: private, no-store` on every answer (SECURITY-05). A refusal never says which step failed beyond what the caller needs.
 */
export function adminRoute(opts: { access: Access; perm?: Permission | null; handler: AdminHandler }) {
  return async (req: Request, params: Record<string, string> = {}): Promise<Response> => {
    const url = new URL(req.url);
    const cookies: string[] = [];
    try {
      const d = await getDeps();
      if (!SAFE.has(req.method) && !originAllowed(req, d.cfg.allowedOrigins)) throw new AdminError("FORBIDDEN_ORIGIN");
      const state = await resolveAdminState(d, req);
      if (state.state === "anonymous" && opts.access !== "public") throw new AdminError("UNAUTHENTICATED");
      if (opts.access === "admin") {
        if (state.state === "not_admin") throw new AdminError("FORBIDDEN");
        if (state.state === "mfa_setup_required") throw new AdminError("MFA_SETUP_REQUIRED");
        if (state.state === "mfa_required") throw new AdminError("ADMIN_MFA_REQUIRED");
        if (state.state !== "ok") throw new AdminError("UNAUTHENTICATED");
        if (opts.perm && !can(state.admin.roles, opts.perm)) throw new AdminError("FORBIDDEN");
      }
      const out = await opts.handler({
        req,
        url,
        params,
        d,
        caller: callerOf(req),
        state,
        admin: state.state === "ok" ? state.admin : (undefined as unknown as AdminSession),
        user: "user" in state ? state.user : (undefined as unknown as AuthedUser),
        cookies,
      });
      if (out instanceof Response) {
        for (const c of cookies) out.headers.append("Set-Cookie", c);
        return out;
      }
      return jsonResponse(out, 200, cookies);
    } catch (e) {
      return adminErrorResponse(toAdminError(e, url.pathname), cookies);
    }
  };
}
