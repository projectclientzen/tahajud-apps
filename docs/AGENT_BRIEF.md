# AGENT BRIEF: Tahajud Tracker by NgajiGaes

Disiapkan oleh: orchestrator (sesi perencanaan, 12 Nov 2026)
Untuk: agen implementasi di sesi chat terpisah
Basis: `docs/PRD-v1.2.md` + konten `content/amalan.v1.json` (hasil audit `docs/AUDIT-PRD-v1.1.md`). PRD v1.1 hanya arsip.

---

## 0. Cara pakai brief ini (untuk Zen)

1. Buka chat/sesi baru di repo `projectclientzen/tahajud-apps`.
2. Copy prompt sesi dari §8 (mulai S1), paste ke chat baru.
3. Di akhir sesi, agen push ke branch-nya. Merge branch itu ke `main` sebelum mulai sesi berikutnya, supaya sesi berikutnya mulai dari kode terbaru.
4. Satu sesi = satu fase kecil. Jangan gabung 2 sesi dalam 1 chat; context agen akan penuh dan kualitas turun.
5. Setelah tiap sesi, cek `docs/STATUS.md` dan `docs/SESSION_LOG.md` bagian "Pertanyaan untuk owner".

---

## 1. Misi

Bangun PWA Tahajud Tracker sesuai PRD v1.1, bertahap:
UI/UX dulu (mock data berlabel) → domain engine → database + auth → integrasi eksternal → admin → QA + deploy.

Prioritas pengalaman: (1) Dashboard Istiqomah, (2) tracking ibadah 3 level, (3) dzikir counter.

Output akhir tiap sesi wajib menyebut dengan jujur: fitur mana REAL (jalan dengan data/logic sungguhan), mana SIMULATED (mock), mana BLOCKED (butuh kredensial/approval).

---

## 2. Risiko & celah yang harus agen tangani (urut dari paling penting)

Audit lengkap 60 temuan ada di `docs/AUDIT-PRD-v1.1.md` dan sudah dimasukkan ke PRD v1.2. Tabel di bawah = risiko implementasi yang paling sering membuat agen salah langkah.

| # | Isu | Dampak | Penanganan wajib | Confidence |
|---|-----|--------|------------------|------------|
| R1 | Warna Primary Sage `#88A189` di atas Warm Cream `#FAF7ED` kontrasnya sekitar 2.6:1 | Gagal WCAG AA untuk teks (butuh 4.5:1) dan komponen UI (butuh 3:1) | Sage hanya untuk dekorasi, ilustrasi, background chip dengan teks Deep Forest. Teks & CTA pakai Deep Forest `#354F40` (sekitar 8.4:1 di atas cream). Di dark mode, cream di atas Dark Earth `#25372F` sekitar 11.8:1 | High: dihitung pakai rumus relative luminance WCAG. Agen tetap wajib verifikasi ulang dengan tool |
| R2 | Teks Arab dzikir sudah dikirim owner (`content/amalan.v1.json`) tetapi status `submitted`, ada usulan koreksi harakat yang belum diputuskan | Agen tergoda "merapikan" teks | Pakai file apa adanya. Jangan terapkan `proposed_corrections`. Lafaz final "Ya Kafi" | High |
| R3 | API SIHAT Kemenag: ketersediaan endpoint publik, token, dan syarat izin belum jelas | Fitur jadwal Subuh bisa blocked | Buat `PrayerTimeProvider` interface. Implementasi: `MockProvider` (fixture berlabel) + `SihatProvider` (stub, aktif saat env tersedia). Jangan hardcode URL dari tebakan | Low: perlu verifikasi langsung ke Kemenag/dokumentasi resmi |
| R4 | Detail webhook Scalev (nama header `X-Scalev-Hmac-Sha256`, nama event, struktur payload) diambil dari PRD, belum dicek ke dokumentasi Scalev | Signature verification bisa salah implementasi | Implementasi berdasarkan PRD + fixture test. Tandai `NEEDS_VERIFICATION` di kode dan STATUS sampai dicocokkan dengan dokumentasi resmi Scalev atau payload asli dari dashboard Scalev | Medium: PRD menyebutnya, agen belum melihat dokumentasi |
| R5 | Web Push di iPhone hanya jalan jika PWA di-install ke Home Screen, iOS 16.4 ke atas | Reminder tahajud tidak sampai ke sebagian user iPhone | Onboarding wajib ada panduan install PWA per platform + fallback "pasang alarm manual" (PRD NOTIF-03) | High: perilaku Safari yang terdokumentasi Apple sejak 2023 |
| R6 | Scheduler notifikasi butuh job yang jalan tiap menit. Vercel Cron paket gratis setahu saya terbatas (sekitar 1x/hari) | Reminder telat atau tidak terkirim | Rekomendasi: Supabase `pg_cron` + `pg_net` memanggil Edge Function tiap 1-5 menit. Agen wajib cek limit terbaru sebelum memilih | Medium: perlu verifikasi pricing/limit terbaru |
| R7 | Supabase Auth email OTP pakai SMTP bawaan punya rate limit rendah | Login gagal saat launch/iklan jalan | Production wajib custom SMTP (mis. Resend/SES). Masuk checklist deploy | Medium: perlu cek limit terbaru di dashboard Supabase |
| R8 | Teks Qur'an Tanzil: lisensi mensyaratkan teks tidak diubah + atribusi. Agen di cloud bisa terblokir network ke tanzil.net | Reader kosong | Script import + checksum. Jika host diblok: berhenti, minta Zen allow host atau upload file. Jangan fallback ke teks hasil generate | Medium: lisensi perlu dibaca ulang saat import |
| R9 | Font Arab: tidak semua font render karakter khusus Rasm Utsmani (tanda waqaf, small high letters) | Teks terpotong / tofu | Kandidat: Amiri Quran (OFL, tersedia di Google Fonts), KFGQPC Uthmanic Hafs (cek lisensi). Uji visual dengan screenshot Playwright di surah Yasin & Al-Kahfi | Medium |
| R10 | Definisi "required_for_completion" per aktivitas masih menunggu approval (PRD §30.3 no. 5) | Engine progression bisa salah hitung | Simpan sebagai config per level dengan flag `provisional`. Default sesuai §4.3 brief ini | High |
| R11 | Session key = tanggal Subuh lokal. Bug klasik: user mulai 23.50, lanjut 00.10 | Data terbelah ke 2 tanggal | Fungsi `getSessionKey(now, region)` pure + test SESSION-01 dengan kasus lintas tengah malam dan lintas zona | High |

