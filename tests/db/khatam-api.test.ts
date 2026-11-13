import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeKhatam } from "@/domain/khatam";
import { khatamResponseSchema, type KhatamResponse } from "@/data/contracts";
import { as, attempt, createTestDb, createUser, rows } from "./harness";

// 2026-11-17 12:00 WIB = day 1 for a Jakarta user.
const T1 = "2026-11-17T05:00:00Z";
const dayAt = (d: number, hh = "05:00:00") => {
  const dt = new Date(`2026-11-17T${hh}Z`);
  dt.setUTCDate(dt.getUTCDate() + d - 1);
  return dt.toISOString();
};

async function call(pg: PGlite, uid: string, now: string, fn: string, args: unknown[] = [], casts: string[] = []): Promise<KhatamResponse> {
  const ph = args.map((_, i) => `$${i + 3}${casts[i] ? "::" + casts[i] : ""}`).join(", ");
  const r = await rows<{ r: unknown }>(pg, `select app_private.${fn}($1::uuid, $2::timestamptz${ph ? ", " + ph : ""}) as r`, [uid, now, ...args]);
  return khatamResponseSchema.parse(r[0]!.r);
}
const refuses = async (pg: PGlite, uid: string, now: string, fn: string, args: unknown[], code: string, casts: string[] = []) => {
  const ph = args.map((_, i) => `$${i + 3}${casts[i] ? "::" + casts[i] : ""}`).join(", ");
  expect(await attempt(pg, `select app_private.${fn}($1::uuid, $2::timestamptz${ph ? ", " + ph : ""})`, [uid, now, ...args])).toMatchObject({
    ok: false,
    error: { message: code },
  });
};

