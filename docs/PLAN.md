# PLAN: sisa pekerjaan Tahajud Tracker (dari ronde 3 sampai audit akhir)

Disusun orchestrator (Opus), 12 Nov 2026, posisi `main` @ `acf45fc` (S1, S2, S3, S4a sudah merged; 333 unit + 96 e2e hijau).
Tim: orchestrator Opus · semua tim kerja Sonnet · Fable 5.2 hanya auditor akhir (sesi baru dibuka owner) · Haiku tidak dipakai.
Status: MENUNGGU "gas" dari owner.

## Gerbang verifikasi standar (berlaku untuk setiap task)
`pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e --trace off && pnpm audit --prod` lolos di branch agen DAN di hasil gabungan orchestrator. Nama test diawali ID acceptance PRD jika ada. Axe 0 serious/critical untuk route baru (light + dark). Tidak ada test yang di-skip untuk membuatnya hijau.

## Daftar task

| ID | Task | Scope (boleh disentuh) | Dependensi | Acceptance criteria (dicek mesin) | Expected outcome (bisa diklik/dilihat) | Model / effort | Alasan |
|----|------|------------------------|------------|-----------------------------------|----------------------------------------|----------------|--------|
| T1 | Auth, onboarding, logout, sambungan offline | `src/app/(auth)/**`, `src/app/onboarding/**`, `src/app/access-status/**`, `src/components/auth/**`, `src/components/onboarding/**`, `src/components/providers/**`, `src/components/dhikr/counter-screen.tsx`, `src/components/shell/**` (UpdatePrompt, menu logout), `tests/e2e/r3a-*.spec.ts`, `tests/unit/ui/auth-*` | S4a, S3 (merged) | AUTH-06 (respons UI identik untuk email terdaftar/tidak), AUTH-07 versi e2e (OTP diketik di app, tanpa pindah halaman eksternal), DZIKIR-02 e2e (offline → 30 tap → online → server = 30), DZIKIR-06 e2e (dialog muncul saat ada antrean), SECURITY-06 e2e (IndexedDB user kosong setelah logout), onboarding jalur minimum ≤ 3 layar sampai dashboard, `TODO(S4a)` hilang dari kode | Login demo dengan kode OTP dari dev panel, onboarding pilih wilayah atau jadwal manual, counter tetap jalan saat offline, logout dengan peringatan antrean, panduan install PWA, kartu setup di dashboard | Sonnet / high | Fitur biasa, tetapi menyentuh auth dan sinkronisasi offline sehingga butuh ketelitian lebih |
| T2 | Quran Reader UI, laporan, settings, notifikasi, help | `src/app/(app)/quran/**`, `reports/**`, `settings/**`, `notifications/**`, `help/**`, `profile/**`, `src/components/quran/**`, `reports/**`, `settings/**`, `tests/e2e/r3b-*.spec.ts` | S3 (merged) | QURAN-02 (bookmark dipulihkan setelah reload, pakai fixture uji non-Qur'an berlabel), REPORT-01 di UI (57,14% tampil), REPORT-02, NOTIF-03 (browser tanpa push → panduan alarm manual), settings menyimpan tema/ukuran font Arab/durasi ibadah/quiet hours/jadwal manual dan bertahan setelah reload, `/settings/devices` dan `/settings/account` (hapus akun, unduh JSON) tampil, Reader tanpa dataset menampilkan state "Dataset Al-Qur'an belum diimport", grep teks Arab ayat di `src/` = 0 | Halaman Al-Qur'an (daftar surah + reader kosong yang jujur), laporan 7/30/90 + kalender penuh, pengaturan lengkap, pusat notifikasi, bantuan | Sonnet / medium | Layar standar dari kontrak data yang sudah ada |
| T3 | Database, RLS, Auth server, API v1 | `supabase/**` (migrations, seed, tests), `src/server/**`, `src/app/api/v1/**` (kecuali `webhooks/`), `src/data/http/**`, `tests/unit/server/**`, `tests/db/**` | T1, T2 merged (supaya kontrak final) | Semua tabel PRD §17; RLS test otomatis: SECURITY-01, SECURITY-03 (UPDATE langsung ditolak), SECURITY-02; `apply_counter_operation` lolos test yang sama dengan `applyOperation` domain (DZIKIR-03, -05); AUTH-05; route handler Zod + `Cache-Control: private, no-store` + cek `Origin` (test); mode `live` lolos e2e alur Level 1 melawan DB lokal | Dengan `NEXT_PUBLIC_DATA_MODE=live` dan DB lokal, alur yang sama dengan demo berjalan dari database sungguhan | Sonnet / high | Implementasi besar mengikuti skema yang sudah rinci; tetap high karena RLS dan auth |
| T4 | Import Qur'an + adapter jadwal + Web Push sender | `scripts/import-quran.ts`, `content/quran/**` (dataset + checksum + lisensi), `src/server/prayer/**`, `src/server/push/**`, `tests/unit/server/prayer-*`, `push-*` | T2 merged; host tanzil.net diizinkan owner | QURAN-01 (jumlah ayat 83/96/30/78/110 + At-Talaq 2-3 cocok, checksum SHA-256 tersimpan dan diverifikasi test); `SihatProvider` stub gagal dengan pesan jelas tanpa token; PRAYER-01, PRAYER-02 di level adapter; pengiriman Web Push dengan VAPID dev menonaktifkan subscription 404/410 (test dengan server palsu) | Reader menampilkan teks Rasm Utsmani asli dengan atribusi; jadwal masih label contoh sampai SIHAT tersedia | Sonnet / medium | Integrasi terdefinisi, risiko utama adalah integritas teks yang dijaga checksum |
| T5 | Scalev webhook, entitlement, email outbox | `src/app/api/v1/webhooks/scalev/**`, `src/server/scalev/**`, `src/server/email/**`, `supabase/migrations/*_scalev_*.sql`, `tests/unit/server/scalev-*` | T3 merged | AUTH-01..04, AUTH-08, paid→settled tidak dobel, event tidak berurutan, body > 256 KB ditolak, rotasi secret (2 secret), payload mentah tidak tersimpan tanpa enkripsi; fixture bertanda `NEEDS_VERIFICATION` | Simulasi pembelian dari fixture membuat entitlement aktif hanya setelah verifikasi order (mock API Scalev) | Sonnet / high | Area pembayaran dan keamanan, aturan sudah eksplisit di PRD §19.8-§20 |
| T6 | Job runner, scheduler notifikasi | `supabase/migrations/*_jobs_*.sql`, `supabase/functions/**`, `src/server/jobs/**`, `src/server/notifications/**`, `tests/unit/server/jobs-*` | T3 merged, T4 merged | NOTIF-01, -02, -04, -05 di level server; dedupe_key unik; job `dead` setelah max attempts; reschedule saat wilayah/jam tidur berubah (test) | Notifikasi bedtime/tahajud/subuh terjadwal di DB lokal dan terkirim ke subscription uji | Sonnet / high | Konkurensi job dan waktu rawan bug |
| T7 | Admin CMS, RBAC, MFA, audit | `src/app/admin/**`, `src/components/admin/**`, `src/server/admin/**`, `supabase/migrations/*_admin_*.sql`, `tests/e2e/admin-*` | T3, T5, T6 merged | SECURITY-05 (non-admin dan admin tanpa MFA ditolak), PRIV-01 (reporting_admin tidak melihat excused per user, agregat ≥ 20 user), workflow Draft → In Review → Approved → Published dengan reviewer berbeda, audit log before/after, Qur'an tidak bisa diedit dari CMS | Halaman admin: amalan manager, template notifikasi, support tools (resend, approve manual, transfer entitlement), kesehatan integrasi | Sonnet / high | Fitur luas dengan aturan akses ketat |
| T8 | QA menyeluruh + dokumen deploy | `docs/DEPLOYMENT.md`, `docs/LAUNCH_CHECKLIST.md`, `docs/QA-REPORT.md`, `tests/**` (penambahan), perbaikan kecil lintas modul via orchestrator | T1-T7 merged | Semua acceptance PRD §27 punya test dan lulus (tabel ID → file test), Lighthouse mobile ≥ 85 di `/dashboard`, JS awal per route ≤ 200 KB gzip, axe semua route, secret scan bersih | Laporan QA, checklist launch 16 item PRD §30.3, panduan deploy Vercel + Supabase | Sonnet / medium | Eksekusi checklist yang sudah terdefinisi |
| F1 | Audit akhir independen | Baca seluruh repo, tulis `docs/AUDIT-FINAL.md` saja | T8 merged | Laporan P0/P1/P2 dengan bukti file:baris dan cara reproduksi | Daftar temuan untuk diperbaiki | Fable 5.2 (sesi baru dibuka owner) | Auditor independen; prompt diberikan orchestrator setelah T8 |
| T9 | Perbaikan temuan audit | Ditentukan dari `AUDIT-FINAL.md` | F1 | Semua P0/P1 ditutup + test regresi per temuan | Re-check Fable hanya untuk P0 | Sonnet / high | Perbaikan terarah |

## Ronde dan kepemilikan file

| Ronde | Agen A | Agen B | Kenapa aman paralel |
|-------|--------|--------|---------------------|
| R3 | T1 | T2 | Folder route dan komponen terpisah. `src/components/providers/**` dan `shell/**` hanya milik T1; T2 memakai hooks yang ada |
| R4 | T3 | T4 | T3: `supabase/`, `src/server/` (kecuali `prayer/`, `push/`), `api/v1`, `src/data/http`. T4: `scripts/`, `content/quran/`, `src/server/prayer|push/` |
| R5 | T5 | T6 | Migration dipisah per prefix nama file; folder server berbeda |
| R6 | T7 | (kosong) | Admin menyentuh banyak area; dikerjakan sendiri |
| R7 | T8 | (kosong) | QA lintas modul |
| R8 | F1 (owner buka sesi Fable) | | |
| R9 | T9 (dibagi A/B jika temuan tidak beririsan) | | |

File bersama (semua ronde):
| File | Aturan |
|------|--------|
| `package.json`, `pnpm-lock.yaml` | Keduanya boleh menambah dependency dengan alasan tertulis. Orchestrator menyelesaikan konflik lockfile saat merge (`pnpm install` ulang) |
| `docs/STATUS.md` | Hanya baris milik task-nya |
| `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/data/contracts.ts`, `src/data/repositories.ts` | R3: hanya Agen A (T1). Jika T2 butuh perubahan, tulis permintaan di file sesi |
| `supabase/migrations/` | R4: hanya T3. R5: T5 dan T6 membuat file baru dengan prefix berbeda, tidak mengedit file lama |
| `CLAUDE.md`, `docs/PRD-*.md`, `docs/AGENT_BRIEF.md`, `docs/PLAN.md`, `docs/SESSION_LOG.md`, `docs/DECISIONS.md`, `content/amalan.v1.json`, `docs/briefs/**` | Hanya orchestrator |
| Laporan | `docs/sessions/<ID task>.md` per agen |

## Eskalasi
Sonnet gagal 2x di test yang sama → orchestrator diagnosis dan kirim instruksi spesifik → jika tetap gagal, lapor owner. Fable tidak dipakai di tengah jalan.

## Keputusan owner yang dibutuhkan

Sebelum R3 (bisa dijawab singkat):
1. Label "Sedang berjalan" untuk sesi `in_progress` (T1/T2).
2. Login perangkat ke-4: keluarkan terlama (default) atau tolak (T1).
3. Sesi login 30 hari, batas 3 perangkat (T1).
4. Legenda "Amalan tanpa label Opsional adalah syarat sesi tuntas di aplikasi" (sudah tampil di S3).

Sebelum R4:
5. Izinkan host `tanzil.net` di network environment untuk import Qur'an (T4). Tanpa ini T4 BLOCKED.
6. Lisensi Tanzil disetujui; terjemahan Indonesia: pakai atau tidak (perlu izin terpisah).
7. Database untuk development: Supabase lokal (Docker) atau PGlite. Agen memilih yang jalan di container; tidak ada biaya.

Sebelum produksi (tidak memblokir R3-R7, kode dibangun dengan adapter + mock):
8. Project Supabase (free atau Pro; backup harian butuh Pro) dan kredensial lewat secret environment.
9. Scalev: product/variant ID, webhook secret, API key, contoh payload asli.
10. SIHAT Kemenag: akses API, atau keputusan provider lain.
11. Provider email (mis. Resend) + domain pengirim + nomor WhatsApp CS.
12. Nama app dan logo final; review harakat setelah UI bisa dicoba; 30 pesan bedtime.
