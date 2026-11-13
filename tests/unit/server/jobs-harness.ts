import type { Queryable } from "@/server/db";
import { createPgliteDb, type PgliteDb } from "@/server/db/pglite";
import type { PushSender, PushSubscriptionRecord, SendOutcome, NotificationPayload } from "@/server/push";
import type { Services } from "@/server/jobs/services";
import { silentLogger } from "@/server/jobs/log";
import { loadScalevConfig } from "@/server/scalev/config";

/** A fresh PostgreSQL (PGlite) with every migration and the seed. Takes a few seconds, so tests share one per file. */
export async function createJobsDb(): Promise<PgliteDb> {
  return createPgliteDb({ seed: true });
}

let counter = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export interface TestUser {
  id: string;
  email: string;
  subscriptionId: string | null;
}

export interface AddUserOptions {
  region?: string | null;
  manual?: { fajr: string; maghrib?: string; timezone: string } | null;
  entitlement?: "active" | "suspended" | "none";
  subscribed?: boolean;
  displayName?: string | null;
  level?: 1 | 2 | 3;
}

/** A user the way the API would leave one after onboarding. Runs as the database owner. */
export async function addUser(db: PgliteDb, o: AddUserOptions = {}): Promise<TestUser> {
  const n = ++counter;
  const id = uuid(5000 + n);
  const email = `t6user${n}@ngajigaes.test`;
  await db.exec("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  const region = o.region === undefined ? "DEMO-JKT" : o.region;
  await db.exec(
    `insert into public.profiles (user_id, email_normalized, display_name, region_id, manual_schedule, onboarding_completed, program_start_date)
     values ($1, $2, $3, (select id from public.regions where provider_region_code = $4), $5::jsonb, true, '2026-11-01')`,
    [
      id,
      email,
      o.displayName === undefined ? "Zen Tester" : o.displayName,
      region,
      o.manual ? JSON.stringify(o.manual) : null,
    ],
  );
  if ((o.entitlement ?? "active") !== "none") {
    await db.exec(
      `insert into public.access_entitlements (user_id, email_normalized, status, starts_at) values ($1, $2, $3, '2026-01-01T00:00:00Z')`,
      [id, email, o.entitlement ?? "active"],
    );
  }
  if (o.level && o.level > 1) {
    await db.exec(
      "insert into public.user_level_state (user_id, current_level, level_1_unlocked_at) values ($1, $2, now())",
      [id, o.level],
    );
  }
  let subscriptionId: string | null = null;
  if (o.subscribed ?? true) {
    const rows = await db.exec(
      `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'p256dh-test', 'auth-test') returning id`,
      [id, `https://push.example.test/${id}`],
    );
    subscriptionId = rows[0]!.id as string;
  }
  return { id, email, subscriptionId };
}

/** Fajr 04:06 and Maghrib 17:51 Jakarta time (21:06Z the day before, 10:51Z) for each date in [from, to], cached by the provider. */
export async function addPrayerTimes(
  db: PgliteDb,
  from: string,
  to: string,
  region = "DEMO-JKT",
  fajr = "04:06",
  maghrib = "17:51",
): Promise<void> {
  await db.exec(
    `insert into public.prayer_times (region_id, local_date, fajr_at, maghrib_at, provider, fetched_at, valid_until, verification, attribution)
     select r.id, d::date,
            ((d::date + $3::time) at time zone r.timezone), ((d::date + $4::time) at time zone r.timezone),
            'equran', '2026-11-01T00:00:00Z', ((d::date + 40) at time zone r.timezone), 'verified', 'test'
     from public.regions r, generate_series($1::date, $2::date, interval '1 day') d
     where r.provider_region_code = $5
     on conflict (region_id, local_date, provider) do nothing`,
    [from, to, fajr, maghrib, region],
  );
}

export async function resetJobsTables(db: PgliteDb): Promise<void> {
  await db.exec("delete from public.notification_deliveries");
  await db.exec("delete from public.notification_jobs");
  await db.exec("delete from public.jobs");
  await db.exec("delete from public.auth_tokens");
  await db.exec("delete from public.auth_events");
  await db.exec("delete from public.prayer_times");
  await db.exec("delete from public.notification_templates");
  await db.exec("delete from public.push_subscriptions");
  await db.exec("delete from public.notification_preferences");
  await db.exec("delete from public.profiles");
  await db.exec("delete from public.access_entitlements");
  await db.exec("delete from public.user_level_state");
  await db.exec("delete from auth.users");
  await db.setNow(null);
}

export async function setPrefs(db: PgliteDb, userId: string, set: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(set);
  await db.exec(
    `insert into public.notification_preferences (user_id, ${cols.join(", ")}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")})
     on conflict (user_id) do update set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}`,
    [userId, ...cols.map((c) => set[c])],
  );
}

export interface SentCall {
  sub: PushSubscriptionRecord;
  payload: NotificationPayload;
  ttlSeconds: number | undefined;
}

/** Scripted push sender. `answer(endpoint)` picks the outcome; the default is a 201. */
export class FakeSender implements PushSender {
  readonly calls: SentCall[] = [];
  constructor(
    private readonly answer: (sub: PushSubscriptionRecord) => SendOutcome = () => ({
      status: "sent",
      statusCode: 201,
      attempts: 1,
    }),
  ) {}
  async send(
    sub: PushSubscriptionRecord,
    payload: NotificationPayload,
    opts?: { ttlSeconds?: number },
  ): Promise<SendOutcome> {
    this.calls.push({ sub, payload, ttlSeconds: opts?.ttlSeconds });
    return this.answer(sub);
  }
}

export function makeServices(db: PgliteDb, over: Partial<Services> = {}): Services {
  return {
    db,
    now: () => new Date(),
    log: silentLogger,
    workerId: "test-worker",
    config: { cronSecret: null, allowDemoBank: false, prayerProvider: null },
    sender: null,
    prayerProvider: null,
    scalev: { config: loadScalevConfig({}), client: null, pepper: null },
    ...over,
  };
}

export async function jobsByType(db: PgliteDb, type: string): Promise<Record<string, unknown>[]> {
  return db.exec("select * from public.jobs where job_type = $1 order by created_at, id", [type]);
}

export type Q = Queryable;
