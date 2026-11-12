# STATUS — Tahajud Tracker

Update di akhir setiap sesi. Legend: REAL = jalan dengan logic/data sungguhan · SIMULATED = mock berlabel DEMO · BLOCKED = butuh kredensial/approval · TODO = belum dikerjakan.

Sesi terakhir: S0 (orchestration brief) · 2026-11-12

| Area | Fitur | Status | Catatan / blocker |
|------|-------|--------|-------------------|
| Foundation | Project setup, tooling | TODO | S1 |
| Design | Tokens, komponen, app shell | TODO | S1 |
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
| Teks Arab dzikir | BLOCKED: menunggu teks dari owner yang sudah direview pembimbing |
| Lafaz "Ya Khafi" | BLOCKED: verifikasi |
| source_classification | BLOCKED: tidak boleh diisi tebakan |
| Nilai provisional (brief §5) | PROVISIONAL |
