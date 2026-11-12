# Sesi T3b (Sonnet): API v1, data layer live, auth server

Branch: `claude/t3b-api-v1` di atas `main` @ `0e5cfd2` (berisi T3a). Tanggal: 2026-11-12.
Brief: `docs/briefs/T3b.md`. Baca juga: `docs/sessions/T3a.md`, `docs/sessions/T1b.md` (kontrak auth: `VerifyOtpResult`, `completePendingLogin`, `PENDING_LOGIN_INVALID`, batas 3 perangkat).

## Ringkasan: REAL vs SIMULATED vs BLOCKED

| Bagian | Status | Catatan |
|---|---|---|
| Fungsi SQL baca + tulis (3 migration baru) | REAL | Dijalankan dari nol dan dua kali di PostgreSQL sungguhan (PGlite). Paritas dengan `src/domain`: kalender, hitungan status, completion rate, `selectPeriod`, statistik amalan |
| 32 route `/api/v1` + catch-all JSON 404 | REAL | Diuji lewat HTTP (file route asli, tanpa mock antara request dan database) dan lewat e2e live di browser |
| `DataLayer` + `AuthRepository` HTTP | REAL | Menggantikan stub. Setiap jawaban dicek ke skema Zod bersama sebelum sampai UI |
| Auth: OTP, cookie, perangkat, rate limit | REAL (logic + SQL) | Provider `local` (kode ditulis ke file) hanya untuk test |
| Adapter Supabase Auth (GoTrue) | BELUM DIVERIFIKASI | Ditulis dari pengetahuan API publik GoTrue (`POST /auth/v1/otp`, `/auth/v1/verify`). Hanya bentuk request yang diuji (fetch palsu). Tidak ada proyek atau kredensial di build ini |
| Driver `pg` ke Supabase/PostgreSQL | BELUM DIVERIFIKASI | Kode kecil, tidak pernah tersambung ke server Postgres nyata di sesi ini |
| Pengiriman email OTP | BLOCKED | Mode supabase mengandalkan SMTP Supabase. SPF/DKIM/DMARC dan template = urusan owner/S6 |
| Jadwal salat | REAL (baca), BLOCKED (isi) | API membaca `prayer_times`. Pengisi tabel (provider SIHAT/EQuran + job) belum ada. Tanpa baris = `available:false` |
| Database | PGlite (WASM), bukan Supabase | Sama seperti T3a. Docker tidak ada |

## Yang dikerjakan

1. **Migration baru** (`supabase/migrations/20261114*`):
   - `0100_api_reads`: `app_private.server_now()` (satu-satunya tempat jam server dibaca), `session_excuses`, kolom `activity_definitions.guidance`, status sesi dengan excuse, JSON sesi (`NightSession`), kalender turunan (missed tanpa baris, PRD §10.4), laporan 7/30/90, statistik amalan, riwayat, progres level, level saat ini, ringkasan sesi, dashboard, baris jadwal salat, daftar wilayah. Semua wrapper `public.*` tipis dan memeriksa entitlement.
   - `0200_api_writes`: excuse tunggal + rentang (maks 15 hari, batal hanya dalam jendela koreksi), profil, preferensi tampilan, lokasi (wilayah atau manual), onboarding (`program_start_date` sekali), preferensi notifikasi, progres Qur'an, `get_access`, perangkat (`start_device_session`, token login tertunda, `resolve_session`, revoke, logout), OTP (`otp_issue`, `otp_verify`), `rate_hit`, `provision_user` (buat profil + tautkan entitlement milik email itu).
   - `0300_wrappers_clock`: empat wrapper T3a ikut memakai `server_now()`.
2. **Server** (`src/server/db`, `auth`, `api`): dua driver (`pg` untuk `DATABASE_URL`, PGlite untuk test), transaksi per request sebagai role `authenticated` dengan JWT claims (RLS tetap berlaku) atau `service_role` (auth, rate limit, perangkat). Pipeline route tunggal: cek Origin pada mutasi, cek sesi, handler, satu bentuk error, `Cache-Control: private, no-store` di setiap jawaban. Kode error SQL dipetakan ke `{error:{code,message,details}}`. `VERSION_CONFLICT` membawa `details.server` yang dibaca `src/offline/sender.ts`.
3. **Klien HTTP** (`src/data/http/index.ts`): `createHttpDataLayer`, `createHttpAuthRepository`. Gagal jaringan = `OFFLINE` (antrean offline mencoba lagi). Kode dan pesan error dari server dipertahankan.
4. **Test**: lihat bagian hasil. Dua test lama yang menegaskan "live = stub" diperbarui (`tests/unit/auth/mock-auth.test.ts`, `tests/unit/data/mock.test.ts`).

## Keputusan teknis