---

## 3. Arsitektur target

### 3.1 Stack
- Next.js (App Router, versi stable terbaru yang dicek saat install) + TypeScript strict
- Tailwind CSS + shadcn/ui, ikon `lucide-react`
- State: TanStack Query (server state) + Zustand kecil untuk UI state
- Offline: IndexedDB via `idb` atau Dexie, Service Worker (Serwist atau next-pwa yang masih maintained, agen cek)
- Backend: Next.js Route Handlers `/api/v1/**` + Supabase (Postgres, Auth, RLS, Edge Functions, pg_cron)
- Test: Vitest (unit domain), Playwright (e2e, pakai Chromium pre-installed, `--trace off`)
- Deploy: Vercel (frontend + route handlers), Supabase (DB + jobs)

### 3.2 Struktur folder (wajib diikuti agar sesi berikutnya tidak bingung)
```
src/
  app/                    # routes (user, admin, api/v1)
  components/
    ui/                   # primitives (shadcn)
    brand/                # logo, DemoBadge, illustrations
    dashboard/ worship/ dhikr/ quran/ reports/ onboarding/ admin/
  domain/                 # PURE TS, no React/Next import
    session/              # session key, state machine, cutoff
    progression/          # level progress, unlock
    reporting/            # completion rate, calendar, insights
    dhikr/                # counter reducer, op dedupe
    prayer/               # wake planner, Al-Kahfi window
    notifications/        # bedtime rotation
    content/              # level config types, activity catalog
  data/
    contracts.ts          # interface repository (sumber kebenaran tipe API)
    mock/                 # implementasi mock + fixtures berlabel
    http/                 # implementasi via /api/v1
    index.ts              # pilih impl berdasar NEXT_PUBLIC_DATA_MODE
  server/                 # service server-only (supabase admin, scalev, sihat, push)
  offline/                # IndexedDB queue, sync worker
  lib/                    # utils (time, format, a11y)
supabase/
  migrations/  seed/  functions/
tests/
  unit/  e2e/  fixtures/
docs/
```