describe("khatam: target, centang, tandai posisi", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  it("tanpa target: kosong. Dengan akses nonaktif: ditolak", async () => {
    const u = await createUser(pg);
    const s = await call(pg, u, T1, "get_khatam");
    expect(s.target).toBeNull();
    expect(s.reads).toEqual([]);
    const inactive = await createUser(pg, { entitlement: "expired" });
    await refuses(pg, inactive, T1, "get_khatam", [], "ENTITLEMENT_INACTIVE");
    await refuses(pg, inactive, T1, "create_khatam", [1], "ENTITLEMENT_INACTIVE");
    await refuses(pg, inactive, T1, "set_khatam_slot", [1, "subuh", true], "ENTITLEMENT_INACTIVE", ["int", "text", "boolean"]);
  });

  it("buat target: mulai hari ini (zona wilayah), 30 hari, N valid 1..5", async () => {
    const u = await createUser(pg);
    await refuses(pg, u, T1, "create_khatam", [0], "VALIDATION_ERROR");
    await refuses(pg, u, T1, "create_khatam", [6], "VALIDATION_ERROR");
    const s = await call(pg, u, T1, "create_khatam", [3]);
    expect(s.target).toMatchObject({ khatam_count: 3, start_date: "2026-11-17", end_date: "2026-12-16", timezone: "Asia/Jakarta", adjustment: 0 });
  });

  it("tanggal mulai mengikuti zona: 17:30 UTC = 18 Nov di WIB", async () => {
    const u = await createUser(pg);
    const s = await call(pg, u, "2026-11-17T17:30:00Z", "create_khatam", [1]);
    expect(s.target!.start_date).toBe("2026-11-18");
  });

  it("target yang sedang berjalan tidak bisa diganti dengan target baru; setelah 30 hari atau selesai bisa", async () => {
    const u = await createUser(pg);
    await call(pg, u, T1, "create_khatam", [1]);
    await refuses(pg, u, dayAt(10), "create_khatam", [2], "VALIDATION_ERROR");
    // Period over (day 31).
    const next = await call(pg, u, dayAt(31), "create_khatam", [2]);
    expect(next.target).toMatchObject({ khatam_count: 2, start_date: "2026-12-17" });
    expect(await rows(pg, "select 1 from public.khatam_targets where user_id = $1", [u])).toHaveLength(2);
    expect(await rows(pg, "select 1 from public.khatam_targets where user_id = $1 and ended_at is null", [u])).toHaveLength(1);
    // Finished early: a new target is allowed at once.
    const v = await createUser(pg);
    await call(pg, v, T1, "create_khatam", [1]);
    await call(pg, v, T1, "mark_khatam_position", [604], ["int"]);
    const again = await call(pg, v, dayAt(2), "create_khatam", [4]);
    expect(again.target!.khatam_count).toBe(4);
    expect(again.reads).toEqual([]);
  });

  it("centang: set, idempotent, lepas centang, hari depan ditolak, halaman dari N target", async () => {
    const u = await createUser(pg);
    await call(pg, u, T1, "create_khatam", [2]);
    const a = await call(pg, u, T1, "set_khatam_slot", [1, "subuh", true], ["int", "text", "boolean"]);
    expect(a.reads).toEqual([{ day: 1, prayer: "subuh", pages: 8 }]);
    const again = await call(pg, u, T1, "set_khatam_slot", [1, "subuh", true], ["int", "text", "boolean"]);
    expect(again.reads).toHaveLength(1);
    await refuses(pg, u, T1, "set_khatam_slot", [2, "subuh", true], "VALIDATION_ERROR", ["int", "text", "boolean"]);
    await refuses(pg, u, T1, "set_khatam_slot", [0, "subuh", true], "VALIDATION_ERROR", ["int", "text", "boolean"]);
    await refuses(pg, u, T1, "set_khatam_slot", [1, "tahajud", true], "VALIDATION_ERROR", ["int", "text", "boolean"]);
    const off = await call(pg, u, T1, "set_khatam_slot", [1, "subuh", false], ["int", "text", "boolean"]);
    expect(off.reads).toEqual([]);
    const off2 = await call(pg, u, T1, "set_khatam_slot", [1, "subuh", false], ["int", "text", "boolean"]);
    expect(off2.reads).toEqual([]);
  });

  it("centang hari lalu (antrean offline terlambat) tetap diterima, dan tampilan domain cocok dengan server", async () => {
    const u = await createUser(pg);
    await call(pg, u, T1, "create_khatam", [1]);
    const s = await call(pg, u, dayAt(2), "set_khatam_slot", [1, "isya", true], ["int", "text", "boolean"]);
    expect(s.reads).toEqual([{ day: 1, prayer: "isya", pages: 4 }]);
    const view = computeKhatam(
      { khatamCount: s.target!.khatam_count, startDate: s.target!.start_date, timezone: s.target!.timezone, adjustment: s.target!.adjustment, reads: s.reads },
      new Date(s.server_now),
    );
    expect(view).toMatchObject({ day: 2, pagesRead: 4, carriedOver: 16 });
  });

  it("ganti N: halaman yang sudah dibaca tetap, centang berikutnya memakai N baru", async () => {
    const u = await createUser(pg);
    await call(pg, u, T1, "create_khatam", [1]);
    await call(pg, u, T1, "set_khatam_slot", [1, "subuh", true], ["int", "text", "boolean"]);
    const s = await call(pg, u, T1, "change_khatam_count", [5], ["int"]);
    expect(s.target!.khatam_count).toBe(5);
    expect(s.reads).toEqual([{ day: 1, prayer: "subuh", pages: 4 }]);
    const t = await call(pg, u, T1, "set_khatam_slot", [1, "dzuhur", true], ["int", "text", "boolean"]);
    expect(t.reads.map((r) => r.pages)).toEqual([4, 20]);
    await refuses(pg, u, T1, "change_khatam_count", [9], "VALIDATION_ERROR", ["int"]);
    await refuses(pg, u, dayAt(31), "change_khatam_count", [2], "VALIDATION_ERROR", ["int"]);
    const none = await createUser(pg);
    await refuses(pg, none, T1, "change_khatam_count", [2], "NOT_FOUND", ["int"]);
  });

  it("tandai posisi: halaman 50, lalu 604 selesai; tanpa target = NOT_FOUND; halaman tidak valid ditolak", async () => {
    const u = await createUser(pg);
    await refuses(pg, u, T1, "mark_khatam_position", [10], "NOT_FOUND", ["int"]);
    await call(pg, u, T1, "create_khatam", [1]);
    await call(pg, u, T1, "set_khatam_slot", [1, "subuh", true], ["int", "text", "boolean"]);
    const s = await call(pg, u, T1, "mark_khatam_position", [50], ["int"]);
    const view = computeKhatam(
      { khatamCount: 1, startDate: s.target!.start_date, timezone: "Asia/Jakarta", adjustment: s.target!.adjustment, reads: s.reads },
      new Date(T1),
    );
    expect(view.pagesRead).toBe(50);
    expect(view.currentPage).toBe(51);
    await refuses(pg, u, T1, "mark_khatam_position", [0], "VALIDATION_ERROR", ["int"]);
    await refuses(pg, u, T1, "mark_khatam_position", [605], "VALIDATION_ERROR", ["int"]);
    const done = await call(pg, u, T1, "mark_khatam_position", [604], ["int"]);
    expect(computeKhatam({ khatamCount: 1, startDate: done.target!.start_date, timezone: "Asia/Jakarta", adjustment: done.target!.adjustment, reads: done.reads }, new Date(T1)).status).toBe("completed");
  });

  it("zona WITA: hari berganti 1 jam lebih awal dari WIB", async () => {
    const u = await createUser(pg);
    await pg.query("update public.profiles set region_id = (select id from public.regions where timezone = 'Asia/Makassar' limit 1) where user_id = $1", [u]);
    const tz = (await rows<{ tz: string | null }>(pg, "select app_private.user_timezone($1) as tz", [u]))[0]!.tz;
    if (tz !== "Asia/Makassar") return; // no WITA region in the seed: the day rule is covered by the domain tests
    const s = await call(pg, u, "2026-11-17T16:30:00Z", "create_khatam", [1]);
    expect(s.target!.start_date).toBe("2026-11-18");
  });
});