| # | Keputusan | Alasan | Alternatif ditolak |
|---|---|---|---|
| T3b-1 | Cookie sesi sendiri (`tt_session = <deviceId>.<rahasia>`), hanya hash tersimpan di `device_sessions`. Supabase/provider hanya membuktikan kepemilikan email | Batas 3 perangkat, "dikeluarkan dari perangkat lain", dan sesi 30 hari sliding tidak ada di Supabase Auth. Pencabutan berlaku pada request berikutnya | JWT Supabase sebagai cookie sesi: tidak bisa mencabut per perangkat tanpa cek server juga |
| T3b-2 | Koneksi DB memakai role dari `DATABASE_URL`, lalu `set local role authenticated` + `request.jwt.claims` (seperti PostgREST). Bukan klien Supabase dengan JWT user | Tanpa JWT user (lihat T3b-1) tetap RLS yang berlaku. PRD §16.4 menyebut klien Supabase dengan JWT: ini menyimpang dari kata-katanya, bukan dari tujuannya | Service role untuk semua baca: RLS tidak terpakai |
| T3b-3 | `app_private.server_now()` dibaca oleh semua wrapper. Test PGlite mengganti isinya (jam bisa digeser), migration tidak | Test SESSION_LOCKED/jendela koreksi lewat HTTP tanpa memberi klien jalan mengirim "sekarang" (T3a-2). Isi di produksi = `now()` | GUC waktu (ditolak di T3a) |
| T3b-4 | Cooldown OTP dihitung dari `login_otps.issued_at` (tepat 60 dtk). Batas per jam email dan per IP pakai `rate_limits` dengan jendela tetap, kunci di-hash HMAC | Jendela tetap saja membuat cooldown bisa dilewati di batas jendela. Email dan IP tidak tersimpan polos | Sliding log per email: tabel baru |
| T3b-5 | `otp_verify` mengembalikan boolean (tidak raise) | Jumlah percobaan salah harus tetap tersimpan. Exception membatalkan transaksi | Raise + transaksi terpisah |
| T3b-6 | Perangkat yang dicabut/keluar menyimpan hash cookie-nya, jadi cookie itu terbaca `revoked` (pesan "dikeluarkan lewat perangkat lain"), bukan `none` | T1b butuh `reason: "revoked"`. Baris `device_sessions` dibersihkan job nanti (belum ada) | Hapus baris: alasan hilang |
| T3b-7 | `excuse`: tabel `session_excuses (user_id, excused_date)`. Tanpa alasan, tanpa kategori, tanpa grant ke role mana pun | Tanggal tanpa baris sesi tetap bisa berstatus berhalangan. Privasi PRD §10.6/§18.2: tidak ada fungsi admin yang membacanya per user | Kolom `excused_at` saja: butuh baris sesi untuk tanggal masa depan |
| T3b-8 | Origin salah/kosong pada mutasi dijawab `401 UNAUTHENTICATED` dengan `details.reason = "origin"` | Daftar kode error bersama (`contracts.ts`, bukan milikku) tidak punya `FORBIDDEN_ORIGIN`. 5xx dijawab `NOT_AVAILABLE` (sender menganggapnya sementara) | Mengubah `contracts.ts` |
| T3b-9 | Sumber `source` jadwal di API hanya `provider` atau `manual`. `cached` tidak pernah keluar dari API | `cached` berarti "provider gagal lalu cache dipakai": itu butuh panggilan provider saat request. API T3b tidak memanggil provider | Menandai semua baris lama sebagai `cached` |
| T3b-10 | Kartu setup `notifications` selesai bila ada push subscription aktif. `install_app` selalu `false` dari server | Preferensi saja tidak mengirim apa pun. Server tidak tahu apakah app terpasang | `done` bila preferensi ada |
| T3b-11 | Insight dan teks dashboard dihitung di TypeScript dari fungsi domain (`pickInsight`, `chooseSchedule`, `planWake`) di atas data SQL | Satu sumber untuk template insight dan aturan jadwal. SQL hanya menghitung data (kalender, hitungan, statistik) dan diuji paritas dengan domain | Menyalin template ke SQL |
| T3b-12 | Provider auth `local` menolak jalan kecuali `AUTH_PROVIDER=local`, `TAHAJUD_ALLOW_LOCAL_AUTH=true`, `DB_DRIVER=pglite`, `TAHAJUD_ALLOW_TEST_DB=true`. PGlite sendiri butuh `TAHAJUD_ALLOW_TEST_DB=true` | Mock tidak boleh menyamar jadi produksi (CLAUDE.md). Kode "email" ditulis ke file di `TAHAJUD_MAIL_DIR`, tidak ada route yang menampilkannya | Endpoint dev untuk membaca kode |
| T3b-13 | E2E live memakai config sendiri `playwright.t3b.config.ts` dan file `t3b-*.live.ts` (tidak cocok pola `*.spec.ts`, jadi `pnpm test:e2e` biasa tidak menjalankannya) | `NEXT_PUBLIC_DATA_MODE` dibakar saat build, jadi butuh build live terpisah ke `.next`. Jangan jalankan bersamaan dengan `pnpm test:e2e` | Mengubah `playwright.config.ts` |

