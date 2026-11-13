import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { positionAfterMark, PRAYERS, slotPages, totalPages } from "@/domain/khatam";
import { createTestDb, createUser, rows } from "./harness";

/** The SQL rules must give the same numbers as src/domain/khatam. */
describe("khatam: aturan SQL sama dengan domain", () => {
  let pg: PGlite;
  let uid: string;
  beforeAll(async () => {
    pg = await createTestDb();
    uid = await createUser(pg);
  });
  afterAll(async () => pg.close());

  it("khatam_slot_pages sama dengan slotPages untuk semua N, hari, dan waktu salat", async () => {
    for (let n = 1; n <= 5; n++) {
      for (let day = 1; day <= 30; day++) {
        for (const p of PRAYERS) {
          const r = await rows<{ v: number }>(pg, "select app_private.khatam_slot_pages($1, $2, $3) as v", [n, day, p]);
          expect(r[0]!.v, `N=${n} day=${day} ${p}`).toBe(slotPages(n, day, p));
        }
      }
    }
  });

  it("khatam_slot_pages menolak masukan di luar batas", async () => {
    for (const args of [[0, 1, "subuh"], [6, 1, "subuh"], [1, 0, "subuh"], [1, 31, "subuh"], [1, 1, "tahajud"]] as const) {
      await expect(pg.query("select app_private.khatam_slot_pages($1, $2, $3)", [...args])).rejects.toThrow("VALIDATION_ERROR");
    }
  });

  it("mark_khatam_position sama dengan positionAfterMark (rentang posisi dan halaman)", async () => {
    const now = "2026-11-17T05:00:00Z";
    for (const n of [1, 2, 5]) {
      const total = totalPages(n);
      await pg.query("update public.khatam_targets set ended_at = now() where user_id = $1 and ended_at is null", [uid]);
      await pg.query("select app_private.create_khatam($1::uuid, $2::timestamptz, $3)", [uid, now, n]);
      const currents = [0, 1, 3, 4, 100, 301, 302, 303, 600, 603, 604, 605, 606, 906, 1208, total - 1, total].filter((c) => c <= total);
      for (const cur of currents) {
        for (const page of [1, 3, 4, 5, 90, 302, 303, 600, 604]) {
          await pg.query("update public.khatam_targets set adjustment = $2 where user_id = $1 and ended_at is null", [uid, cur]);
          const r = await rows<{ s: { target: { adjustment: number } } }>(
            pg,
            "select app_private.mark_khatam_position($1::uuid, $2::timestamptz, $3) as s",
            [uid, now, page],
          );
          expect(r[0]!.s.target.adjustment, `N=${n} cur=${cur} page=${page}`).toBe(positionAfterMark(cur, page, n));
        }
      }
    }
  });
});