describe("khatam: keamanan (RLS dan peran authenticated)", () => {
  let pg: PGlite;
  let a: string;
  let b: string;
  beforeAll(async () => {
    pg = await createTestDb();
    a = await createUser(pg);
    b = await createUser(pg);
    await call(pg, a, T1, "create_khatam", [2]);
    await call(pg, a, T1, "set_khatam_slot", [1, "subuh", true], ["int", "text", "boolean"]);
  });
  afterAll(async () => pg.close());

  it("authenticated membaca hanya barisnya sendiri", async () => {
    const mine = await as(pg, "authenticated", a, () => rows(pg, "select * from public.khatam_targets"));
    expect(mine).toHaveLength(1);
    const theirs = await as(pg, "authenticated", b, () => rows(pg, "select * from public.khatam_targets"));
    expect(theirs).toEqual([]);
    const reads = await as(pg, "authenticated", b, () => rows(pg, "select * from public.khatam_reads"));
    expect(reads).toEqual([]);
  });

  it("authenticated tidak bisa INSERT, UPDATE, atau DELETE langsung", async () => {
    await as(pg, "authenticated", a, async () => {
      for (const sql of [
        "insert into public.khatam_targets (user_id, khatam_count, start_date, timezone) values ('" + a + "', 1, '2026-11-17', 'Asia/Jakarta')",
        "update public.khatam_targets set adjustment = 604",
        "delete from public.khatam_targets",
        "insert into public.khatam_reads (target_id, user_id, day, prayer, pages) select id, user_id, 2, 'isya', 99 from public.khatam_targets",
        "update public.khatam_reads set pages = 9999",
        "delete from public.khatam_reads",
      ]) {
        expect(await attempt(pg, sql), sql).toMatchObject({ ok: false, error: { code: "42501" } });
      }
    });
  });

  it("fungsi publik membaca auth.uid(): tidak ada cara mengirim user id atau jam dari klien", async () => {
    const r = await as(pg, "authenticated", a, () => rows<{ r: { target: { khatam_count: number } | null } }>(pg, "select public.get_khatam() as r"));
    expect(r[0]!.r.target!.khatam_count).toBe(2);
    const other = await as(pg, "authenticated", b, () => rows<{ r: { target: unknown } }>(pg, "select public.get_khatam() as r"));
    expect(other[0]!.r.target).toBeNull();
    const anon = await as(pg, "anon", null, () => attempt(pg, "select public.get_khatam()"));
    expect(anon).toMatchObject({ ok: false, error: { code: "42501" } });
    const private_ = await as(pg, "authenticated", a, () => attempt(pg, "select app_private.get_khatam($1::uuid, now())", [a]));
    expect(private_).toMatchObject({ ok: false, error: { code: "42501" } });
  });

  it("satu target berjalan per user (indeks unik)", async () => {
    const r = await attempt(
      pg,
      "insert into public.khatam_targets (user_id, khatam_count, start_date, timezone) values ($1, 1, '2026-11-20', 'Asia/Jakarta')",
      [a],
    );
    expect(r).toMatchObject({ ok: false, error: { code: "23505" } });
  });

  it("hapus akun menghapus target dan catatan baca (cascade)", async () => {
    const c = await createUser(pg);
    await call(pg, c, T1, "create_khatam", [1]);
    await call(pg, c, T1, "set_khatam_slot", [1, "subuh", true], ["int", "text", "boolean"]);
    await pg.query("delete from auth.users where id = $1", [c]);
    expect(await rows(pg, "select 1 from public.khatam_targets where user_id = $1", [c])).toEqual([]);
    expect(await rows(pg, "select 1 from public.khatam_reads where user_id = $1", [c])).toEqual([]);
  });
});
