import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attempt, createTestDb, rows } from "./harness";

describe("admin audit log is append only (PRD §18.2)", () => {
  let pg: PGlite;
  let id: string;
  beforeAll(async () => {
    pg = await createTestDb();
    const actor = (await rows<{ id: string }>(pg, "insert into auth.users (email) values ('a@ngajigaes.test') returning id::text"))[0]!.id;
    id = (
      await rows<{ id: string }>(
        pg,
        "select app_private.admin_audit($1::uuid, 'job', 'x', 'job.requeued', null, null, 'alasan uji panjang', null, now())::text as id",
        [actor],
      )
    )[0]!.id;
  }, 60_000);
  afterAll(async () => pg.close());

  it("refuses UPDATE, DELETE and TRUNCATE, even for the database owner", async () => {
    for (const sql of [
      "update public.admin_audit_logs set reason = 'ubah'",
      "delete from public.admin_audit_logs",
      "truncate public.admin_audit_logs",
    ]) {
      const r = await attempt(pg, sql);
      expect(r, sql).toMatchObject({ ok: false, error: { message: "AUDIT_IMMUTABLE" } });
    }
    expect(await rows(pg, "select 1 from public.admin_audit_logs where id = $1::uuid", [id])).toHaveLength(1);
  });

  it("service_role holds no UPDATE, DELETE or TRUNCATE privilege on it", async () => {
    const g = await rows<{ p: string }>(
      pg,
      `select privilege_type as p from information_schema.role_table_grants
       where table_name = 'admin_audit_logs' and grantee in ('service_role', 'authenticated', 'anon')
         and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')`,
    );
    expect(g).toEqual([]);
  });
});

describe("PRIV-01: admin SQL never reads per-user worship or excused data", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  }, 60_000);
  afterAll(async () => pg.close());

  const WORSHIP = ["night_sessions", "session_activities", "counter_operations", "session_audit_logs", "session_excuses", "quran_reading_progress", "session_quran_completions"];

  const adminFns = async () =>
    rows<{ name: string; src: string }>(
      pg,
      `select p.proname as name, pg_get_functiondef(p.oid) as src from pg_proc p
       where p.pronamespace = 'app_private'::regnamespace and p.proname like 'admin\\_%'`,
    );

  it("finds the admin functions at all", async () => {
    expect((await adminFns()).length).toBeGreaterThan(40);
  });

  it("no admin function mentions excused days, in any spelling", async () => {
    for (const f of await adminFns()) {
      expect(f.src.toLowerCase(), f.name).not.toMatch(/excus|berhalangan/);
    }
  });

  it("only admin_aggregates touches worship tables, and only to count (no per-user column leaves it)", async () => {
    for (const f of await adminFns()) {
      const hit = WORSHIP.filter((t) => f.src.includes(t));
      if (f.name === "admin_aggregates") continue;
      expect(hit, f.name).toEqual([]);
    }
    const agg = (await adminFns()).find((f) => f.name === "admin_aggregates")!;
    // It reads the 'completed' status only, and never selects a user id into the result.
    expect(agg.src).toMatch(/status = 'completed'/);
    expect(agg.src).not.toMatch(/'user_id'/);
  });

  it("no admin function returns a phone, a hash of one, a password hash, a token or an MFA secret", async () => {
    // admin_mfa_get is called by the server only, to check a code. No route returns its result (admin-api test scans the HTTP side).
    for (const f of (await adminFns()).filter((x) => x.name !== "admin_mfa_get")) {
      const body = f.src.toLowerCase();
      // A key in the result named after a secret, or a whole purchase_orders / credentials row turned into json.
      expect(body, f.name).not.toMatch(/'(customer_phone_hash|phone_hash|phone|password_hash|token_hash|secret_enc|payload_encrypted)'/);
      expect(body, f.name).not.toMatch(/to_jsonb\((o|po|c|cr)\)/);
    }
  });

  it("the audit text of a phone check never holds the number or its hash (checked in admin-staff.test.ts too)", async () => {
    const fn = (await adminFns()).find((f) => f.name === "admin_order_phone_check")!;
    expect(fn.src).toMatch(/'match', v_match/);
    expect(fn.src).not.toMatch(/p_phone_hash[^;]*admin_audit|admin_audit[^;]*p_phone_hash/);
  });
});