### 3.3 Data mode
- `NEXT_PUBLIC_DATA_MODE=mock` (default dev): semua repository pakai mock yang persist ke IndexedDB, supaya prototype interaktif dan counter tetap tersimpan setelah refresh.
- `NEXT_PUBLIC_DATA_MODE=live`: pakai `/api/v1`.
- Saat mock aktif, `DemoBadge` ("DATA DEMO") tampil di header setiap halaman. PRD §8.3: angka dummy tanpa penanda dilarang.
- Sediakan dev panel (hanya mode mock) untuk: simulasi jam (time travel), ganti skenario (akun baru, 5 sukses, level 2 aktif, offline, prayer data stale, purchase pending). Ini penting untuk demo dan untuk test state.

---

## 4. Data referensi ringkas (detail lengkap: PRD v1.2 §7, §9, §10, §11)

### 4.1 Design tokens
| Token | HEX | Pakai untuk |
|-------|-----|-------------|
| `sage` | #88A189 | Aksen dekoratif, ilustrasi, chip background. BUKAN teks di atas cream |
| `forest` | #354F40 | CTA, teks utama, progress fill |
| `cream` | #FAF7ED | Background light |
| `sand` | #D9C6A5 | Milestone, highlight |
| `olive` | #B7BDA1 | Aksen sekunder, border lembut |
| `earth` | #25372F | Background dark mode |

Agen menambah token semantik (success, warning, error, info, disabled, surface, surface-2, border, text-muted) untuk light dan dark, semuanya lolos AA. Status kalender tidak boleh hanya beda warna: pakai ikon + label (PRD §7.6).

Tipografi: Plus Jakarta Sans (Latin). Arab: lihat R9. Body 16px, Quran Arab default 30px (bisa diatur), dzikir Arab 26-34px.

### 4.2 Level
| Level | Judul | Rakaat malam | Dzikir malam | Target sukses (PROV) | Periode saran (PROV) | Estimasi durasi (PROV) |
|-------|-------|--------------|--------------|----------------------|----------------------|------------------------|
| 1 | Fondasi | 5 | 400 (600 dgn tahlil opsional) | 7 | 14 malam | 60 menit |
| 2 | Bertumbuh | 9 | 1.550 | 12 | 21 malam | 120 menit |
| 3 | Istikamah | 11 | 1.863 | 20 | 30 malam | 150 menit |

Buffer persiapan default 10 menit (PROV). `wake = fajr - durasi - buffer`.

### 4.3 Aktivitas per level
Sumber tunggal: `content/amalan.v1.json` (urutan, target, satuan, required, teks Arab, panduan). Ringkasan di PRD v1.2 §9.
- Level 1: Taubat 2, Tahajud 2, Witir 1; Istighfar 100, Shalawat 100, Tahlil 100 (+200 opsional), Ya Fattah Ya Razzaq Ya Kafi Ya Mughni 100 putaran; doa; tilawah (opsional).
- Level 2: Taubat 2, Tahajud 2, Hajat 2, Witir 2, Witir 1; Istighfar 100, Asma 100 putaran, Shalawat 300, Hasbunallah 450, Hauqalah 100, Tahlil 500; doa; tilawah.
- Level 3: seperti Level 2, Tahajud 4, tambah Doa Nabi Yunus 313 sebelum Tahlil.
- Post-Fajr SEMUA level: istighfar panjang 3, tahlil panjang 10, antas salam 1, tasbih/tahmid/takbir 33, kabira 1, istighfar 3, tahlil 100, Al-Waqi'ah (wajib), Ayat Seribu Dinar, doa hajat.
- Fajr semua level: Qabliyah 2 (Al-Insyirah, Al-Fil), Tasbih malaikat 100, Salat Subuh, Berjamaah (opsional).
- Test wajib: total dzikir malam required = 400 / 1.550 / 1.863 dan rakaat = 5 / 9 / 11 dihitung dari JSON.
- "Required" = syarat target aplikasi, bukan kewajiban fikih. Copy UI harus menyebut ini.

