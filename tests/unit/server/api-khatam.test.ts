import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError, khatamResponseSchema } from "@/data/contracts";
import { computeKhatam } from "@/domain/khatam";
import { createApiEnv, type ApiEnv, type TestBrowser } from "./api-harness";

const view = (s: ReturnType<typeof khatamResponseSchema.parse>) =>
  computeKhatam(
    { khatamCount: s.target!.khatam_count, startDate: s.target!.start_date, timezone: s.target!.timezone, adjustment: s.target!.adjustment, reads: s.reads },
    new Date(s.server_now),
  );
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "no-error";
  } catch (e) {
    return e instanceof ApiError ? e.code : `other:${String(e)}`;
  }
};

describe("API khatam (/api/v1/khatam)", () => {
  let env: ApiEnv;
  let b: TestBrowser;
  beforeAll(async () => {
    env = await createApiEnv("2026-11-17T12:00:00+07:00");
    b = await env.onboarded("khatam@ngajigaes.test");
  });
  afterAll(async () => env.close());

  it("alur lengkap lewat repository HTTP: buat, centang, tandai, ganti N, tampilan sama dengan domain", async () => {
    const d = b.data();
    expect((await d.khatam.getKhatam()).target).toBeNull();
    const created = await d.khatam.createTarget({ khatam_count: 2 });
    expect(created.target).toMatchObject({ khatam_count: 2, start_date: "2026-11-17", timezone: "Asia/Jakarta" });
    const t = await d.khatam.setSlot({ day: 1, prayer: "subuh", done: true });
    expect(t.reads).toEqual([{ day: 1, prayer: "subuh", pages: 8 }]);
    const m = await d.khatam.markPosition({ page: 100 });
    expect(view(m)).toMatchObject({ pagesRead: 100, currentPage: 101, khatamNumber: 1, dueToday: 40 });
    const c = await d.khatam.changeTarget({ khatam_count: 5 });
    expect(view(c)).toMatchObject({ pagesRead: 100, totalPages: 3020 });
  });

  it("hari berikutnya: sisa dari hari sebelumnya tampil, tanpa reset", async () => {
    await env.setNow("2026-11-20T12:00:00+07:00");
    const s = await b.data().khatam.getKhatam();
    const v = view(s);
    expect(v.day).toBe(4);
    expect(v.pagesRead).toBe(100);
    expect(v.status).toBe("active");
    await env.setNow("2026-11-17T12:00:00+07:00");
  });

  it("validasi: N, hari, halaman di luar batas = 400; tanpa masuk = 401; tanpa Origin = 403", async () => {
    const d = b.data();
    expect(await code(d.khatam.setSlot({ day: 2, prayer: "subuh", done: true }))).toBe("VALIDATION_ERROR");
    expect(await code(d.khatam.markPosition({ page: 605 }))).toBe("VALIDATION_ERROR");
    expect(await code(d.khatam.changeTarget({ khatam_count: 6 }))).toBe("VALIDATION_ERROR");
    expect(await code(d.khatam.createTarget({ khatam_count: 1 }))).toBe("VALIDATION_ERROR"); // still running
    const anon = env.browser();
    expect((await anon.raw("/khatam")).status).toBe(401);
    const noOrigin = await b.raw("/khatam/slots", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ day: 1, prayer: "isya", done: true }),
    });
    expect(noOrigin.status).toBe(403);
  });

  it("jawaban tidak di-cache dan tidak memuat data user lain", async () => {
    const res = await b.raw("/khatam");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const other = await env.onboarded("khatam-other@ngajigaes.test");
    expect((await other.data().khatam.getKhatam()).target).toBeNull();
  });

  it("akses tidak aktif ditolak", async () => {
    const x = await env.signIn("khatam-expired@ngajigaes.test");
    await env.db.exec("update public.access_entitlements set status = 'expired' where email_normalized = $1", ["khatam-expired@ngajigaes.test"]);
    expect(await code(x.data().khatam.getKhatam())).toBe("ENTITLEMENT_INACTIVE");
  });
});
