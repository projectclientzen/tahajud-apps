import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CounterOperation } from "../../src/domain/dhikr/counter";
import {
  applyOperation,
  emptyCounterStore,
  type CounterStore,
  type OperationResult,
} from "../../src/domain/dhikr/server";
import { activityId, applyOp, as, attempt, createTestDb, createUser, rows, startSession } from "./harness";

/**
 * Parity with src/domain/dhikr/server.ts (S2). Every step runs through the domain function and through the SQL
 * function, and the answers must match field by field. Session key 2026-11-12 (WIB): cutoff 05:00Z that day,
 * correction window closes 48 h later.
 */
const BASE = "2026-11-12T02:00:00+07:00";
const BASE_MS = Date.parse(BASE);
const CUTOFF_MS = Date.parse("2026-11-12T12:00:00+07:00");
const DEADLINE_MS = CUTOFF_MS + 48 * 3_600_000;
const TARGET = 100;

interface Step {
  id: string;
  kind: "delta" | "set_zero";
  delta?: number;
  /** ms after BASE for the server clock. */
  at?: number;
  /** Client-recorded time, ms after BASE. Defaults to the server time. */
  recorded?: number;
  /** Which activity: the real one, or one that does not exist. */
  target?: "real" | "unknown";
}

const iso = (ms: number) => new Date(ms).toISOString();

async function runBoth(pg: PGlite, steps: Step[]) {
  const user = await createUser(pg);
  const sess = await startSession(pg, user, BASE);
  const real = await activityId(pg, sess.session_id, "istighfar");
  let store: CounterStore = emptyCounterStore();
  const out: { domain: OperationResult; sql: Awaited<ReturnType<typeof applyOp>> }[] = [];
  for (const st of steps) {
    const at = BASE_MS + (st.at ?? 0);
    const recorded = iso(BASE_MS + (st.recorded ?? st.at ?? 0));
    const unknown = st.target === "unknown";
    const op: CounterOperation =
      st.kind === "set_zero"
        ? { kind: "set_zero", operationId: st.id, activityId: unknown ? "nope" : "act", clientRecordedAt: recorded }
        : {
            kind: "delta",
            operationId: st.id,
            activityId: unknown ? "nope" : "act",
            delta: st.delta!,
            clientRecordedAt: recorded,
          };
    const d = applyOperation(store, op, {
      userId: "u",
      now: new Date(at),
      activity: (id) => (id === "act" ? { target: TARGET, windowOpen: at <= DEADLINE_MS } : null),
    });
    store = d.store;
    const sql = await applyOp(
      pg,
      user,
      iso(at),
      unknown ? "99999999-9999-4999-8999-999999999999" : real,
      st.id,
      st.kind,
      st.kind === "delta" ? st.delta! : null,
      recorded,
    );
    out.push({ domain: d.result, sql });
  }
  return { user, real, out };
}

const same = (r: { domain: OperationResult; sql: Awaited<ReturnType<typeof applyOp>> }) => {
  const sqlView = {
    status: r.sql.status,
    count: r.sql.authoritative_count,
    target: r.sql.target,
    completed: r.sql.completed,
    error: r.sql.error_code ?? null,
  };
  const domView = {
    status: r.domain.status,
    count: r.domain.authoritativeCount,
    target: r.domain.target,
    completed: r.domain.completed,
    error: r.domain.errorCode ?? null,
  };
  return [sqlView, domView] as const;
};