### 4.4 Aturan sesi
- Session key = tanggal Subuh lokal (`fajr_local_date`). Malam 12 Nov menuju Subuh 13 Nov → key `2026-11-13`.
- `activeSessionKey(now)` = `localDate(now)` jika `now < 12.00 lokal`, selain itu `localDate(now) + 1`. `now` = waktu server.
- Missed = derived dari kalender sejak `program_start_date` (tidak perlu baris sesi). Partial butuh minimal 1 progres > 0.
- Level monoton: sekali terbuka tidak terkunci lagi.
- Status sesi dihitung otomatis dari aktivitas; tombol selesai hanya membuka ringkasan.
- Counter: tap di-coalesce, flush tiap 2 detik / target tercapai / tab hidden. UNIQUE (user_id, client_operation_id).
- Cutoff otomatis 12.00 lokal di tanggal Subuh (PROV). Koreksi s.d. 48 jam setelah cutoff (PROV).
- State: `scheduled → in_progress → completed`; `scheduled → missed`; `in_progress → partial`; `scheduled|in_progress → excused`. Koreksi lewat audit log.
- Completion rate = completed / (completed + partial + missed) × 100. Excused & upcoming tidak dihitung. Penyebut 0 → "Belum ada data".
- Unlock level berlaku mulai sesi berikutnya. Sesi menyimpan snapshot config (level, timezone, region dibekukan).
- Level 3 selesai → milestone "Istikamah Journey Completed", tetap di Level 3.

### 4.5 Routes
User: `/`, `/login`, `/auth/verify`, `/access-status`, `/onboarding`, `/dashboard`, `/worship`, `/worship/session`, `/worship/dhikr/[id]`, `/levels`, `/quran`, `/quran/[surah]`, `/reports`, `/reports/calendar`, `/notifications`, `/profile`, `/settings`, `/help`.
Bottom nav: Beranda `/dashboard`, Amalan `/worship`, Al-Qur'an `/quran`, Profil `/profile`.
Admin: `/admin`, `/admin/users`, `/admin/purchases`, `/admin/levels`, `/admin/activities`, `/admin/dhikr`, `/admin/quran-content`, `/admin/notifications`, `/admin/prayer-times`, `/admin/audit-logs`.

Quran yang didukung: Yasin (36), Al-Waqi'ah (56), Al-Mulk (67), Ar-Rahman (55), Al-Kahfi (18), At-Talaq 65:2-3. Al-Kahfi window: Kamis setelah Maghrib s.d. Jumat sebelum Maghrib lokal.

---

## 5. Register PROVISIONAL (jangan dianggap final)

Simpan di `src/domain/content/provisional.ts` (atau tabel config) dengan `provisional: true`, tampilkan di admin sebagai "Menunggu persetujuan".

- Target sukses level 7 / 12 / 20; periode 14 / 21 / 30
- Tahlil Level 1: 100 inti + 200 opsional
- Urutan post-Fajr khusus Level 3
- Lifetime entitlement (expires_at null)
- Cutoff 12.00 lokal; backfill 48 jam
- Estimasi durasi 60 / 120 / 150 menit; buffer 10 menit
- Bank pesan bedtime minimal 30
- Daftar aktivitas required
- Tanda tangan pembimbing atas teks dzikir + usulan koreksi (`docs/CONTENT-REVIEW.md`), source_classification, cakupan post-Fajr
- Lisensi Qur'an & terjemahan; izin API jadwal salat

---

## 6. Aturan skill & tools untuk agen

Zen menyebut skill: hallmark, ui-ux-pro-max, antislop, superpowers, ponytail. Ketersediaan skill tergantung sesi.
- Di awal sesi, cek daftar skill yang tersedia. Pakai yang ada, sebut di SESSION_LOG skill mana yang dipakai.
- Jika `ui-ux-pro-max` / desain skill tersedia: pakai untuk S1 (design system) dan S3-S4 (screen).
- Jika `superpowers` tersedia: pakai alur brainstorm → write-plan → TDD untuk S2 (domain engine).
- Untuk copy UI: pakai `stop-slop` / `avoid-ai-writing` / antislop jika tersedia.
- Jika skill tidak ada: lanjut tanpa skill, catat di log. Jangan berhenti.
- Jangan spawn subagent tanpa perlu; kerjakan inline.

---

## 7. Aturan mock data
- Semua fixture di `src/data/mock/fixtures/**`, setiap file diawali komentar `// DEMO DATA: bukan data asli`.
- Nama user demo: "Pengguna Demo". Jangan pakai nama orang nyata.
- Jadwal salat mock: fixture berlabel "Jadwal contoh, bukan dari Kemenag". Boleh pakai perhitungan lokal library `adhan` HANYA di mode mock dengan label yang sama.
- Teks Qur'an: TIDAK ada di mock. Reader mode mock menampilkan state "Dataset Al-Qur'an belum diimport" sampai S4/S7 mengimport Tanzil.
- Teks Arab dzikir: dari `content/amalan.v1.json`, dibaca oleh mock repository dan seed DB (satu sumber). Transliterasi/terjemahan `null` sampai owner menyediakan.

