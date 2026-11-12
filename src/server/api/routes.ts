import { z } from "zod";
import { isLocalDate } from "@/domain/time/tz";
import {
  ApiError,
  accessSchema,
  calendarResponseSchema,
  checklistUpdateRequestSchema,
  completePendingLoginRequestSchema,
  counterOperationsRequestSchema,
  counterResultSchema,
  excuseRequestSchema,
  excuseResponseSchema,
  levelProgressResponseSchema,
  locationUpdateSchema,
  nightSessionSchema,
  notificationPreferencesSchema,
  preferencesUpdateSchema,
  profileSchema,
  profileUpdateSchema,
  quranProgressListSchema,
  quranProgressSchema,
  quranProgressUpdateSchema,
  regionSchema,
  requestOtpRequestSchema,
  sessionHistoryResponseSchema,
  sessionSummarySchema,
  activityStatSchema,
  verifyOtpRequestSchema,
  type NightSession,
} from "@/data/contracts";
import {
  authSessionBody,
  completePendingLogin,
  listDevices,
  logout,
  refreshedCookie,
  requestOtp,
  revokeDevice,
  verifyOtp,
} from "@/server/auth/service";
import { clearSessionCookie } from "@/server/auth/cookie";
import { one, UUID_RE, type Queryable } from "@/server/db";
import { getDashboard, getPrayerTime, getReport, getWakePlan } from "./compose";
import { jsonResponse, readBody } from "./http";
import { route } from "./route";

const NOT_FOUND = () => new ApiError("NOT_FOUND", "Data tidak ditemukan.");
const uuidParam = (v: string | undefined): string => {
  if (!v || !UUID_RE.test(v)) throw NOT_FOUND();
  return v;
};
const dateParam = (v: string | null | undefined, name: string): string | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  if (!isLocalDate(v))
    throw new ApiError("VALIDATION_ERROR", `Tanggal ${name} belum benar.`, { reason: "invalid_date" });
  return v;
};

// The sign-in screens also tell us which device this is. Not part of the shared request schemas, so added here.
const deviceLabel = z.string().max(120).optional();
const verifyBody = verifyOtpRequestSchema.extend({ device_label: deviceLabel });
const pendingBody = completePendingLoginRequestSchema.extend({ device_label: deviceLabel });

const sessionById = async (q: Queryable, id: string): Promise<NightSession> =>
  nightSessionSchema.parse(await one(q, "public.get_night_session($1::uuid)", [id]));