## Dependency ditambah

| Paket | Jenis | Alasan |
|---|---|---|
| `pg` | prod | Driver Postgres untuk `DATABASE_URL` |
| `@types/pg` | dev | Tipe |

## Hasil test (apa adanya)

Gerbang dijalankan di akhir sesi di branch ini:

```
pnpm typecheck               -> lolos
pnpm lint                    -> lolos
pnpm test                    -> Test Files 39 passed (39), Tests 815 passed | 3 skipped (818)
                                (termasuk tests/db: 210 test, dan 4 file api-* lewat HTTP: 134 test)
pnpm test:e2e --trace off    -> 260 passed, 46 skipped (screenshot), 0 gagal (3.4m), setelah merge main b3a43ea..35f8255
pnpm test:e2e:live --trace off -> 10 passed, 2 skipped (fixme checklist, lihat Temuan), 0 gagal (50s)
pnpm audit --prod            -> No known vulnerabilities found
secret scan (grep di diff)   -> kosong
```

- Putaran e2e mock pertama (sebelum merge main) gagal 1 test: `r3a-auth.spec.ts:122` "access turned on later" (mobile), 209 passed. Putaran kedua pada pohon hasil merge lulus semua. Tidak dianalisis lebih jauh: alur mock murni, tidak lewat kode T3b, dan pola ini sama dengan catatan flaky orchestrator (brief Q1). Dilaporkan, bukan diabaikan.
- Merge main ke branch ini sempat mengubah format file milik sesi lain karena saya menjalankan prettier pada `src/server/**` dan `tests/unit/server/*.ts`. Sudah dikembalikan ke versi main (`src/server/prayer`, `src/server/push`, dua test). Diff akhir ke main hanya menyentuh file milikku, `package.json`, `pnpm-lock.yaml`, `.env.example`, STATUS, `scripts/db-seed.ts`, dan dua test "live = stub" yang diperbarui.
- Dari U1b: `PrayerTime.verification` dan `attribution` kini diisi dari kolom baru `prayer_times.verification/attribution` (migration `0400`). Baris tanpa nilai atau jadwal manual = null (tidak ada klaim "Terverifikasi" tanpa cek). Pengisinya job jadwal (T4c/T6) belum ada, jadi di API live saat ini selalu null sampai tabel diisi lewat provider.

ID yang dicakup lewat HTTP: SECURITY-01 (sesi/aktivitas/perangkat/daftar milik orang lain = 404 atau ditolak, tidak bocor), SECURITY-02 (lima keadaan entitlement x semua endpoint privat, berlaku di request berikutnya tanpa login ulang, data utuh), SECURITY-03 (tidak ada endpoint yang menulis status/level, field tambahan dibuang, status hanya dihitung server), AUTH-05 (kode sekali pakai, 5 percobaan, 10 menit, kadaluarsa), AUTH-06 (jawaban sama untuk email terdaftar dan tidak, limit email/IP/jeda, hanya hash disimpan), DZIKIR-03/05 (duplikat, batch ulang, perangkat lain, tidak negatif, `set_zero`, batas 50), cek Origin (semua metode mutasi), Cache-Control (semua jawaban termasuk error dan 404), batas 3 perangkat penuh (tolak ke-4, pilih satu, sekali pakai, 10 menit, bukan perangkat milik orang lain).

## Temuan: bug UI yang hanya muncul di mode live (bukan area T3b)

**Gejala.** Di mode live, mencentang checklist di `/worship/session` membuat halaman membeku: ratusan `GET /me/night-session` per detik, screenshot Playwright timeout. Di mock tidak terlihat.

**Sebab.** `SessionView` memberi `onChanged={() => bump()}` ke `ActivityRow`. `bump()` menaikkan `version`; `DataProvider` memanggil `queue.flushNow()` saat `version` naik; queue mengirim event; `ActivityRow.sync()` melihat `local !== null` (nilai server belum sampai) dan memanggil `changed()` lagi. Di mock reload hampir instan jadi `local` sempat bersih. Di live reload butuh puluhan ms, bump berikutnya datang dalam mikrodetik, dan `useLoad` membatalkan (`alive = false`) setiap jawaban sebelum sempat dipakai. Tidak pernah berhenti.

**Perbaikan satu baris** (sudah saya coba lokal di build live: halaman normal, lalu saya kembalikan karena `src/components/**` bukan milikku):

