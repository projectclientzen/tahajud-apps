# Brief T3a (Agen B lama, Sonnet): skema database, RLS, fungsi SQL, test DB

Bagian pertama T3, dimajukan karena file-nya tidak beririsan dengan T1, T2, T4 yang sedang jalan. T3b (route handler `/api/v1`, `src/data/http`, Supabase Auth server) dikerjakan setelah T1 dan T2 di-merge.
Baca: `CLAUDE.md`, `docs/PLAN.md` (baris T3), PRD v1.2.3 §10-12, §17, §18, §24.1, §24.4, `docs/AUDIT-PRD-v1.1.md` (SEC-03, SEC-13, BUG-01, BUG-02, BUG-10).

## Kepemilikan file
Tulis: `supabase/**` (config, migrations, seed, tests), `tests/db/**`, `scripts/db-*.ts`, `docs/sessions/T3a.md`, baris STATUS "Supabase schema + RLS".
Boleh tambah dependency (mis. `@electric-sql/pglite`, `supabase` CLI) dengan alasan. Jangan sentuh `src/**` sama sekali. Jika butuh perubahan di `src/domain` atau `src/data`, tulis di "Permintaan ke orchestrator".

## Tugas
1. Tentukan DB lokal yang jalan di container: Supabase CLI + Docker (`supabase start`) jika daemon Docker dan pull image berhasil; jika tidak, PGlite dengan stub schema `auth` (`auth.users`, `auth.uid()` membaca `request.jwt.claims`). Catat pilihan + alasan.
2. Migrations semua tabel PRD v1.2.3 §17 (17.1-17.7), constraint unik (user_id+fajr_local_date, (user_id, client_operation_id), provider+external_event_id, region_id+local_date+provider, purchase_order_id+entitlement_type, dedupe_key), index yang dibutuhkan query dashboard/kalender.
3. RLS aktif di semua tabel privat. Policy SELECT `user_id = auth.uid()`. REVOKE INSERT/UPDATE/DELETE dari `authenticated` dan `anon` di tabel tracking dan backend-only (PRD §18.3). Mutasi lewat fungsi `SECURITY DEFINER` dengan `search_path` terkunci yang memeriksa kepemilikan + entitlement aktif.
4. Fungsi SQL: `apply_counter_operation(...)` idempoten, setara `applyOperation` di `src/domain/dhikr/server.ts` (tidak negatif, `set_zero`, clamp jam klien 5 menit, tolak di luar jendela koreksi, duplikat mengembalikan hitungan terkini); `ensure_active_session`; `set_checklist` dengan `version` (optimistic concurrency); `has_active_entitlement(uid)`.
5. Seed: levels + activity config dari `content/amalan.v1.json` lewat script (bukan salin manual), regions contoh berlabel DEMO.
6. Test DB (Vitest): SECURITY-01 (user A tidak bisa SELECT sesi B), SECURITY-02 (entitlement tidak aktif → fungsi mutasi ditolak, data lama tetap), SECURITY-03 (UPDATE `night_sessions.status` langsung oleh `authenticated` ditolak), DZIKIR-03 dan DZIKIR-05 lewat SQL (hasil sama dengan test domain), unik `(user_id, fajr_local_date)`, seed total dzikir 400/1.550/1.863.

## Acceptance criteria
Semua test di atas lolos via `pnpm test` (atau script `pnpm test:db` yang ikut di CI lokal), `pnpm typecheck && pnpm lint && pnpm audit --prod` lolos, migrations bisa dijalankan dari nol dua kali (idempoten di DB baru), tidak ada secret di repo. Laporan `docs/sessions/T3a.md` dengan output test asli.