---

## 8. Rencana sesi (paste prompt ke chat baru)

Tiap sesi: baca `CLAUDE.md` → brief ini → STATUS → SESSION_LOG terakhir. Kerjakan scope saja. Akhiri dengan update STATUS + SESSION_LOG + push.

### 8.0 Tambahan scope dari PRD v1.2 (wajib, melengkapi scope tiap sesi di bawah)

| Sesi | Tambahan | Acceptance test baru |
|------|----------|----------------------|
| S1 | Token theme "otomatis gelap Maghrib-Subuh"; label status Tuntas/Sebagian/Terlewat/Berhalangan/Akan datang (PRD §7.7) | - |
| S2 | `activeSessionKey`, missed derived, level monoton (`user_level_state`), status otomatis, counter coalescing buffer, `set_zero`, clamp jam client, rentang berhalangan, completion rate mulai `program_start_date`, kedaluwarsa notifikasi, ambang tidur 5 jam | SESSION-03, -04, -05, -06, DZIKIR-04 (unit), DZIKIR-05 (unit), NOTIF-04, NOTIF-05 |
| S3 | Tombol tap ≥160px, Wake Lock toggle, "+N lebih", mode berhalangan rentang, kartu setup di dashboard, label sumber jadwal | DZIKIR-04 (e2e) |
| S4 | Login OTP-first + "Tidak menerima kode?" + tombol WhatsApp CS; onboarding jalur minimum; jadwal manual; `/settings/devices`; `/settings/account` (hapus akun, unduh data); dialog logout dengan antrean belum sinkron; `navigator.storage.persist()`; IndexedDB per user | DZIKIR-06, PRAYER-03, SECURITY-06 |
| S5 | REVOKE privilege tabel tracking dari `authenticated`; RPC/API saja; tabel `user_roles`, `user_devices`, `jobs`, `email_outbox`, `rate_limits`, `app_settings`, `data_deletion_requests`, `admin_audit_logs`; rate limit OTP; Origin check; `Cache-Control: private, no-store`; redirect allowlist; hapus akun + anonimisasi order | AUTH-06, AUTH-07 (manual + e2e webkit jika bisa), SECURITY-03, SECURITY-04 |
| S6 | Verifikasi order ke API Scalev sebelum `active`; `pending_verification` + approve manual jika API belum ada; rotasi secret; limit body 256 KB; payload minimal + retensi 90 hari | AUTH-08 |
| S7 | Job runner tunggal (`jobs` + pg_cron); notifikasi kedaluwarsa; quiet hours; jadwal manual di planner | NOTIF-04, NOTIF-05, PRAYER-03 (server) |
| S8 | MFA admin wajib; matriks role PRD §18.2; support tools (resend, approve manual, transfer entitlement); agregat min 20 user | SECURITY-05, PRIV-01 |
| S9 | Checklist legal (UU PDP, S&K, refund, PSE: VERIFY), custom SMTP + SPF/DKIM/DMARC, budget JS ≤200 KB, backup berbayar, 16 item §30.3 PRD | Semua §27 |

### S1: Foundation, design system, app shell
Scope:
- Init Next.js + TS strict + Tailwind + shadcn + ESLint + Prettier + Vitest + Playwright. Script: `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`.
- `docs/SITEMAP.md`: sitemap + user flow (purchase→activation, onboarding, daily worship, Subuh transition) dalam Mermaid.
- Design tokens light/dark (CSS variables + Tailwind theme), tipografi, verifikasi kontras AA (tulis hasil rasio di `docs/DESIGN_SYSTEM.md`).
- Komponen reusable: Button, Card, ProgressBar, ProgressRing, StatCard, StatusChip (ikon+label), BottomNav, SidebarNav (desktop ≥1024), PageHeader, EmptyState, ErrorState, OfflineBanner, Skeleton, Modal/Sheet aksesibel, DemoBadge, ThemeToggle.
- App shell responsif (mobile single column, tablet grid, desktop sidebar) mulai 320px.
- PWA manifest + icon placeholder (bukan logo NgajiGaes palsu; pakai wordmark teks sampai Zen beri aset).
- Halaman `/dev/components` (gallery komponen, hanya non-production).
Done: build lulus, gallery bisa dibuka di 320px & 1280px, screenshot Playwright light+dark tersimpan di `docs/screenshots/s1/`.

