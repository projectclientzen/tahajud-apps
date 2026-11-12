import { getAmalan, type AmalanContent } from "@/domain/content/amalan";
import { createSessionSnapshot } from "@/domain/content/snapshot";
import { buildCalendar, type CalendarDay, type SessionRecord } from "@/domain/calendar/calendar";
import { addExcuse, cancelExcuse } from "@/domain/calendar/excuse";
import { PROVISIONAL_SETTINGS, type DomainSettings, type LevelNumber } from "@/domain/config/provisional";
import { applyBatch, type ServerContext } from "@/domain/dhikr/server";
import type { CounterOperation } from "@/domain/dhikr/counter";
import { alKahfiWindow } from "@/domain/prayer/al-kahfi";
import { chooseSchedule, manualSchedule, SCHEDULE_LABEL, type PrayerSchedule } from "@/domain/prayer/schedule";
import { planWake } from "@/domain/prayer/wake-plan";
import {
  checkUnlock,
  computeLevelProgress,
  initialLevelState,
  levelForSession,
  type SessionOutcome,
} from "@/domain/progression/progression";
import { pickInsight } from "@/domain/reporting/insight";
import { activityStats, completionRate, selectPeriod, statusCounts } from "@/domain/reporting/reports";
import {
  activeSessionKey,
  correctionDeadline,
  cutoffInstant,
  isSessionClosed,
  isWithinCorrectionWindow,
} from "@/domain/session/keys";
import { toDisplayStatus, type SessionState } from "@/domain/session/state-machine";
import { computeSessionStatus, isActivityDone, type ActivityProgress } from "@/domain/session/status";
import { addDays, localDate, parseClock, zonedInstant, type LocalDate } from "@/domain/time/tz";
import {
  ApiError,
  counterOperationsRequestSchema,
  excuseRequestSchema,
  locationUpdateSchema,
  preferencesUpdateSchema,
  profileUpdateSchema,
  notificationPreferencesSchema,
  quranProgressUpdateSchema,
  checklistUpdateRequestSchema,
  type Access,
  type CalendarResponse,
  type ChecklistUpdateRequest,
  type CounterOperationsRequest,
  type CounterOperationsResponse,
  type Dashboard,
  type ExcuseRequest,
  type ExcuseResponse,
  type LevelProgressResponse,
  type LocationUpdate,
  type NightSession,
  type NotificationPreferences,
  type PrayerTime,
  type PreferencesUpdate,
  type Profile,
  type ProfileUpdate,
  type QuranProgress,
  type QuranProgressUpdate,
  type ReportResponse,
  type SessionHistoryResponse,
  type SessionSummary,
  type WakePlan,
} from "../contracts";
import { DEMO_FAJR_LOCAL, DEMO_MAGHRIB_LOCAL, DEMO_REGIONS, DEMO_SCHEDULE_NOTE } from "./fixtures/regions";
import { buildScenario } from "./fixtures/scenarios";
import {
  DEFAULT_PROFILE,
  type MockProfile,
  type MockState,
  type ScenarioName,
  type StateStorage,
  type StoredSession,
} from "./state";

export interface Clock {
  /** Real time. Injected so tests never depend on the machine clock. */
  now(): Date;
}

export interface EngineOptions {
  userId: string;
  storage: StateStorage;
  clock: Clock;
  scenario?: ScenarioName;
  content?: AmalanContent;
  settings?: DomainSettings;
}

const QURAN_SURAHS = new Set([18, 36, 55, 56, 67, 65]);

/**
 * Mock "server". Every rule comes from src/domain. It only stores state and shapes responses.
 * Not a security boundary: real entitlement and session checks arrive with S5.
 */
export class MockEngine {
  private state: MockState | null = null;
  private loading: Promise<MockState> | null = null;
  private writes: Promise<void> = Promise.resolve();
  /** Bumped when the state is replaced on purpose (scenario, reset), so a read that started earlier is dropped. */
  private epoch = 0;
  private readonly content: AmalanContent;
  private readonly settings: DomainSettings;

