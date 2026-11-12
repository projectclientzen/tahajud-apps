# Brief T3b (agen b lama, Sonnet, effort high): API v1, data layer live, auth server

Basis: branch integrasi `claude/great-cerf-mfce32` (berisi T3a milikmu). Jalan paralel dengan T1b (perbaikan e2e UI), U1a/U1b (UI/UX), T4c (koordinat).
Baca: `CLAUDE.md`, PRD v1.2.3 §16.4, §18, §19, §21.3, §24.1, `docs/sessions/T3a.md` (catatanmu: kode error SQL, fungsi baca yang belum ada, token login tertunda), `src/data/contracts.ts`, `src/data/repositories.ts`, `src/offline/sender.ts`.

## Kepemilikan file
Tulis: `src/app/api/v1/**` (KECUALI `webhooks/`), `src/server/db/**`, `src/server/auth/**`, `src/server/api/**`, `src/data/http/**`, `supabase/migrations/` (file BARU saja, prefix `20261114*`), `supabase/seed.sql` jika perlu, `tests/db/**`, `tests/unit/server/api-*`, `tests/e2e/t3b-*`, `docs/sessions/T3b.md`, baris STATUS Backend.
Jangan sentuh: `src/components/**`, `src/app/` selain `api/v1`, `src/data/mock/**`, `src/domain/**` (minta lewat file sesi), `src/server/prayer|push/**`, `content/**`.

## Tugas
1. Fungsi SQL baca yang belum ada: dashboard, kalender (missed derived dari `program_start_date`), laporan 7/30/90, statistik amalan, session history; excuse (tunggal + rentang, batal dalam jendela koreksi); profil/location/onboarding complete; preferensi notifikasi; Qur'an progress; perangkat (list, revoke) + tabel/fungsi token login tertunda (10 menit, sekali pakai) untuk batas 3 perangkat.
2. Route handler `/api/v1/**` sesuai PRD §19: validasi Zod dari `src/data/contracts.ts`, auth (Supabase JWT; di test pakai stub auth yang sama dengan T3a), entitlement aktif, `Cache-Control: private, no-store`, cek header `Origin` untuk mutasi, format error `{error:{code,message,details}}`, pemetaan kode error SQL (ENTITLEMENT_INACTIVE, SESSION_LOCKED, VERSION_CONFLICT + detail JSON) ke `details.server` yang dibaca `src/offline/sender.ts`.
3. `src/data/http/**`: implementasi `DataLayer` live memanggil `/api/v1`, menggantikan stub.
4. Server DB client: koneksi Postgres via env (`DATABASE_URL`), dengan adapter PGlite untuk test. Tanpa kredensial nyata di repo.
5. Test: SECURITY-01/02/03 lewat HTTP, AUTH-05, AUTH-06 (rate limit server, respons generik), DZIKIR-03/05 lewat HTTP, cek Origin, Cache-Control. E2E `t3b-*`: alur Level 1 dengan `NEXT_PUBLIC_DATA_MODE=live` melawan DB PGlite/lokal jika memungkinkan di container; jika tidak, catat sebagai keterbatasan dan uji di level integrasi HTTP.

## Acceptance
Gerbang penuh 0 failed. Tidak ada secret di repo. Laporan `docs/sessions/T3b.md`. Push ke branch sesi, lapor ke orchestrator.
