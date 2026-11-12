# Sesi T3a (Agen B lama, Sonnet): skema database, RLS, fungsi SQL, test DB

Branch: `claude/peaceful-thompson-lwndtd` · Basis: `origin/main` @ `b43ce59` · Tanggal: 2026-11-12
Brief: `docs/briefs/T3a.md`. Scope file: `supabase/**`, `tests/db/**`, `scripts/db-*.ts`, baris STATUS "Supabase schema + RLS". Tidak ada file di `src/**` yang disentuh.

## Ringkasan: REAL vs SIMULATED

| Bagian                                                                                               | Status                        | Catatan                                                                               |
| ---------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| Migrations 8 file (35 tabel PRD §17, constraint, index, RLS, grant, fungsi)                          | REAL                          | Dijalankan dari nol dan dua kali di PostgreSQL sungguhan (PGlite, bukan mock)         |
| Fungsi `apply_counter_operation`, `ensure_active_session`, `set_checklist`, `has_active_entitlement` | REAL                          | Lulus kasus yang sama dengan `applyOperation` di `src/domain` (uji paritas, 9 kasus)  |
| Progres level, status sesi, audit koreksi di SQL                                                     | REAL                          | Diuji sampai 39 malam (Level 1 ke 2 ke 3, journey selesai)                            |
| Seed dari `content/amalan.v1.json`                                                                   | REAL                          | Dibangkitkan script, teks Arab byte demi byte, diuji                                  |
| Regions di seed                                                                                      | SIMULATED                     | Tiga wilayah berlabel DEMO                                                            |
| Database                                                                                             | PGlite (WASM), bukan Supabase | Docker tidak ada di container. Lihat "Belum diverifikasi"                             |
| Auth Supabase (GoTrue), `auth.users`                                                                 | STUB                          | Tabel `auth.users` dan `auth.uid()` palsu untuk test (`supabase/stubs/auth_stub.sql`) |
| `supabase/config.toml`                                                                               | TIDAK DIVALIDASI              | CLI belum pernah membacanya                                                           |

## Pilihan DB lokal

PGlite 0.5.16 (PostgreSQL 18 dalam WASM, jalan di dalam proses Vitest). Alasan:

- `docker info` gagal: tidak ada daemon Docker, jadi `supabase start` tidak mungkin.
- PostgreSQL 16 native memang terpasang di container, tetapi tidak ada jaminan ada di mesin lain atau CI. PGlite hanya butuh `pnpm install`, jalan di `pnpm test`, dan mendukung role, RLS, `SECURITY DEFINER`, dan `SET ROLE`.
- Stub `auth` meniru `auth.uid()` Supabase (membaca `request.jwt.claims`).
  Migrations adalah file yang sama dengan yang akan dijalankan `supabase db push`.

## Yang dikerjakan

1. **Migrations** (`supabase/migrations/2026111300xxxx_*.sql`): foundation, access, levels, tracking, quran_notifications, system, functions, security. Semua `if not exists` / `create or replace` / `drop policy if exists`, jadi aman diulang.
2. **Keamanan** (PRD §18): RLS aktif di semua 35 tabel. `authenticated` hanya punya SELECT (baris sendiri, atau konten berbayar dengan entitlement aktif) dan EXECUTE di 4 RPC. Tidak ada INSERT/UPDATE/DELETE/TRUNCATE untuk `authenticated` dan `anon`. Tabel backend-only tanpa grant sama sekali. Kolom rahasia (`push_subscriptions.p256dh/auth/endpoint`, `access_entitlements.email/order`) tidak bisa dibaca. Semua fungsi `SECURITY DEFINER` mengunci `search_path`. Logika ada di schema `app_private` (tidak terekspos), `public.*` hanya pembungkus tipis dengan `auth.uid()` dan `now()` dari server.
3. **Fungsi**:
   - `apply_counter_operation(p_session_activity_id, p_client_operation_id, p_op_type, p_delta, p_client_recorded_at)`: idempoten per (user, operation id), tidak negatif, `set_zero`, jam klien > 5 menit di depan diganti jam server, ditolak di luar jendela koreksi (`SESSION_LOCKED`), duplikat mengembalikan hitungan terkini, membuat audit untuk `set_zero` dan koreksi setelah cutoff. Hasil berbentuk `{operation_id, status, authoritative_count, target, completed, updated_at, error_code?}`.
   - `ensure_active_session()`: kunci sesi = tanggal Subuh lokal (cutoff 12.00 dari `app_settings`), zona dan level dibekukan, snapshot aktivitas disalin dari konfigurasi level.
   - `set_checklist(activity, checked, version)`: concurrency optimistik. `VERSION_CONFLICT` membawa nilai server di `detail`.
   - `has_active_entitlement(uid)`: hanya menjawab untuk pemanggil sendiri.
   - Internal: `compute_session_status`, `refresh_session`, `recompute_progression` (level hanya bertambah, berlaku mulai sesi berikutnya).