```diff
--- a/src/components/worship/session-view.tsx
+++ b/src/components/worship/session-view.tsx
@@ -153,7 +153,7 @@ export function SessionView() {
                           key={a.id}
                           activity={a}
                           onChanged={() => {
-                            bump();
+                            reload();
                           }}
                           onError={setMessage}
                         />
```

`reload` dari `useLoad` hanya mengambil data lagi, tanpa flush queue, jadi tidak ada umpan balik. Test live `a checklist tick is saved on the server and survives a reload` saya tandai `fixme` sampai patch ini masuk. Setelah masuk, hapus baris `test.fixme(...)` di `tests/e2e/t3b-level1.live.ts`. Sudah dikabari ke orchestrator lewat pesan.

## Belum diuji / risiko

- **Tidak pernah dijalankan terhadap Supabase atau PostgreSQL native.** Driver `pg`, adapter GoTrue, `sslmode` di `DATABASE_URL` (pooler Supabase memerlukan SSL; perilaku `sslmode=require` di `pg` berubah di versi mendatang), dan perbedaan privilege role bawaan Supabase belum dibuktikan.
- **Konkurensi nyata**: PGlite satu koneksi. Mekanismenya ada (`for update` di OTP dan pending login, advisory lock per user untuk batas perangkat, `UNIQUE (user_id, client_operation_id)`), tetapi dua request paralel sungguhan belum diuji.
- **IP klien** diambil dari `X-Forwarded-For` (alamat pertama). Hanya benar bila platform hosting menimpa header itu. Di belakang proxy yang meneruskan header klien mentah, limit per IP bisa dilewati.
- **Wake plan** mengikuti `planWake` dan mock: jam tidur dihitung pada tanggal sebelum tanggal Subuh. Target tidur setelah tengah malam (mis. 01:00) jadi dihitung 26 jam sebelum bangun. Ini perilaku domain S2, tidak diubah.
- **`server_now` di test** memakai `set_config` tingkat sesi di satu koneksi PGlite. Tidak ada padanannya di produksi, memang disengaja.
- **Pembersihan** `device_sessions`, `login_otps`, `rate_limits`, `pending_logins` lama belum ada (T6). `rate_hit` menghapus jendela lama per kunci saat dipakai.
- **Respons dashboard**: `calendar_days` 30 hari terakhir, tetapi insight membaca seluruh kalender (satu query tambahan). Belum diukur untuk pengguna dengan ratusan malam.
- Endpoint di luar brief dan belum ada: `/me/data-export`, `/me/delete-account`, `/prayer-times`, `/quran/surahs`, `/me/quran-completions`, push subscription, `/me/notifications`, webhook (T5).
- Safari iOS dan Firefox tidak diuji (e2e live hanya Chromium).

## Sisa pekerjaan

- Terapkan patch UI di atas, lalu aktifkan test checklist live.
- Pengisi `prayer_times` (job + provider) dan jadwal refresh: T4c/T6.
- Provisioning di Supabase sungguhan: jalankan migration + seed, isi env (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SESSION_PEPPER`), lalu uji OTP end to end.
- Job pembersih tabel auth lama, dan hapus akun/ekspor data (PRD §24.4).

## Pertanyaan untuk owner

1. Akun Supabase dan SMTP domain sendiri (SPF, DKIM, DMARC) kapan tersedia? Tanpa itu OTP live tidak bisa dicoba.
2. Apakah login untuk email yang belum membeli boleh membuat akun (sekarang ya, hasilnya layar "Belum ada akses aktif")? Alternatifnya menolak di langkah kode, tetapi itu membocorkan siapa yang sudah membeli (bertentangan dengan PRD §24.1 anti enumeration).

## Permintaan ke orchestrator

1. **Patch UI satu baris** di `src/components/worship/session-view.tsx` (di atas). Kepemilikan: T1/U1a/U1b.
2. **Kode error bersama**: usul tambah `FORBIDDEN_ORIGIN` dan `INTERNAL_ERROR` ke `API_ERROR_CODES` di `src/data/contracts.ts`. Sekarang Origin salah = `UNAUTHENTICATED` (T3b-8) dan 5xx = `NOT_AVAILABLE`.
3. **Merge**: `package.json` + `pnpm-lock.yaml` berubah (`pg`, `@types/pg`, script `test:e2e:live`). `scripts/db-seed.ts` dan `supabase/seed.sql` berubah (kolom `guidance`). `.env.example` bertambah. `tests/db/schema.test.ts` berubah (daftar tabel dan RPC). Dua test lama diperbarui (lihat di atas).
4. **Jangan jalankan** `pnpm test:e2e:live` bersamaan dengan `pnpm test:e2e` (sama-sama membangun ke `.next`).
5. Pelajaran umum untuk T5/T6: wrapper `public.*` baru harus memakai `app_private.server_now()` dan masuk daftar RPC di `schema.test.ts`; tabel baru perlu `enable row level security` eksplisit.