Prompt:
```
Baca CLAUDE.md dan docs/AGENT_BRIEF.md. Kerjakan sesi S1 (Foundation, design system, app shell) sesuai §8 brief. Mulai dari main terbaru. Pakai skill desain/UI yang tersedia di sesi ini. Jangan kerjakan scope sesi lain. Di akhir: jalankan typecheck, lint, test, e2e; update docs/STATUS.md dan docs/SESSION_LOG.md; commit dan push. Laporkan apa yang REAL vs SIMULATED.
```

### S2: Domain engines + data contracts + mock repository (TDD)
Scope:
- `src/domain/**` pure functions: `getSessionKey`, session state machine + cutoff, `computeSessionStatus(activities)`, `computeLevelProgress`, `checkUnlock` (efektif sesi berikutnya), `completionRate`, calendar builder, insight template picker (first completion, milestone, improvement, stable, return after inactivity), dhikr counter reducer + dedupe by `operation_id`, wake planner, Al-Kahfi window, bedtime rotation (hindari 14 terakhir).
- `src/data/contracts.ts`: tipe request/response sesuai PRD §19 (dashboard, session, counter op, completion, reports, quran progress, notif prefs).
- Mock repository persist ke IndexedDB + skenario dev + time travel.
- Unit test yang memetakan acceptance PRD §27: LEVEL-01..05, SESSION-01..02, DZIKIR-01..03 (versi domain), REPORT-01..02, NOTIF-01. Nama test diawali ID, mis. `it('REPORT-01 ...')`.
Done: coverage domain ≥ 90% lines, semua test ID di atas hijau.

Prompt:
```
Baca CLAUDE.md dan docs/AGENT_BRIEF.md. Kerjakan sesi S2 (domain engines, data contracts, mock repository) dengan TDD sesuai §8. Semua nilai PROVISIONAL dari §5 masuk config dengan flag provisional. Test diberi prefix ID acceptance PRD. Akhiri dengan update STATUS dan SESSION_LOG, commit, push.
```

### S3: Screens inti: Dashboard, Amalan, Sesi, Dzikir Counter, Level Journey
Scope:
- `/dashboard` section A-H PRD §8.2 + semua state §8.3 (skeleton, akun baru, offline, prayer unavailable, belum ada sesi, sesi berjalan, sesi selesai). Filter 7/30/90 hari. Kalender klik → detail sesi.
- `/worship` + `/worship/session`: alur malam → transisi Subuh (tanpa countdown negatif, tanpa auto-centang, aktivitas tidak dihapus) → post-Fajr (L3) → ringkasan sesi. User bebas mencatat sesuai urutan aktual.
- `/worship/dhikr/[id]`: tap besar (min 44px, ideal jauh lebih besar), ring progress, minus koreksi, reset dengan konfirmasi (dicatat correction event), konfirmasi selesai, toggle transliterasi, haptic `navigator.vibrate` jika ada, state "menunggu sinkron". Persist tiap tap, aman jika tab ditutup.
- `/levels`: journey 3 level, locked state, milestone L3.
- Excuse flow tanpa minta alasan.
- E2E Playwright: DZIKIR-01, LEVEL-02 (via skenario mock), REPORT-02, alur sesi lengkap L1.
Done: alur malam L1 dari dashboard sampai ringkasan bisa diklik penuh di 360px; e2e hijau; screenshot di `docs/screenshots/s3/`.

Prompt:
```
Baca CLAUDE.md dan docs/AGENT_BRIEF.md. Kerjakan sesi S3 (Dashboard Istiqomah, Amalan, Sesi Ibadah, Dzikir Counter, Level Journey) sesuai §8, memakai komponen S1 dan domain/mock S2. Prioritas kualitas UX mobile 360px dan aksesibilitas. Akhiri dengan e2e, screenshot, update STATUS dan SESSION_LOG, commit, push.
```