export const h = {
  // ---------- auth ----------
  requestOtp: route({
    auth: "public",
    handler: async (c) => {
      const body = await readBody(c.req, requestOtpRequestSchema);
      return requestOtp(c.d, body.email, c.caller);
    },
  }),

  verifyOtp: route({
    auth: "public",
    handler: async (c) => {
      const body = await readBody(c.req, verifyBody);
      const r = await verifyOtp(c.d, { email: body.email, code: body.code, deviceLabel: body.device_label }, c.caller);
      if (r.kind === "ok") c.cookies.push(r.cookie);
      return r.body;
    },
  }),

  completePendingLogin: route({
    auth: "public",
    handler: async (c) => {
      const body = await readBody(c.req, pendingBody);
      const r = await completePendingLogin(
        c.d,
        { pendingToken: body.pending_token, revokeDeviceId: body.revoke_device_id, deviceLabel: body.device_label },
        c.caller,
      );
      c.cookies.push(r.cookie);
      return r.body;
    },
  }),

  /** GET /me, auth part. Always 200: "not signed in" is an answer, with the reason. */
  me: route({
    auth: "public",
    handler: async (c) => {
      if (c.session.state === "ok") {
        const cookie = refreshedCookie(c.d, c.req, c.session.user, c.caller.secure);
        if (cookie) c.cookies.push(cookie);
      }
      return authSessionBody(c.session);
    },
  }),

  logout: route({
    auth: "public",
    handler: async (c) => {
      if (c.session.state === "ok") c.cookies.push(await logout(c.d, c.session.user, c.caller.secure));
      else c.cookies.push(clearSessionCookie(c.caller.secure));
      return { ok: true };
    },
  }),

  devices: route({
    auth: "user",
    handler: async (c) => ({ devices: await listDevices(c.d, c.user) }),
  }),

  revokeDevice: route({
    auth: "user",
    status: 204,
    handler: async (c) => {
      await revokeDevice(c.d, c.user, c.params.id ?? "");
      return null;
    },
  }),

  access: route({
    auth: "user",
    handler: async (c) => accessSchema.parse(await c.d.db.asUser(c.user.userId, (q) => one(q, "public.get_access()"))),
  }),

  // ---------- profile and onboarding ----------
  getProfile: route({
    auth: "user",
    handler: (c) =>
      c.d.db.asUser(c.user.userId, async (q) => profileSchema.parse(await one(q, "public.get_profile()"))),
  }),

  patchProfile: route({
    auth: "user",
    handler: async (c) => {
      const body = await readBody(c.req, profileUpdateSchema);
      return c.d.db.asUser(c.user.userId, async (q) =>
        profileSchema.parse(await one(q, "public.update_profile($1)", [body.display_name])),
      );
    },
  }),

  putPreferences: route({
    auth: "user",
    handler: async (c) => {
      const body = await readBody(c.req, preferencesUpdateSchema);
      return c.d.db.asUser(c.user.userId, async (q) =>
        profileSchema.parse(
          await one(q, "public.update_preferences($1, $2::int, $3::int)", [
            body.theme_pref ?? null,
            body.quran_font_size ?? null,
            body.dhikr_font_size ?? null,
          ]),
        ),
      );
    },
  }),

  putLocation: route({
    auth: "user",
    handler: async (c) => {
      const body = await readBody(c.req, locationUpdateSchema);
      if (body.mode === "region" && !UUID_RE.test(body.region_id))
        throw new ApiError("NOT_FOUND", "Wilayah tidak ditemukan.");
      return c.d.db.asUser(c.user.userId, async (q) => {
        await q.query("select public.set_location($1, $2::uuid, $3, $4, $5)", [
          body.mode,
          body.mode === "region" ? body.region_id : null,
          body.mode === "manual" ? body.timezone : null,
          body.mode === "manual" ? body.fajr_time : null,
          body.mode === "manual" ? (body.maghrib_time ?? null) : null,
        ]);
        return getPrayerTime(q, c.d.now());
      });
    },
  }),

  completeOnboarding: route({
    auth: "user",
    handler: (c) =>
      c.d.db.asUser(c.user.userId, async (q) => profileSchema.parse(await one(q, "public.complete_onboarding()"))),
  }),

  // ---------- prayer ----------
  regions: route({
    auth: "user",
    handler: (c) =>
      c.d.db.asUser(c.user.userId, async (q) => z.array(regionSchema).parse(await one(q, "public.list_regions()"))),
  }),
  nextFajr: route({
    auth: "user",
    handler: (c) => c.d.db.asUser(c.user.userId, (q) => getPrayerTime(q, c.d.now())),
  }),
  wakePlan: route({
    auth: "user",
    handler: (c) => c.d.db.asUser(c.user.userId, (q) => getWakePlan(q, c.d.now())),
  }),

  // ---------- worship ----------
  currentLevel: route({
    auth: "user",
    handler: (c) => c.d.db.asUser(c.user.userId, (q) => one(q, "public.get_current_level()")),
  }),
  levelProgress: route({
    auth: "user",
    handler: (c) =>
      c.d.db.asUser(c.user.userId, async (q) =>
        levelProgressResponseSchema.parse(await one(q, "public.get_level_progress()")),
      ),
  }),
  activeSession: route({
    auth: "user",
    handler: (c) =>
      c.d.db.asUser(c.user.userId, async (q) => {
        const s = await one<unknown>(q, "public.get_active_session()");
        return s === null ? null : nightSessionSchema.parse(s);
      }),
  }),
  ensureSession: route({
    auth: "user",
    handler: (c) =>
      c.d.db.asUser(c.user.userId, async (q) => {
        const r = await one<{ session_id: string }>(q, "public.ensure_active_session()");
        return sessionById(q, r.session_id);
      }),
  }),
  sessionById: route({
    auth: "user",
    handler: (c) => {
      const id = uuidParam(c.params.id);
      return c.d.db.asUser(c.user.userId, (q) => sessionById(q, id));
    },
  }),
  sessionSummary: route({
    auth: "user",
    handler: (c) => {
      const id = uuidParam(c.params.id);
      return c.d.db.asUser(c.user.userId, async (q) =>
        sessionSummarySchema.parse(await one(q, "public.get_session_summary($1::uuid)", [id])),
      );
    },
  }),

  setChecklist: route({
    auth: "user",
    handler: async (c) => {
      const id = uuidParam(c.params.id);
      const body = await readBody(c.req, checklistUpdateRequestSchema);
      return c.d.db.asUser(c.user.userId, async (q) => {
        await q.query("select public.set_checklist($1::uuid, $2::boolean, $3::int)", [id, body.checked, body.version]);
        const rows = await q.query<{ session_id: string }>(
          "select session_id::text as session_id from public.session_activities where id = $1::uuid",
          [id],
        );
        if (!rows[0]) throw NOT_FOUND();
        return sessionById(q, rows[0].session_id);
      });
    },
  }),

  counterOperations: route({
    auth: "user",
    handler: async (c) => {
      const id = uuidParam(c.params.id);
      const body = await readBody(c.req, counterOperationsRequestSchema);
      return c.d.db.asUser(c.user.userId, async (q) => {
        const results = [];
        // In order, in one transaction: a failure that is not a per-operation refusal undoes the whole batch.
        for (const op of body.operations) {
          const r = await one<unknown>(
            q,
            "public.apply_counter_operation($1::uuid, $2, $3, $4::int, $5::timestamptz)",
            [id, op.operation_id, op.kind, op.kind === "delta" ? op.delta : null, op.client_recorded_at],
          );
          results.push(counterResultSchema.parse(r));
        }
        return { results };
      });
    },
  }),

  addExcuse: route({
    auth: "user",
    handler: async (c) => {
      const body = await readBody(c.req, excuseRequestSchema);
      if (!isLocalDate(body.from) || (body.to !== undefined && !isLocalDate(body.to))) {
        throw new ApiError("VALIDATION_ERROR", "Tanggal belum benar.", { reason: "invalid_date" });
      }
      return c.d.db.asUser(c.user.userId, async (q) =>
        excuseResponseSchema.parse(await one(q, "public.add_excuse($1::date, $2::date)", [body.from, body.to ?? null])),
      );
    },
  }),
  cancelExcuse: route({
    auth: "user",
    handler: (c) => {
      const date = dateParam(c.params.date, "batal");
      if (!date) throw NOT_FOUND();
      return c.d.db.asUser(c.user.userId, async (q) =>
        excuseResponseSchema.parse(await one(q, "public.cancel_excuse($1::date)", [date])),
      );
    },
  }),

  // ---------- reports ----------
  dashboard: route({
    auth: "user",
    handler: (c) => c.d.db.asUser(c.user.userId, (q) => getDashboard(q, c.d.now())),
  }),
  report: route({
    auth: "user",
    handler: (c) => {
      const period = Number(c.url.searchParams.get("period"));
      if (period !== 7 && period !== 30 && period !== 90) {
        throw new ApiError("VALIDATION_ERROR", "Periode harus 7, 30, atau 90.", { reason: "period" });
      }
      return c.d.db.asUser(c.user.userId, (q) => getReport(q, period));
    },
  }),
  calendar: route({
    auth: "user",
    handler: (c) => {
      const from = dateParam(c.url.searchParams.get("from"), "awal") ?? null;
      const to = dateParam(c.url.searchParams.get("to"), "akhir") ?? null;
      return c.d.db.asUser(c.user.userId, async (q) =>
        calendarResponseSchema.parse(await one(q, "public.get_calendar($1::date, $2::date)", [from, to])),
      );
    },
  }),
  activityStats: route({
    auth: "user",
    handler: (c) =>
      c.d.db.asUser(c.user.userId, async (q) => {
        const r = await one<{ activity_statistics: unknown[] }>(q, "public.get_activity_stats()");
        return { activity_statistics: z.array(activityStatSchema).parse(r.activity_statistics) };
      }),
  }),
  sessionHistory: route({
    auth: "user",
    handler: (c) =>
      c.d.db.asUser(c.user.userId, async (q) =>
        sessionHistoryResponseSchema.parse(await one(q, "public.get_session_history()")),
      ),
  }),

  // ---------- Qur'an progress and notification preferences ----------
  quranProgress: route({
    auth: "user",
    handler: (c) =>
      c.d.db.asUser(c.user.userId, async (q) =>
        quranProgressListSchema.parse(await one(q, "public.get_quran_progress()")),
      ),
  }),
  putQuranProgress: route({
    auth: "user",
    handler: async (c) => {
      const surah = Number(c.params.surah);
      if (!Number.isInteger(surah) || surah < 1 || surah > 114)
        throw new ApiError("NOT_FOUND", "Surah tidak ditemukan.");
      const body = await readBody(c.req, quranProgressUpdateSchema);
      return c.d.db.asUser(c.user.userId, async (q) =>
        quranProgressSchema.parse(await one(q, "public.put_quran_progress($1::int, $2::int)", [surah, body.ayah])),
      );
    },
  }),
  getNotificationPrefs: route({
    auth: "user",
    handler: (c) =>
      c.d.db.asUser(c.user.userId, async (q) =>
        notificationPreferencesSchema.parse(await one(q, "public.get_notification_prefs()")),
      ),
  }),
  putNotificationPrefs: route({
    auth: "user",
    handler: async (c) => {
      const body = await readBody(c.req, notificationPreferencesSchema);
      return c.d.db.asUser(c.user.userId, async (q) =>
        notificationPreferencesSchema.parse(
          await one(q, "public.put_notification_prefs($1::jsonb)", [JSON.stringify(body)]),
        ),
      );
    },
  }),

  /** Anything under /api/v1 that is not an endpoint. JSON, never an HTML page. */
  notFound: route({
    auth: "public",
    handler: async () => jsonResponse({ error: { code: "NOT_FOUND", message: "Endpoint tidak ditemukan." } }, 404),
  }),
};
