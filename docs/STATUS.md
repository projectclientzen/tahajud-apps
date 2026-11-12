# STATUS: Tahajud Tracker

Update di akhir setiap sesi. Legend: REAL = jalan dengan logic/data sungguhan · SIMULATED = mock berlabel DEMO · BLOCKED = butuh kredensial/approval · TODO = belum dikerjakan.

Sesi terakhir: S1 WIP (dimulai orchestrator, dilanjutkan agen) · 2026-11-12
Spesifikasi berlaku: `docs/PRD-v1.2.md`

| Area | Fitur | Status | Catatan / blocker |
|------|-------|--------|-------------------|
| Foundation | Project setup, tooling | REAL | Next 15.5.29, TS strict, Tailwind v4, Vitest, Playwright, audit bersih. Typecheck, lint, 60 unit, 38 e2e (mobile 320px + desktop 1280px) lolos per S1 lanjutan |
| Design | Tokens, komponen, app shell | REAL | Token light/dark lolos AA (49 unit test + axe 0 serious/critical). Shell, komponen dasar + 3 state baru di `/dev/components`. `docs/SITEMAP.md`, `docs/DESIGN_SYSTEM.md`, screenshot di `docs/screenshots/s1/`, Hallmark Floor 16/16 (manual). Wordmark dan ikon PWA masih placeholder |
| Domain | Session key, state machine, progression, reporting, counter, wake planner, rotasi | REAL | S2 merged ke main. 210 test lulus, coverage domain 100% lines. Mock repository + skenario SIMULATED (DEMO DATA). Mode live = stub sampai S5. Insight: ambang dari agen, perlu persetujuan owner. Detail: `docs/sessions/S2.md` |
| UI | Dashboard Istiqomah | SIMULATED | S3: section A-I, filter 7/30/90, kalender, mode berhalangan. Data dari mock layer (badge Data demo). Tanpa ikon notifikasi dan pengaturan (ronde 3) |
| UI | Worship session + transisi Subuh | SIMULATED | S3: `/worship`, `/worship/session`, banner Subuh, ringkasan inline. Al-Waqi'ah dan Ayat Seribu Dinar berupa centang, Reader menyusul |
| UI | Dzikir counter | SIMULATED | S3: tap 176px, coalescing domain S2, reset `set_zero`, Wake Lock. Antrean di memori, IndexedDB queue di S4a. Wake Lock dan getar belum diuji di perangkat nyata |
| UI | Level journey | SIMULATED | S3: `/levels`, state terkunci, milestone Level 3. Syarat level PROVISIONAL |
| UI | Auth, onboarding, access status | TODO | S4 |
| UI | Quran Reader | TODO | S4 (UI) / S7 (dataset) |
| UI | Reports, calendar, settings, notifications, help | TODO | S4 |
| Offline | IndexedDB queue + service worker | REAL (logic), belum di layar | S4a di branch sesi (belum merge): antrean per user, sender, trigger, SW (shell + aset statis, `/api/` tidak di-cache), offline fallback, komponen panduan pasang. Diuji di Chromium; Safari iOS belum. Auth OTP + profil repository SIMULATED (mock), live = stub sampai S5. Pemasangan ke UI di ronde 3. Detail: `docs/sessions/S4a.md` |
| Backend | Supabase schema + RLS | REAL (diuji di PGlite), belum di Supabase | T3a di branch sesi (belum merge): 35 tabel PRD §17, RLS di semua tabel, `authenticated` hanya SELECT + 4 RPC, fungsi `apply_counter_operation` (lolos uji paritas dengan domain), `ensure_active_session`, `set_checklist`, progres level, seed dari JSON owner. 123 test DB. Docker tidak ada, jadi belum dicoba di Supabase/PostgreSQL 15-17. Fungsi baca, excuse, onboarding, perangkat ke-4 menunggu T3b. Detail: `docs/sessions/T3a.md` |
| Backend | Auth OTP + entitlement guard | TODO | S5 |
| Backend | API v1 + server progression | TODO | S5 |
| Integrasi | Scalev webhook + reconciliation | TODO | S6, butuh secret + payload asli |
| Integrasi | SIHAT prayer times | TODO | S7, izin API belum jelas |
| Integrasi | Quran Tanzil import | TODO | S7, lisensi + akses host |
| Integrasi | Web Push + scheduler | TODO | S7, VAPID keys |
| Admin | CMS, RBAC, audit | TODO | S8 |
| QA | Acceptance PRD §27, a11y, security, deploy docs | TODO | S9 |

## Konten agama
| Item | Status |
|------|--------|
| Teks Arab dzikir | PUBLISHED (owner): `content/amalan.v1.json` v1.1.0. 8 usulan koreksi belum diputuskan |
| Lafaz asma | SELESAI: Ya Kafi (كافي) |
| source_classification | BLOCKED: tidak boleh diisi tebakan |
| Nilai provisional (PRD v1.2 §30.2) | PROVISIONAL |
| Satuan counter rangkaian asma | SELESAI: putaran |
| Teks dzikir setelah Qabliyah | SELESAI: tasbih malaikat 100 |
| Cakupan post-Fajr | SELESAI: semua level; tilawah malam opsional; Al-Waqi'ah wajib |
| Aturan mode berhalangan | PROVISIONAL: perlu pembimbing |
