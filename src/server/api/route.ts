import { ApiError } from "@/data/contracts";
import { callerOf, resolveSession, type AuthedUser, type Caller, type SessionState } from "@/server/auth/service";
import { getDeps, type Deps } from "./deps";
import { errorResponse, jsonResponse, originAllowed, toApiError } from "./http";

export interface RouteContext {
  req: Request;
  url: URL;
  params: Record<string, string>;
  d: Deps;
  caller: Caller;
  session: SessionState;
  /** Set for `auth: "user"` routes. */
  user: AuthedUser;
  /** Cookies to send back. */
  cookies: string[];
}

export type Handler = (c: RouteContext) => Promise<unknown | Response>;
/** The second argument Next passes to a route handler. `string[]` is what a catch-all segment gives. */
export interface NextCtx {
  params: Promise<Record<string, string | string[]>>;
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export interface RouteOptions {
  /** `user` needs a valid sign-in cookie. `public` does not (login, /me). Entitlement is checked in SQL on every private read and write. */
  auth: "user" | "public";
  /** Success status. Defaults to 200. */
  status?: number;
  handler: Handler;
}

/**
 * One pipeline for every endpoint: Origin check on mutations, sign-in check, handler, one error shape,
 * `Cache-Control: private, no-store` on every answer.
 */
export function route(opts: RouteOptions): (req: Request, ctx: NextCtx) => Promise<Response> {
  return async (req, nextCtx) => {
    const url = new URL(req.url);
    const cookies: string[] = [];
    try {
      const d = await getDeps();
      if (!SAFE.has(req.method) && !originAllowed(req, d.cfg.allowedOrigins)) {
        // No code in the shared list fits "wrong origin" better than a sign-in problem.
        throw new ApiError("UNAUTHENTICATED", "Permintaan ini tidak berasal dari aplikasi.", { reason: "origin" });
      }
      const caller = callerOf(req);
      const session = await resolveSession(d, req);
      if (opts.auth === "user" && session.state !== "ok") {
        throw new ApiError("UNAUTHENTICATED", "Masuk dulu untuk melanjutkan.");
      }
      const params: Record<string, string> = {};
      // Next gives a promise of the dynamic segments. Routes without any may resolve to nothing at all.
      for (const [k, v] of Object.entries((await nextCtx?.params) ?? {}))
        params[k] = Array.isArray(v) ? v.join("/") : v;
      const out = await opts.handler({
        req,
        url,
        params,
        d,
        caller,
        session,
        user: session.state === "ok" ? session.user : (undefined as unknown as AuthedUser),
        cookies,
      });
      if (out instanceof Response) {
        for (const c of cookies) out.headers.append("Set-Cookie", c);
        return out;
      }
      return jsonResponse(out, opts.status ?? 200, cookies);
    } catch (e) {
      return errorResponse(toApiError(e, url.pathname), cookies);
    }
  };
}