describe("apply_counter_operation matches applyOperation", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  const CASES: [string, Step[]][] = [
    [
      "DZIKIR-03 a repeated operation id is not applied twice",
      [
        { id: "a", kind: "delta", delta: 20 },
        { id: "a", kind: "delta", delta: 20 },
        { id: "b", kind: "delta", delta: 5 },
        { id: "b", kind: "delta", delta: 5 },
      ],
    ],
    [
      "never below zero",
      [
        { id: "n1", kind: "delta", delta: -5 },
        { id: "n2", kind: "delta", delta: 3 },
        { id: "n3", kind: "delta", delta: -10 },
      ],
    ],
    [
      "BUG-10 set_zero resets, later deltas still apply",
      [
        { id: "z1", kind: "delta", delta: 10 },
        { id: "z2", kind: "set_zero" },
        { id: "z3", kind: "delta", delta: 3 },
      ],
    ],
    [
      "invalid deltas are rejected without changing the count",
      [
        { id: "i0", kind: "delta", delta: 4 },
        { id: "i1", kind: "delta", delta: 1001 },
        { id: "i2", kind: "delta", delta: 0 },
        { id: "i3", kind: "delta", delta: -1001 },
        { id: "i4", kind: "delta", delta: 1000 },
        { id: "i5", kind: "delta", delta: -1000 },
      ],
    ],
    [
      "reaching the target marks it completed, going over keeps counting",
      [
        { id: "t1", kind: "delta", delta: 99 },
        { id: "t2", kind: "delta", delta: 1 },
        { id: "t3", kind: "delta", delta: 7 },
      ],
    ],
    [
      "unknown activity is rejected",
      [
        { id: "u1", kind: "delta", delta: 1, target: "unknown" },
        { id: "u2", kind: "set_zero", target: "unknown" },
      ],
    ],
    [
      "BUG-09 a client clock far in the future is accepted, clamped for the record only",
      [{ id: "c1", kind: "delta", delta: 2, recorded: 10 * 86_400_000 }],
    ],
    [
      "a late correction inside the 48 hour window still applies",
      [
        { id: "w1", kind: "delta", delta: 4, at: CUTOFF_MS - BASE_MS + 3_600_000 },
        { id: "w2", kind: "delta", delta: 4, at: DEADLINE_MS - BASE_MS },
      ],
    ],
    [
      "after the window the session is locked",
      [
        { id: "l0", kind: "delta", delta: 4 },
        { id: "l1", kind: "delta", delta: 4, at: DEADLINE_MS - BASE_MS + 1 },
        { id: "l2", kind: "set_zero", at: DEADLINE_MS - BASE_MS + 60_000 },
      ],
    ],
  ];

  it.each(CASES)("%s", async (_name, steps) => {
    const { out } = await runBoth(pg, steps);
    for (const r of out) {
      const [sql, dom] = same(r);
      expect(sql).toEqual(dom);
    }
  });

  it("returns the same shape as the contract (operation_id, status, authoritative_count, target, completed, updated_at)", async () => {
    const { out } = await runBoth(pg, [{ id: "shape", kind: "delta", delta: 3 }]);
    expect(out[0]!.sql).toMatchObject({
      operation_id: "shape",
      status: "accepted",
      authoritative_count: 3,
      target: 100,
      completed: false,
      updated_at: iso(BASE_MS).replace(/\.\d+Z$/, ".000Z"),
    });
    expect(out[0]!.sql.error_code).toBeUndefined();
  });

  it("DZIKIR-05 two devices tapping 30 each end at 60, in either order", async () => {
    const steps: Step[] = [];
    for (let i = 0; i < 30; i++) {
      steps.push({ id: `A${i}`, kind: "delta", delta: 1 }, { id: `B${i}`, kind: "delta", delta: 1 });
    }
    const { out, real, user } = await runBoth(pg, steps);
    expect(out.at(-1)!.sql.authoritative_count).toBe(60);
    for (const r of out) {
      const [sql, dom] = same(r);
      expect(sql).toEqual(dom);
    }
    // a device that sends its 30 taps as one batch and another as singles reaches the same total
    const u2 = await createUser(pg);
    const s2 = await startSession(pg, u2, BASE);
    const act2 = await activityId(pg, s2.session_id, "istighfar");
    await applyOp(pg, u2, BASE, act2, "dev1-batch", "delta", 30);
    for (let i = 0; i < 30; i++) await applyOp(pg, u2, BASE, act2, `dev2-${i}`, "delta", 1);
    const total = await rows<{ c: number }>(
      pg,
      "select actual_count as c from public.session_activities where id = $1",
      [act2],
    );
    expect(total[0]!.c).toBe(60);
    const ops = await rows<{ n: string }>(
      pg,
      "select count(*)::text as n from public.counter_operations where user_id = $1",
      [user],
    );
    expect(Number(ops[0]!.n)).toBe(60); // one row per applied operation
    void real;
  });

  it("DZIKIR-04 style: 100 taps sent as 10 batches of 10 reach 100 and complete", async () => {
    const steps: Step[] = Array.from({ length: 10 }, (_, i) => ({
      id: `batch-${i}`,
      kind: "delta" as const,
      delta: 10,
    }));
    const { out } = await runBoth(pg, steps);
    expect(out.at(-1)!.sql).toMatchObject({ authoritative_count: 100, completed: true });
    expect(same(out.at(-1)!)[0]).toEqual(same(out.at(-1)!)[1]);
  });

  it("the same operation id from two different users is applied for both", async () => {
    const [u1, u2] = [await createUser(pg), await createUser(pg)];
    const [s1, s2] = [await startSession(pg, u1, BASE), await startSession(pg, u2, BASE)];
    const [a1, a2] = [
      await activityId(pg, s1.session_id, "istighfar"),
      await activityId(pg, s2.session_id, "istighfar"),
    ];
    const r1 = await applyOp(pg, u1, BASE, a1, "shared-id", "delta", 4);
    const r2 = await applyOp(pg, u2, BASE, a2, "shared-id", "delta", 9);
    expect([r1.status, r1.authoritative_count, r2.status, r2.authoritative_count]).toEqual([
      "accepted",
      4,
      "accepted",
      9,
    ]);
  });

  it("the stored record keeps the clamped client time and one row per operation", async () => {
    const { user, real } = await runBoth(pg, [
      { id: "rec-1", kind: "delta", delta: 1, recorded: 10 * 86_400_000 },
      { id: "rec-2", kind: "delta", delta: 1, recorded: -60_000 },
      { id: "rec-3", kind: "delta", delta: 1, recorded: 4 * 60_000 },
      { id: "rec-3", kind: "delta", delta: 1, recorded: 4 * 60_000 },
    ]);
    const r = await rows<{ id: string; rec: string; applied: string; res: number }>(
      pg,
      `select client_operation_id as id, client_recorded_at::text as rec, server_applied_at::text as applied, resulting_count as res
       from public.counter_operations where user_id = $1 and session_activity_id = $2 order by resulting_count`,
      [user, real],
    );
    expect(r.map((x) => x.id)).toEqual(["rec-1", "rec-2", "rec-3"]);
    const byId = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(Date.parse(byId["rec-1"]!.rec)).toBe(Date.parse(byId["rec-1"]!.applied)); // 10 days ahead: clamped to server time
    expect(Date.parse(byId["rec-2"]!.rec)).toBe(BASE_MS - 60_000); // the past is kept
    expect(Date.parse(byId["rec-3"]!.rec)).toBe(BASE_MS + 4 * 60_000); // within 5 minutes is kept
  });

  it("set_zero keeps history and writes an audit entry", async () => {
    const { user, real } = await runBoth(pg, [
      { id: "h1", kind: "delta", delta: 12 },
      { id: "h2", kind: "set_zero" },
      { id: "h3", kind: "delta", delta: 2 },
    ]);
    const ops = await rows<{ op_type: string; resulting_count: number }>(
      pg,
      "select op_type, resulting_count from public.counter_operations where user_id = $1 and session_activity_id = $2 order by server_applied_at, resulting_count",
      [user, real],
    );
    expect(ops).toHaveLength(3);
    const audit = await rows<{
      operation_type: string;
      previous_value: { count: number };
      new_value: { count: number };
    }>(pg, "select operation_type, previous_value, new_value from public.session_audit_logs where actor_id = $1", [
      user,
    ]);
    expect(audit).toEqual([
      {
        operation_type: "counter_set_zero",
        previous_value: expect.objectContaining({ count: 12 }),
        new_value: expect.objectContaining({ count: 0 }),
      },
    ]);
  });

  it("through the public RPC as a signed-in user: accepted, then duplicate", async () => {
    const u = await createUser(pg);
    const s = await startSession(pg, u, BASE);
    const act = await activityId(pg, s.session_id, "istighfar");
    // the wrapper uses the server clock, so use a session that is open now: create it with the same wrapper
    const real = await as(pg, "authenticated", u, () =>
      attempt<{ s: { session_id: string } }>(pg, "select public.ensure_active_session() as s"),
    );
    expect(real.ok).toBe(true);
    const sid = real.ok ? real.rows[0]!.s.session_id : "";
    const act2 = await activityId(pg, sid, "istighfar");
    const first = await as(pg, "authenticated", u, () =>
      attempt<{ r: { status: string; authoritative_count: number } }>(
        pg,
        "select public.apply_counter_operation($1, 'rpc-1', 'delta', 6, null) as r",
        [act2],
      ),
    );
    const again = await as(pg, "authenticated", u, () =>
      attempt<{ r: { status: string; authoritative_count: number } }>(
        pg,
        "select public.apply_counter_operation($1, 'rpc-1', 'delta', 6, now() + interval '1 day') as r",
        [act2],
      ),
    );
    expect(first.ok && first.rows[0]!.r).toMatchObject({ status: "accepted", authoritative_count: 6 });
    expect(again.ok && again.rows[0]!.r).toMatchObject({ status: "duplicate", authoritative_count: 6 });
    void act;
  });

  it("rejects a malformed call", async () => {
    const u = await createUser(pg);
    const s = await startSession(pg, u, BASE);
    const act = await activityId(pg, s.session_id, "istighfar");
    const bad = await attempt(
      pg,
      "select app_private.apply_counter_operation($1::uuid, $2::timestamptz, $3::uuid, '', 'delta', 1, null)",
      [u, BASE, act],
    );
    expect(bad).toMatchObject({ ok: false, error: { message: "VALIDATION_ERROR" } });
    const type = await attempt(
      pg,
      "select app_private.apply_counter_operation($1::uuid, $2::timestamptz, $3::uuid, 'x', 'multiply', 1, null)",
      [u, BASE, act],
    );
    expect(type).toMatchObject({ ok: false, error: { message: "VALIDATION_ERROR" } });
  });
});
