# STATUS: Tahajud Tracker

Update di akhir setiap sesi. Legend: REAL = jalan dengan logic/data sungguhan · SIMULATED = mock berlabel DEMO · BLOCKED = butuh kredensial/approval · TODO = belum dikerjakan.

Sesi terakhir: S1 WIP (dimulai orchestrator, dilanjutkan agen) · 2026-11-12
Spesifikasi berlaku: `docs/PRD-v1.2.md`

| Area | Fitur | Status | Catatan / blocker |
|------|-------|--------|-------------------|
| Foundation | Project setup, tooling | REAL (WIP) | Next 15.5.29, TS strict, Tailwind v4, Vitest, Playwright, audit bersih. E2E belum dijalankan |
| Design | Tokens, komponen, app shell | REAL (WIP) | Token light/dark lolos AA (60 unit test). Shell + gallery `/dev/components`. Sisa: SITEMAP, DESIGN_SYSTEM, e2e, screenshot, Floor review |
| Domain | Session key, state machine, progression, reporting, counter, wake planner, rotasi | TODO | S2 |
| UI | Dashboard Istiqomah | TODO | S3 |
| UI | Worship session + transisi Subuh | TODO | S3 |
| UI | Dzikir counter | TODO | S3 |
| UI | Level journey | TODO | S3 |
| UI | Auth, onboarding, access status | TODO | S4 |
| UI | Quran Reader | TODO | S4 (UI) / S7 (dataset) |
| UI | Reports, calendar, settings, notifications, help | TODO | S4 |
| Offline | IndexedDB queue + service worker | TODO | S4 |
| Backend | Supabase schema + RLS | TODO | S5, butuh project Supabase |
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