  constructor(private readonly opts: EngineOptions) {
    this.content = opts.content ?? getAmalan();
    this.settings = opts.settings ?? PROVISIONAL_SETTINGS;
  }

  // ---------- clock + persistence ----------
  now(): Date {
    const o = this.state?.clockOverride;
    return o ? new Date(o) : this.opts.clock.now();
  }

  /**
   * One shared load. Several repository calls start together on a fresh page (the settings screen fires five reads),
   * and each used to read storage on its own. The last read replaced `this.state`, so a write made on the earlier copy
   * was never saved.
   */
  private load(): Promise<MockState> {
    if (this.state) return Promise.resolve(this.state);
    this.loading ??= this.readInitial().catch((err: unknown) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  private async readInitial(): Promise<MockState> {
    const epoch = this.epoch;
    const stored = await this.opts.storage.load();
    // A scenario load or reset ran while storage was being read: what we read is stale, so start over.
    if (epoch !== this.epoch) return this.load();
    const st = stored ?? buildScenario(this.opts.scenario ?? "new_account", this.opts.clock.now(), this.opts.userId);
    st.profile ??= { ...DEFAULT_PROFILE };
    this.state = st;
    if (!stored) await this.save();
    return st;
  }

  /** Writes reach storage one at a time, in the order they were requested, so an older snapshot never lands last. */
  private save(): Promise<void> {
    const write = async () => {
      if (this.state) await this.opts.storage.save(this.state);
    };
    const next = this.writes.then(write, write);
    this.writes = next.catch(() => undefined);
    return next;
  }

  /** Load, settle derived level state, hand back the state. */
  private async s(): Promise<MockState> {
    const st = await this.load();
    const result = checkUnlock(
      st.levelState,
      this.outcomes(st),
      { now: this.now(), activeKey: this.activeKey(st) },
      this.settings,
    );
    if (JSON.stringify(result.state) !== JSON.stringify(st.levelState)) {
      st.levelState = result.state;
      await this.save();
    }
    return st;
  }

  private requireOnline(st: MockState): void {
    if (st.offline)
      throw new ApiError("OFFLINE", "Tidak ada koneksi. Catatan disimpan di perangkat dan dikirim saat online.");
  }

  private requireActive(st: MockState): void {
    if (st.access.access_status !== "active") throw new ApiError("ENTITLEMENT_INACTIVE", "Akses belum aktif.");
  }

  // ---------- dev tools ----------
  async dev_setNow(iso: string | null): Promise<void> {
    const st = await this.load();
    st.clockOverride = iso;
    await this.save();
  }
  async dev_advance(ms: number): Promise<void> {
    await this.load();
    await this.dev_setNow(new Date(this.now().getTime() + ms).toISOString());
  }
  async dev_loadScenario(name: ScenarioName): Promise<void> {
    const keep = this.state?.clockOverride ?? null;
    this.epoch++;
    this.loading = null;
    this.state = buildScenario(name, keep ? new Date(keep) : this.opts.clock.now(), this.opts.userId);
    this.state.clockOverride = keep;
    await this.save();
  }
  async dev_patch(patch: Partial<Pick<MockState, "offline" | "providerDown" | "cacheValidUntil">>): Promise<void> {
    const st = await this.load();
    Object.assign(st, patch);
    await this.save();
  }
  async dev_reset(): Promise<void> {
    this.epoch++;
    this.loading = null;
    this.state = null;
    await this.opts.storage.clear();
  }
  async dev_state(): Promise<MockState> {
    return structuredClone(await this.s());
  }

  // ---------- derived ----------
  private activeKey(st: MockState): LocalDate {
    return activeSessionKey(this.now(), st.timezone, this.settings);
  }

  private titleOf(level: LevelNumber, id: string) {
    return this.content.levels[level].activities.find((a) => a.id === id);
  }

  private progressOf(st: MockState, sess: StoredSession): ActivityProgress[] {
    return sess.snapshot.activities.map((a) => ({
      id: a.id,
      kind: a.kind,
      required: a.required,
      target: a.target,
      count: st.counterStore.counts[`${this.opts.userId}:${this.apiActivityId(sess.snapshot.sessionKey, a.id)}`] ?? 0,
      checked: sess.activities[a.id]?.checked ?? false,
    }));
  }

  private apiActivityId = (key: string, id: string): string => `${key}~${id}`;

  private records(st: MockState): SessionRecord[] {
    return Object.values(st.sessions).map((s) => ({
      sessionKey: s.snapshot.sessionKey,
      level: s.snapshot.level,
      activities: this.progressOf(st, s),
    }));
  }

  private calendar(st: MockState, from?: string, to?: string): CalendarDay[] {
    return buildCalendar({
      programStartDate: st.programStartDate,
      activeKey: this.activeKey(st),
      records: this.records(st),
      excusedDates: st.excusedDates,
      from,
      to,
    });
  }

  private outcomes(st: MockState): SessionOutcome[] {
    return this.calendar(st)
      .filter((d): d is CalendarDay & { level: LevelNumber } => d.level !== null)
      .map((d) => ({ sessionKey: d.date, level: d.level, status: d.status }));
  }

  private sessionState(st: MockState, sess: StoredSession): SessionState {
    const key = sess.snapshot.sessionKey;
    return computeSessionStatus({
      activities: this.progressOf(st, sess),
      excused: st.excusedDates.includes(key),
      closed: isSessionClosed(key, this.now(), sess.snapshot.timezone, this.settings),
    });
  }

  private view(st: MockState, sess: StoredSession): NightSession {
    const now = this.now();
    const tz = sess.snapshot.timezone;
    const key = sess.snapshot.sessionKey;
    const progress = this.progressOf(st, sess);
    const state = this.sessionState(st, sess);
    const level = sess.snapshot.level;
    return {
      id: sess.id,
      session_key: key,
      status: toDisplayStatus(state),
      state,
      level,
      timezone: tz,
      region_id: sess.snapshot.regionId,
      content_version: sess.snapshot.contentVersion,
      created_at: sess.snapshot.createdAt,
      cutoff_at: cutoffInstant(key, tz, this.settings).toISOString(),
      correction_deadline_at: correctionDeadline(key, tz, this.settings).toISOString(),
      correction_window_open: isWithinCorrectionWindow(key, now, tz, this.settings),
      activities: sess.snapshot.activities.map((a, i) => {
        const cfg = this.titleOf(level, a.id);
        const dhikr = cfg?.dhikrRef ? this.content.dhikr[cfg.dhikrRef] : undefined;
        const p = progress[i]!;
        return {
          id: this.apiActivityId(key, a.id),
          key: a.key,
          phase: a.phase,
          type: a.type,
          kind: a.kind,
          title: cfg?.title ?? a.key,
          target: a.target,
          unit: cfg?.unit ?? null,
          required: a.required,
          guidance: cfg?.guidance ?? null,
          arabic_text: dhikr?.arabicText ?? null,
          dhikr_review_status: dhikr?.reviewStatus ?? null,
          count: p.count,
          checked: p.checked,
          version: sess.activities[a.id]?.version ?? 0,
          completed: isActivityDone(p),
        };
      }),
    };
  }

  private findActivity(st: MockState, apiId: string): { sess: StoredSession; activityId: string } {
    const i = apiId.indexOf("~");
    const sess = i > 0 ? st.sessions[apiId.slice(0, i)] : undefined;
    const activityId = apiId.slice(i + 1);
    if (!sess || !sess.snapshot.activities.some((a) => a.id === activityId)) {
      throw new ApiError("NOT_FOUND", "Aktivitas tidak ditemukan.");
    }
    return { sess, activityId };
  }

  private requireSessionById(st: MockState, id: string): StoredSession {
    const sess = Object.values(st.sessions).find((x) => x.id === id);
    if (!sess) throw new ApiError("NOT_FOUND", "Sesi tidak ditemukan.");
    return sess;
  }

  // ---------- access ----------
  async getAccess(): Promise<Access> {
    return structuredClone((await this.s()).access);
  }

  // ---------- session ----------
  async getActiveSession(): Promise<NightSession | null> {
    const st = await this.s();
    this.requireActive(st);
    const sess = st.sessions[this.activeKey(st)];
    return sess ? this.view(st, sess) : null;
  }

  async ensureActiveSession(): Promise<NightSession> {
    const st = await this.s();
    this.requireActive(st);
    const key = this.activeKey(st);
    let sess = st.sessions[key];
    if (!sess) {
      const level = levelForSession(st.levelState, key);
      const snapshot = createSessionSnapshot(
        { sessionKey: key, level, timezone: st.timezone, regionId: st.regionId, now: this.now() },
        this.content,
      );
      sess = { id: `sess_${key}`, snapshot, activities: {} };
      for (const a of snapshot.activities)
        if (a.kind === "checklist") sess.activities[a.id] = { checked: false, version: 0 };
      st.sessions[key] = sess;
      await this.save();
    }
    return this.view(st, sess);
  }

  async getSession(id: string): Promise<NightSession> {
    const st = await this.s();
    this.requireActive(st);
    return this.view(st, this.requireSessionById(st, id));
  }

  async setChecklist(apiActivityId: string, raw: ChecklistUpdateRequest): Promise<NightSession> {
    const req = checklistUpdateRequestSchema.parse(raw);
    const st = await this.s();
    this.requireActive(st);
    const { sess, activityId } = this.findActivity(st, apiActivityId);
    const act = sess.snapshot.activities.find((a) => a.id === activityId)!;
    if (act.kind !== "checklist") throw new ApiError("VALIDATION_ERROR", "Aktivitas ini memakai counter.");
    if (!isWithinCorrectionWindow(sess.snapshot.sessionKey, this.now(), sess.snapshot.timezone, this.settings)) {
      throw new ApiError("SESSION_LOCKED", "Sesi ini sudah lewat jendela koreksi.");
    }
    const cur = sess.activities[activityId] ?? { checked: false, version: 0 };
    if (cur.version !== req.version) {
      throw new ApiError("VERSION_CONFLICT", "Data sudah berubah di perangkat lain.", { server: cur });
    }
    sess.activities[activityId] = { checked: req.checked, version: cur.version + 1 };
    await this.save();
    return this.view(await this.s(), sess);
  }

  async applyCounterOperations(
    apiActivityId: string,
    raw: CounterOperationsRequest,
  ): Promise<CounterOperationsResponse> {
    const req = counterOperationsRequestSchema.parse(raw);
    const st = await this.s();
    this.requireActive(st);
    this.requireOnline(st);
    const ops: CounterOperation[] = req.operations.map((o) =>
      o.kind === "delta"
        ? {
            kind: "delta",
            operationId: o.operation_id,
            activityId: apiActivityId,
            delta: o.delta,
            clientRecordedAt: o.client_recorded_at,
          }
        : {
            kind: "set_zero",
            operationId: o.operation_id,
            activityId: apiActivityId,
            clientRecordedAt: o.client_recorded_at,
          },
    );
    const ctx: ServerContext = {
      userId: this.opts.userId,
      now: this.now(),
      activity: (id) => {
        try {
          const { sess, activityId } = this.findActivity(st, id);
          const a = sess.snapshot.activities.find((x) => x.id === activityId)!;
          if (a.kind !== "counter") return null;
          return {
            target: a.target ?? 1,
            windowOpen: isWithinCorrectionWindow(
              sess.snapshot.sessionKey,
              this.now(),
              sess.snapshot.timezone,
              this.settings,
            ),
          };
        } catch {
          return null;
        }
      },
    };
    const { store, results } = applyBatch(st.counterStore, ops, ctx);
    st.counterStore = store;
    await this.save();
    return {
      results: results.map((r) => ({
        operation_id: r.operationId,
        status: r.status,
        authoritative_count: r.authoritativeCount,
        target: r.target,
        completed: r.completed,
        updated_at: r.updatedAt,
        ...(r.errorCode ? { error_code: r.errorCode } : {}),
      })),
    };
  }

  async getSummary(sessionId: string): Promise<SessionSummary> {
    const st = await this.s();
    this.requireActive(st);
    const sess = this.requireSessionById(st, sessionId);
    const level = sess.snapshot.level;
    const progress = computeLevelProgress(this.outcomes(st), st.levelState, this.settings).levels[level - 1]!;
    const next = (level + 1) as LevelNumber;
    const effective = level < 3 ? (st.levelState.effectiveFromSessionKey[next] ?? null) : null;
    return {
      session_id: sess.id,
      session_status: toDisplayStatus(this.sessionState(st, sess)),
      successful_nights_at_level: progress.completed,
      required_successful_nights: progress.required,
      current_level: levelForSession(st.levelState, this.activeKey(st)),
      next_level_unlocked: effective !== null,
      next_level_effective_session_key: effective,
    };
  }

  // ---------- progress ----------
  async getCurrentLevel() {
    const st = await this.s();
    this.requireActive(st);
    const level = levelForSession(st.levelState, this.activeKey(st));
    return { level, effective_from_session_key: st.levelState.effectiveFromSessionKey[level] ?? null };
  }

  private levelProgress(st: MockState): LevelProgressResponse {
    const p = computeLevelProgress(this.outcomes(st), st.levelState, this.settings);
    return {
      current_level: st.levelState.currentLevel,
      journey_completed: p.journeyCompleted,
      provisional: true,
      levels: p.levels.map((l) => ({
        level: l.level,
        completed: l.completed,
        required: l.required,
        ratio: l.ratio,
        unlocked: l.unlocked,
        is_current: l.isCurrent,
        effective_from_session_key: st.levelState.effectiveFromSessionKey[l.level] ?? null,
      })),
    };
  }

  async getLevelProgress(): Promise<LevelProgressResponse> {
    const st = await this.s();
    this.requireActive(st);
    return this.levelProgress(st);
  }

  // ---------- excuse ----------
  async addExcuse(raw: ExcuseRequest): Promise<ExcuseResponse> {
    const req = excuseRequestSchema.parse(raw);
    const st = await this.s();
    this.requireActive(st);
    const r = addExcuse(st.excusedDates, req.from, req.to, this.settings);
    if (!r.ok) throw new ApiError("VALIDATION_ERROR", `Berhalangan ditolak: ${r.error}`, { reason: r.error });
    st.excusedDates = r.dates;
    await this.save();
    return { excused_dates: r.dates };
  }

  async cancelExcuse(date: string): Promise<ExcuseResponse> {
    const st = await this.s();
    this.requireActive(st);
    const r = cancelExcuse(st.excusedDates, date, this.now(), st.timezone, this.settings);
    if (!r.ok) {
      throw new ApiError(
        r.error === "window_closed" ? "SESSION_LOCKED" : "NOT_FOUND",
        `Tidak bisa dibatalkan: ${r.error}`,
        { reason: r.error },
      );
    }
    st.excusedDates = r.dates;
    await this.save();
    return { excused_dates: r.dates };
  }

  // ---------- prayer ----------
  private scheduleFor(st: MockState, date: LocalDate): PrayerSchedule | null {
    const now = this.now();
    const tz = st.timezone;
    const at = (hhmm: string) => {
      const c = parseClock(hhmm);
      return zonedInstant(date, c.hour, c.minute, tz);
    };
    if (st.scheduleMode === "region" && st.regionId === null) return null; // onboarding has not chosen a region yet
    if (st.scheduleMode === "manual") {
      const m = st.manualSchedule;
      if (!m) return null;
      return manualSchedule({
        date,
        timezone: m.timezone,
        fajrAt: zonedInstant(date, parseClock(m.fajrTime).hour, parseClock(m.fajrTime).minute, m.timezone),
        maghribAt: m.maghribTime
          ? zonedInstant(date, parseClock(m.maghribTime).hour, parseClock(m.maghribTime).minute, m.timezone)
          : null,
        now,
      });
    }
    const demo: PrayerSchedule = {
      regionId: st.regionId,
      localDate: date,
      timezone: tz,
      fajrAt: at(DEMO_FAJR_LOCAL).toISOString(),
      maghribAt: at(DEMO_MAGHRIB_LOCAL).toISOString(),
      source: "provider",
      fetchedAt: now.toISOString(),
      validUntil: st.cacheValidUntil,
    };
    return demo;
  }

  private prayerTime(st: MockState, date: LocalDate): PrayerTime {
    const now = this.now();
    const sched = this.scheduleFor(st, date);
    const region = DEMO_REGIONS.find((r) => r.id === st.regionId);
    const choice = sched
      ? chooseSchedule({
          mode: st.scheduleMode,
          provider: st.providerDown ? null : sched,
          cached: sched,
          manual: sched,
          date,
          now,
        })
      : ({ ok: false, reason: "unavailable" } as const);
    if (!choice.ok) {
      return {
        available: false,
        region_id: st.regionId,
        region_name: region?.name ?? null,
        local_date: date,
        timezone: st.timezone,
        fajr_at: null,
        maghrib_at: null,
        source: null,
        cache_status: "none",
        fetched_at: null,
        label: null,
        demo_note: null,
      };
    }
    const s = choice.schedule;
    return {
      available: true,
      region_id: s.regionId,
      region_name: region?.name ?? null,
      local_date: date,
      timezone: s.timezone,
      fajr_at: s.fajrAt,
      maghrib_at: s.maghribAt,
      source: s.source,
      cache_status: s.source === "cached" ? "cached" : "fresh",
      fetched_at: s.fetchedAt,
      label: choice.label,
      demo_note: s.source === "manual" ? null : DEMO_SCHEDULE_NOTE,
    };
  }

  async listRegions() {
    return structuredClone(DEMO_REGIONS);
  }

  async getNextFajr(): Promise<PrayerTime> {
    const st = await this.s();
    this.requireActive(st);
    return this.prayerTime(st, this.activeKey(st));
  }

  async getWakePlan(): Promise<WakePlan> {
    const st = await this.s();
    this.requireActive(st);
    const key = this.activeKey(st);
    const level = levelForSession(st.levelState, key);
    const pt = this.prayerTime(st, key);
    const prefs = st.notificationPrefs.bedtime;
    const fallback = {
      level,
      duration_minutes: this.settings.levels[level].estimatedDurationMinutes,
      buffer_minutes: this.settings.wakeBufferMinutes,
    };
    if (!pt.available || !pt.fajr_at) {
      return { ...fallback, wake_at: null, fajr_at: null, sleep_hours: null, sleep_warning: null, source: null };
    }
    const sleepClock = parseClock(prefs.target_sleep_time);
    // bedtime on the evening before the Fajr date, in the schedule's zone
    const sleepAt = zonedInstant(addDays(key, -1), sleepClock.hour, sleepClock.minute, pt.timezone);
    const plan = planWake(
      { fajrAt: new Date(pt.fajr_at), level, sleepAt: prefs.enabled ? sleepAt : null },
      this.settings,
    );
    return {
      level,
      wake_at: plan.wakeAt.toISOString(),
      fajr_at: pt.fajr_at,
      duration_minutes: plan.durationMinutes,
      buffer_minutes: plan.bufferMinutes,
      sleep_hours: plan.sleepHours,
      sleep_warning: plan.sleepWarning,
      source: pt.source,
    };
  }

  async setLocation(raw: LocationUpdate): Promise<PrayerTime> {
    const req = locationUpdateSchema.parse(raw);
    const st = await this.s();
    this.requireActive(st);
    if (req.mode === "region") {
      const r = DEMO_REGIONS.find((x) => x.id === req.region_id);
      if (!r) throw new ApiError("NOT_FOUND", "Wilayah tidak ditemukan.");
      st.scheduleMode = "region";
      st.regionId = r.id;
      st.timezone = r.timezone;
      st.manualSchedule = null;
    } else {
      st.scheduleMode = "manual";
      st.regionId = null;
      st.timezone = req.timezone;
      st.manualSchedule = { timezone: req.timezone, fajrTime: req.fajr_time, maghribTime: req.maghrib_time ?? null };
    }
    // Existing session rows keep their frozen zone. Only sessions created later use the new one.
    await this.save();
    return this.prayerTime(st, this.activeKey(st));
  }

  // ---------- profile (§19.2) ----------
  private profileView(st: MockState): Profile {
    const p = st.profile as MockProfile;
    return {
      user_id: this.opts.userId,
      display_name: p.displayName,
      region_id: st.regionId,
      schedule_mode: st.scheduleMode,
      timezone: st.timezone,
      program_start_date: st.access.onboarding_completed ? st.programStartDate : null,
      onboarding_completed: st.access.onboarding_completed,
      theme_pref: p.themePref,
      quran_font_size: p.quranFontSize,
      dhikr_font_size: p.dhikrFontSize,
    };
  }

  async getProfile(): Promise<Profile> {
    const st = await this.s();
    this.requireActive(st);
    return this.profileView(st);
  }

  async updateProfile(raw: ProfileUpdate): Promise<Profile> {
    const req = profileUpdateSchema.parse(raw);
    const st = await this.s();
    this.requireActive(st);
    st.profile = { ...(st.profile as MockProfile), displayName: req.display_name === "" ? null : req.display_name };
    await this.save();
    return this.profileView(st);
  }

  async updatePreferences(raw: PreferencesUpdate): Promise<Profile> {
    const req = preferencesUpdateSchema.parse(raw);
    const st = await this.s();
    this.requireActive(st);
    const cur = st.profile as MockProfile;
    st.profile = {
      ...cur,
      themePref: req.theme_pref ?? cur.themePref,
      quranFontSize: req.quran_font_size ?? cur.quranFontSize,
      dhikrFontSize: req.dhikr_font_size ?? cur.dhikrFontSize,
    };
    await this.save();
    return this.profileView(st);
  }

  /**
   * Finishes onboarding. program_start_date becomes the first session the user can still do (S2-3), and the
   * level state restarts from it. A second call changes nothing.
   */
  async completeOnboarding(): Promise<Profile> {
    const st = await this.s();
    this.requireActive(st);
    if (!st.access.onboarding_completed) {
      if (st.scheduleMode === "region" && st.regionId === null) {
        throw new ApiError("VALIDATION_ERROR", "Pilih wilayah atau atur jadwal manual dulu.");
      }
      st.programStartDate = this.activeKey(st);
      st.levelState = initialLevelState(st.programStartDate, this.now());
      st.access = { ...st.access, onboarding_completed: true };
      await this.save();
    }
    return this.profileView(st);
  }

  // ---------- reports ----------
  private currentSessionBlock(st: MockState): Dashboard["current_session"] {
    const key = this.activeKey(st);
    const sess = st.sessions[key];
    if (!sess) {
      const excused = st.excusedDates.includes(key);
      return {
        id: null,
        session_key: key,
        status: excused ? "excused" : "upcoming",
        state: excused ? "excused" : "scheduled",
        required_done: 0,
        required_total: this.content.levels[levelForSession(st.levelState, key)].activities.filter((a) => a.required)
          .length,
      };
    }
    const progress = this.progressOf(st, sess).filter((p) => p.required);
    const state = this.sessionState(st, sess);
    return {
      id: sess.id,
      session_key: key,
      status: toDisplayStatus(state),
      state,
      required_done: progress.filter(isActivityDone).length,
      required_total: progress.length,
    };
  }

  private toDay = (d: CalendarDay) => ({ date: d.date, status: d.status, level: d.level, has_progress: d.hasProgress });
  private toStat = (s: ReturnType<typeof activityStats>[number]) => ({
    id: s.id,
    key: s.key,
    phase: s.phase,
    sessions: s.sessions,
    with_progress: s.withProgress,
    times_completed: s.timesCompleted,
    total_count: s.totalCount,
  });

  async getDashboard(): Promise<Dashboard> {
    const st = await this.s();
    this.requireActive(st);
    const activeKey = this.activeKey(st);
    const days = this.calendar(st);
    const lp = this.levelProgress(st);
    const insight = pickInsight({
      days,
      activeKey,
      levels: computeLevelProgress(this.outcomes(st), st.levelState, this.settings).levels,
    });
    return {
      is_demo: true,
      level: levelForSession(st.levelState, activeKey),
      level_progress: lp,
      prayer_time: this.prayerTime(st, activeKey),
      status_counts: statusCounts(days),
      completion_rate: completionRate(days),
      calendar_days: days.slice(-30).map(this.toDay),
      activity_statistics: activityStats(this.records(st)).map(this.toStat),
      insight,
      current_session: this.currentSessionBlock(st),
      setup_cards: [
        { key: "location", done: st.scheduleMode === "manual" || st.regionId !== null },
        { key: "notifications", done: st.notificationPrefs.bedtime.enabled || st.notificationPrefs.tahajud.enabled },
        { key: "install_app", done: st.installPromptDone },
      ],
    };
  }

  async getReport(period: 7 | 30 | 90): Promise<ReportResponse> {
    const st = await this.s();
    this.requireActive(st);
    const activeKey = this.activeKey(st);
    const days = selectPeriod(this.calendar(st), period, st.programStartDate, activeKey);
    const inRange = new Set(days.map((d) => d.date));
    const records = this.records(st).filter((r) => inRange.has(r.sessionKey));
    const all = this.calendar(st);
    return {
      period,
      from: days[0]?.date ?? null,
      to: days.at(-1)?.date ?? null,
      status_counts: statusCounts(days),
      completion_rate: completionRate(days),
      activity_statistics: activityStats(records).map(this.toStat),
      insight: pickInsight({
        days: all,
        activeKey,
        levels: computeLevelProgress(this.outcomes(st), st.levelState, this.settings).levels,
      }),
    };
  }

  async getCalendar(from?: string, to?: string): Promise<CalendarResponse> {
    const st = await this.s();
    this.requireActive(st);
    return { days: this.calendar(st, from, to).map(this.toDay) };
  }

  async getSessionHistory(): Promise<SessionHistoryResponse> {
    const st = await this.s();
    this.requireActive(st);
    const sessions = Object.values(st.sessions)
      .sort((a, b) => b.snapshot.sessionKey.localeCompare(a.snapshot.sessionKey))
      .map((s) => {
        const req = this.progressOf(st, s).filter((p) => p.required);
        return {
          session_key: s.snapshot.sessionKey,
          status: toDisplayStatus(this.sessionState(st, s)),
          level: s.snapshot.level,
          required_done: req.filter(isActivityDone).length,
          required_total: req.length,
        };
      });
    return { sessions };
  }

  // ---------- Qur'an progress (position only) ----------
  async getQuranProgress(): Promise<QuranProgress[]> {
    const st = await this.s();
    this.requireActive(st);
    return Object.values(st.quranProgress);
  }

  async putQuranProgress(surah: number, raw: QuranProgressUpdate): Promise<QuranProgress> {
    const req = quranProgressUpdateSchema.parse(raw);
    const st = await this.s();
    this.requireActive(st);
    if (!QURAN_SURAHS.has(surah)) throw new ApiError("NOT_FOUND", "Surah ini belum didukung.");
    const p: QuranProgress = { surah, ayah: req.ayah, updated_at: this.now().toISOString() };
    st.quranProgress[String(surah)] = p;
    await this.save();
    return p;
  }

  // ---------- notification prefs ----------
  async getPreferences(): Promise<NotificationPreferences> {
    return structuredClone((await this.s()).notificationPrefs);
  }

  async putPreferences(raw: NotificationPreferences): Promise<NotificationPreferences> {
    const prefs = notificationPreferencesSchema.parse(raw);
    const st = await this.s();
    this.requireActive(st);
    st.notificationPrefs = prefs;
    await this.save();
    return structuredClone(prefs);
  }

  /** Al-Kahfi window for UI hints (S3). Uses the same schedule rules as the prayer repository. */
  async getAlKahfiWindow() {
    const st = await this.s();
    return alKahfiWindow(
      {
        now: this.now(),
        tz: st.timezone,
        maghribFor: (d) => {
          const pt = this.prayerTime(st, d);
          return pt.maghrib_at ? new Date(pt.maghrib_at) : null;
        },
      },
      this.settings,
    );
  }
}

export { SCHEDULE_LABEL, localDate };