### S4: Screens lanjutan + offline
Scope:
- Auth screens (`/login`, `/auth/verify`, `/access-status`: purchase pending, no active access, session expired) dengan mock auth.
- Onboarding 8 langkah PRD §6.2 (wilayah provinsi→kab/kota, konfirmasi Subuh, target tidur, notifikasi, panduan install PWA per Android/iOS/desktop).
- `/quran` + `/quran/[surah]` UI lengkap (RTL, marker ayat, font size, bookmark, last read, progress, completion, badge "Bacaan Jumat") tetapi data teks dari `QuranRepository`. Tanpa dataset → state "belum diimport".
- `/reports`, `/reports/calendar`, `/notifications`, `/profile`, `/settings` (theme, font Arab, durasi ibadah, notif prefs, quiet hours), `/help` (referensi + disclaimer).
- Service worker: cache app shell, offline banner, IndexedDB mutation queue (operation_id, user scope, entity, type, payload, client_ts, status), sync saat online, purge data privat saat logout.
- E2E: DZIKIR-02 (offline lalu online, tanpa hitung ganda, pakai `context.setOffline`), QURAN-02 (bookmark, dengan fixture non-Qur'an berlabel test), NOTIF-03.
Done: semua route user ada, setiap halaman inti punya state loading/empty/error/offline/expired.

Prompt:
```
Baca CLAUDE.md dan docs/AGENT_BRIEF.md. Kerjakan sesi S4 (auth & onboarding screens, Quran Reader UI tanpa teks generate, reports, settings, offline queue + service worker) sesuai §8. Akhiri dengan e2e, update STATUS dan SESSION_LOG, commit, push. Setelah sesi ini, tulis ringkasan demo prototype untuk owner di docs/DEMO_GUIDE.md.
```

Checkpoint Zen setelah S4: review prototype, beri feedback UI, kirim teks Arab dzikir yang sudah direview pembimbing, logo/aset NgajiGaes.

### S5: Database, RLS, Auth, server services
Prasyarat: Zen menyediakan project Supabase (atau mengizinkan agen membuat project via Supabase MCP). Tanpa ini: agen jalankan Supabase lokal via CLI jika memungkinkan, jika tidak, tulis migration + test SQL saja dan tandai BLOCKED.
Scope:
- Migrations semua tabel PRD §17 (+ `purchase_order_items`, `admin_roles`), constraint unik (user_id+fajr_local_date, client_operation_id, provider+external_event_id, region_id+local_date+provider), index.
- RLS semua tabel privat; tabel backend-only tanpa akses tulis client (PRD §18.3).
- Fungsi Postgres transaksional `apply_counter_operation` (idempotent).
- Supabase Auth email OTP; request-otp respons generik (anti enumeration); link entitlement setelah verifikasi email.
- Route handlers `/api/v1/**` sesuai PRD §19 dengan guard: auth + entitlement aktif + validasi Zod. Server menghitung completion & unlock.
- Seed: levels + activity config dari §4 (provisional), regions contoh berlabel.
- `http` repository di frontend, switch `NEXT_PUBLIC_DATA_MODE=live`.
- Test: SECURITY-01, SECURITY-02, AUTH-05, DZIKIR-03 (server), LEVEL-03/04/05 (server), test RLS.
Prompt:
```
Baca CLAUDE.md dan docs/AGENT_BRIEF.md. Kerjakan sesi S5 (Supabase schema, RLS, auth OTP, API v1, server-authoritative progression) sesuai §8. Jangan asumsikan kredensial tersedia; tanya dulu sebelum membuat project Supabase atau resource berbayar. Akhiri dengan test, update STATUS dan SESSION_LOG, commit, push.
```

### S6: Scalev integration + entitlement
Scope: `POST /api/v1/webhooks/scalev` (raw body, HMAC verify constant-time, simpan event idempotent, ack cepat, proses async), reconciliation (awaiting order verification + retry backoff), validasi product/variant ID dari env, dedupe fulfillment, refund hanya via data resmi/admin teraudit, email instruksi akses via queue.
Test: AUTH-01..04 + out-of-order, paid→settled tidak dobel, missing order details. Fixture payload ditandai `NEEDS_VERIFICATION` sampai dicocokkan dengan payload asli Scalev.
Prompt:
```
Baca CLAUDE.md dan docs/AGENT_BRIEF.md. Kerjakan sesi S6 (Scalev webhook, entitlement, reconciliation, email akses) sesuai §8. Verifikasi format webhook Scalev ke dokumentasi resmi jika bisa diakses; jika tidak, implementasi sesuai PRD dan tandai NEEDS_VERIFICATION. Akhiri dengan test, update STATUS dan SESSION_LOG, commit, push.
```

### S7: Prayer time, Quran import, Web Push + scheduler
Scope:
- `SihatProvider` (backend adapter, token dari env, cache per region/bulan, label "Jadwal tersimpan" saat stale, refresh). Jika API resmi tidak bisa diverifikasi: BLOCKED, mock tetap berlabel.
- Import Tanzil Uthmani untuk 6 bacaan: script `scripts/import-quran.ts`, simpan versi + checksum + atribusi + lisensi; test QURAN-01 membandingkan DB dengan file sumber.
- Web Push VAPID: subscribe/unsubscribe, simpan per device, scheduler (pg_cron → Edge Function), dedupe_key, skip notifikasi terlambat, quiet hours, reschedule saat region/jam tidur berubah, nonaktifkan subscription 404/410, rotasi bedtime.
- Test: PRAYER-01/02, NOTIF-01/02, QURAN-01.
Prompt:
```
Baca CLAUDE.md dan docs/AGENT_BRIEF.md. Kerjakan sesi S7 (prayer time adapter SIHAT, import Qur'an Tanzil terverifikasi, Web Push + scheduler) sesuai §8. Jika host atau kredensial terblokir, berhenti di bagian itu, laporkan apa yang dibutuhkan, lanjut bagian lain. Akhiri dengan test, update STATUS dan SESSION_LOG, commit, push.
```

### S8: Admin dashboard & CMS
Scope: semua route admin PRD §5.3, role (super_admin, content_admin, support_admin, reporting_admin) dicek di server, amalan manager dengan workflow Draft→In Review→Approved→Published, content versioning (snapshot), notification CMS + preview mobile, integration health (webhook gagal, prayer sync, push delivery), audit log before/after. Konten Qur'an tidak bisa diedit via CMS.
Prompt:
```
Baca CLAUDE.md dan docs/AGENT_BRIEF.md. Kerjakan sesi S8 (admin dashboard, amalan manager dengan review workflow, versioning, notification CMS, audit log, RBAC) sesuai §8. Akhiri dengan test, update STATUS dan SESSION_LOG, commit, push.
```

### S9: QA, security review, deploy docs
Scope: jalankan seluruh acceptance PRD §27, Lighthouse mobile, audit a11y (axe), checklist QA PRD §28, security review (secret scan, RLS, rate limit), `docs/DEPLOYMENT.md` (env vars, Supabase, Vercel, SMTP, VAPID, Scalev webhook URL, backup), `docs/LAUNCH_CHECKLIST.md` (PRD §30.3 12 item approval), known limitations.
Prompt:
```
Baca CLAUDE.md dan docs/AGENT_BRIEF.md. Kerjakan sesi S9 (QA menyeluruh, security review, deployment documentation, launch checklist) sesuai §8. Laporkan hasil test apa adanya termasuk yang gagal. Update STATUS final, commit, push.
```

---

## 9. Input yang dibutuhkan dari Zen (owner)

| Kapan | Item | Blocking untuk |
|-------|------|----------------|
| Sebelum S3 (opsional) | Logo NgajiGaes SVG/PNG, aset ilustrasi | Branding final |
| Sebelum S4 | Nomor WhatsApp CS untuk tombol bantuan login | Alur support |
| Sebelum S4 | Pilih ejaan: "Istiqomah" atau "Istikamah" di seluruh UI | Konsistensi copy |
| Setelah S4 | Konfirmasi tanda tangan pembimbing + keputusan koreksi harakat; transliterasi & terjemahan dzikir (opsional) | Status konten `published` |
| Setelah S4 | Konfirmasi target level, aktivitas required, post-Fajr L3, cutoff, backfill | Hapus flag provisional |
| S5 | Project Supabase (URL, anon key, service role key via secret env, bukan chat) | DB & auth real |
| S5 | Provider SMTP (mis. Resend) + domain pengirim | Email OTP production |
| S6 | Scalev: product/variant ID Tahajud Tracker, webhook signing secret, API key, contoh payload asli | Paid access real |
| S7 | Akses/izin API SIHAT Kemenag (atau keputusan provider alternatif) | Jadwal Subuh real |
| S7 | Persetujuan lisensi Tanzil + sumber terjemahan Indonesia yang berizin | Quran Reader real |
| S9 | Kebijakan privasi, S&K, kebijakan refund, retensi data, kebijakan lifetime access + estimasi biaya per user; cek UU PDP & PSE dengan konsultan hukum | Launch |
| Setelah S4 | Keputusan pembimbing: satuan counter rangkaian asma, teks dzikir setelah Qabliyah, aturan mode berhalangan | Konten final |

Kredensial dimasukkan lewat environment settings/secret, jangan ditempel di chat.