4. **Seed**: `scripts/db-seed.ts` (`pnpm db:seed`, `pnpm db:seed --check`) membangkitkan `supabase/seed.sql` dari `content/amalan.v1.json` + config provisional. Transliterasi dan terjemahan tetap `null`, `source_classification` tetap `unverified`.
5. **Test DB** (`pnpm test:db`, ikut `pnpm test`): 123 test di 5 file.

## Keputusan teknis

| #      | Keputusan                                                                                                                                                                                                                                                               | Alasan                                                                                                                                                                                                                                                             | Alternatif ditolak                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| T3a-1  | PGlite + stub `auth`, bukan Docker atau PG native                                                                                                                                                                                                                       | Lihat "Pilihan DB lokal"                                                                                                                                                                                                                                           | Menunggu Docker                                                |
| T3a-2  | Aturan bisnis di `app_private.*(…, p_now)`, RPC publik tanpa parameter waktu                                                                                                                                                                                            | Test mengatur waktu tanpa membuka celah: klien tidak bisa mengirim "sekarang" palsu. GUC seperti `app.test_now` dapat di-SET oleh user, jadi ditolak                                                                                                               | Parameter waktu di RPC publik; GUC waktu                       |
| T3a-3  | Kode error = `message` exception (`P0001`): `ENTITLEMENT_INACTIVE`, `SESSION_LOCKED`, `VERSION_CONFLICT`, `NOT_FOUND`, `VALIDATION_ERROR`, `LOCATION_REQUIRED`, `UNAUTHENTICATED`. `detail` berisi JSON                                                                 | Kode stabil yang bisa dipetakan T3b ke `{error:{code}}`                                                                                                                                                                                                            | SQLSTATE kustom                                                |
| T3a-4  | `apply_counter_operation` mengembalikan baris `rejected` (bukan exception) untuk `SESSION_LOCKED`, `INVALID_DELTA`, `ACTIVITY_NOT_FOUND`. Exception hanya untuk entitlement, auth, input rusak                                                                          | Sama dengan `applyOperation` (S2-7): satu batch tidak gagal total                                                                                                                                                                                                  | Exception untuk semua                                          |
| T3a-5  | Aktivitas milik user lain dijawab seperti tidak ada (`ACTIVITY_NOT_FOUND` / `NOT_FOUND`)                                                                                                                                                                                | Tidak membocorkan keberadaan id                                                                                                                                                                                                                                    | `FORBIDDEN`                                                    |
| T3a-6  | Kolom tambahan di luar PRD §17: `session_activities.user_id`, `user_level_state.level_2_effective_from` dan `level_3_effective_from` (dengan `effective_from_session_key` jadi kolom turunan), `level_activity_config.title_override`, `activity_definitions.quran_ref` | `user_id`: kebijakan baca = satu kolom. Dua tanggal efektif: model domain S2 menyimpan satu tanggal per level, satu kolom tidak cukup. `title_override`: "Salat Witir" vs "Salat Witir (1 rakaat)" beda per level. `quran_ref`: tautan Al-Waqi'ah dan At-Talaq 2-3 | Mengubah JSON owner                                            |
| T3a-7  | Konten berbayar (level, teks Arab, wilayah, Qur'an) hanya terbaca dengan entitlement aktif. Data milik sendiri terbaca dengan `user_id = auth.uid()` saja                                                                                                               | PRD §18.4: policy baca = `user_id = auth.uid()`; konten berbayar tidak boleh bocor ke akun tanpa akses                                                                                                                                                             | Konten terbuka untuk semua yang login                          |
| T3a-8  | Satu definisi `tahlil` dipakai di malam dan post-Fajr, dibedakan oleh kolom `phase`                                                                                                                                                                                     | `activity_definitions.activity_key UNIQUE`                                                                                                                                                                                                                         | Dua key                                                        |
| T3a-9  | Seed memakai `on conflict do update` untuk konten owner dan `do nothing` untuk `levels` dan `app_settings` (kecuali judul level)                                                                                                                                        | Menjalankan seed ulang tidak menimpa perubahan admin atas nilai provisional                                                                                                                                                                                        | Selalu timpa                                                   |
| T3a-10 | Teks seed memakai dollar-quote dengan tag yang dipilih agar tidak muncul di teks                                                                                                                                                                                        | Teks Arab tidak melewati escaping apa pun                                                                                                                                                                                                                          | Escape manual                                                  |
| T3a-11 | `has_active_entitlement(uid)` publik menjawab false untuk uid orang lain                                                                                                                                                                                                | Tidak jadi alat menyelidiki status akses orang                                                                                                                                                                                                                     | Membuka untuk semua uid                                        |
| T3a-12 | `tsx` ditambah sebagai devDependency, script `db:seed` dan `test:db` di `package.json`, `tests/db/**` masuk `vitest.config.ts` dengan `testTimeout` 30 dtk                                                                                                              | Menjalankan script TS tanpa build. DB test ikut `pnpm test`                                                                                                                                                                                                        | `node --experimental-strip-types` (impor tanpa ekstensi gagal) |

## Dependency ditambah

| Paket                  | Jenis | Alasan                                                      |
| ---------------------- | ----- | ----------------------------------------------------------- |
| `@electric-sql/pglite` | dev   | PostgreSQL di dalam proses untuk test DB (Docker tidak ada) |
| `tsx`                  | dev   | Menjalankan `scripts/db-seed.ts`                            |

## Hasil test (apa adanya)

Dijalankan di akhir sesi pada branch ini:

```
pnpm typecheck        -> lolos (0 error)
pnpm lint             -> lolos
pnpm test --coverage  -> Test Files 23 passed (23), Tests 456 passed (456)
                         (333 dari main + 123 test DB baru, coverage domain/offline tidak berubah)
pnpm test:db          -> 5 file, 123 passed (schema 14, seed 14, security 56, counter 17, session 22)
pnpm db:seed --check  -> supabase/seed.sql is up to date.
pnpm audit --prod     -> No known vulnerabilities found
pnpm test:e2e         -> tidak dijalankan (tidak ada perubahan di src/ atau UI)
```

ID yang dicakup: SECURITY-01 (tabel milik sendiri x8, akses by id, operasi, kunci push), SECURITY-02 (5 keadaan entitlement x 3 mutasi, data lama utuh), SECURITY-03 (UPDATE langsung `night_sessions.status` dan 13 mutasi lain ditolak `42501`), DZIKIR-03 dan DZIKIR-05 lewat SQL, LEVEL-01 sampai LEVEL-05, SESSION-01, -03, -04, -05, unik `(user_id, fajr_local_date)`, seed dzikir 400/1.550/1.863 dan rakaat 5/9/11.

- Uji paritas: 9 skenario dijalankan lewat `applyOperation` (domain) dan `apply_counter_operation` (SQL), hasil dibandingkan per field (status, hitungan, target, completed, error).
- **Dua bug nyata ditemukan test** dan sudah diperbaiki: (1) fungsi baru otomatis dapat EXECUTE untuk `PUBLIC`, jadi `authenticated` bisa memanggil fungsi apa pun yang dibuat kemudian. Perlu `alter default privileges revoke execute on functions from public` tanpa `in schema`. (2) `RAISE ... detail = NULL` gagal, jadi `fail()` memberi `detail` hanya jika ada.
- Urutan TDD tidak murni red-green: migrations ditulis dulu, test sesudahnya.

## Belum diverifikasi

- **Tidak dijalankan di Supabase sungguhan** (tidak ada Docker, tidak ada proyek). PGlite = PostgreSQL 18, Supabase memakai 15 atau 17. Fitur yang dipakai standar (RLS, `SECURITY DEFINER`, kolom turunan, `jsonb_strip_nulls`), tetapi belum dibuktikan di sana. Perbedaan yang mungkin: privilege bawaan role, `auth.users` asli punya banyak kolom, PostgREST memetakan error.
- `supabase/config.toml` belum dibaca CLI.
- Konkurensi: PGlite satu koneksi, jadi dua request bersamaan untuk operasi yang sama tidak diuji. Mekanismenya `FOR UPDATE` pada baris aktivitas ditambah `UNIQUE (user_id, client_operation_id)`.
- Kinerja: tidak diukur. Index disiapkan untuk dashboard, kalender, dan antrean job.
- RLS pada tabel konten memanggil `public.has_active_entitlement` per query. Murah untuk satu user, belum diukur dengan banyak baris Qur'an.

## Sisa pekerjaan untuk T3b dan setelahnya

- Fungsi baca (dashboard, kalender, laporan, statistik, riwayat) dan missed turunan untuk tanggal tanpa baris sesi (PRD §10.4). Belum ada di SQL; domain `buildCalendar` masih jadi acuan.
- Fungsi tulis yang belum ada: excuse (satu tanggal dan rentang, batal), `PUT /me/location`, onboarding dan `program_start_date`, preferensi, profil, progres Qur'an, preferensi notifikasi, perangkat.
- Login perangkat ke-4 (PRD §24.1): butuh token login tertunda sekali pakai (10 menit). Tidak ada tabelnya di §17, perlu keputusan (tabel baru atau `rate_limits`/`jobs`).
- Pemetaan id: mock memakai `${sessionKey}~${phase}:${key}`, DB memakai `uuid` per `session_activities.id`. T3b menerjemahkan di lapisan HTTP.
- Autentikasi: `auth.users` dan penautan entitlement saat OTP diverifikasi (T3b), webhook dan fulfillment (T5), job runner (T6).
- Kebijakan baca konten berbayar bergantung pada `public.has_active_entitlement`. Jika T3b memakai service role untuk semua pembacaan, kebijakan ini tidak terpakai tetapi tetap melindungi jika klien Supabase dipakai langsung.

## Pertanyaan untuk owner

Tidak ada yang baru. Nilai dan aturan yang masih provisional tersimpan di `app_settings` dan `levels` dengan `provisional = true`.

## Permintaan ke orchestrator

1. **Ketidaksesuaian PRD v1.2.3 dengan mock S4a.** PRD §24.1 sekarang: login perangkat ke-4 DITOLAK dengan pilihan mengeluarkan satu perangkat (tanpa pengeluaran otomatis). Mock S4a (`src/data/mock/auth.ts`, `devicesToRevoke`) masih mengeluarkan perangkat terlama otomatis. T1 atau tugas khusus perlu menyelaraskannya. Saya tidak mengubah `src/**`.
2. Kode error dari SQL ada di `message` (lihat T3a-3). T3b perlu memetakan `VERSION_CONFLICT.detail` (JSON `{checked, version}`) ke `details.server` yang dipakai `createLayerSender` di `src/offline/sender.ts`.
3. `package.json` dan `pnpm-lock.yaml` berubah (dua devDependency, dua script). `vitest.config.ts` berubah (include `tests/db`, timeout). Mohon jadi perhatian saat merge dengan T1, T2, T4.
4. Pelajaran umum untuk T5 dan T6: setiap migration baru yang membuat fungsi atau tabel otomatis aman (default privileges sudah dicabut), tetapi tetap tambahkan `grant execute` eksplisit untuk RPC yang memang untuk user, dan ulangi `enable row level security` untuk tabel baru (loop di migration security hanya menutup tabel yang ada saat itu). Test `schema.test.ts` akan gagal jika ada tabel tanpa RLS.
