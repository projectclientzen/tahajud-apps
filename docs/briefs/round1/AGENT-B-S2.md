# Brief Agen B: S2 domain engines, kontrak data, mock repository (TDD)

Baca dulu: `CLAUDE.md`, `docs/briefs/PARALLEL-RULES.md`, `docs/PRD-v1.2.md` §9-15, §19, §21, §22, §27, `docs/AGENT_BRIEF.md` §4 dan §5, `content/amalan.v1.json`.

## Prinsip
- Semua logika di `src/domain/**` adalah pure TypeScript: tanpa React/Next, tanpa `Date.now()` tersembunyi. Waktu (`now`), timezone, dan settings selalu masuk sebagai parameter.
- TDD: tulis test dulu. Nama test diawali ID acceptance PRD, misalnya `it("SESSION-03 ...")`.
- Nilai PROVISIONAL (PRD §30.2) disimpan di `src/domain/config/provisional.ts` dengan flag `provisional: true`, bukan konstanta tersebar.
- Konfigurasi level dibaca dari `content/amalan.v1.json`. Jangan menyalin atau mengubah teks Arab.
- Timezone: Indonesia tanpa DST (WIB +7, WITA +8, WIT +9). Jadwal manual bisa memakai zona IANA lain, jadi pakai `Intl`. Hindari library tanggal kecuali benar-benar perlu; jika dipakai, catat alasannya.

## Modul yang dibangun
| Modul | Isi minimum | Test wajib |
|-------|-------------|------------|
| `config/` | settings provisional: cutoff 12.00, koreksi 48 jam, target level 7/12/20, durasi 60/120/150, buffer 10, ambang tidur 5 jam, batas berhalangan 15 hari, kedaluwarsa notifikasi per tipe | snapshot nilai |
| `content/` | loader typed dari JSON → `LevelConfig`; snapshot aktivitas per sesi | total dzikir 400/1.550/1.863, rakaat 5/9/11 |
| `session/` | `localDate(instant, tz)`, `cutoffInstant(date, tz)`, `activeSessionKey(now, tz)`, `isWithinCorrectionWindow`, state machine + transisi legal | SESSION-01, -03, -04 |
| `session/status` | `computeSessionStatus(activities, …)` otomatis (tuntas jika semua required selesai; partial butuh progres > 0) | LEVEL-04, BUG-06/07 di audit |
| `calendar/` | kalender dari `program_start_date` sampai sesi aktif; missed derived; excused tunggal + rentang | SESSION-02, SESSION-06 |
| `progression/` | progress per level dari snapshot, unlock efektif sesi berikutnya, level monoton, milestone L3 | LEVEL-01, -02, -03, -05, SESSION-05 |
| `reporting/` | status counts, completion rate (null jika penyebut 0, mulai `program_start_date`), statistik per amalan, filter 7/30/90, insight template (5 jenis, tanpa skor spiritual) | REPORT-01, REPORT-02 |
| `dhikr/` | reducer lokal: tap, coalesce/flush (2 detik / target / hidden), ack server, `set_zero`, clamp jam client; server-side `applyOperation` idempoten per (user, operation_id), tidak pernah negatif | DZIKIR-01, -03, -04, -05 |
| `prayer/` | wake planner + peringatan tidur < 5 jam, jendela Al-Kahfi (fallback 18.00 untuk jadwal manual), sumber jadwal provider/cached/manual | PRAYER-03 (versi domain) |
| `notifications/` | rotasi bedtime (hindari 14 terakhir, lalu yang paling lama tidak dikirim), dedupe key, kedaluwarsa, quiet hours | NOTIF-01, NOTIF-04, NOTIF-05 |

## Data layer
- `src/data/contracts.ts`: tipe request/response sesuai PRD v1.2 §19 (dashboard, session, counter batch, ringkasan, excuse, laporan, kalender, Qur'an progress, preferensi notifikasi). Boleh pakai Zod agar schema bisa dipakai ulang di API S5.
- Interface repository per domain (`SessionRepository`, `ReportRepository`, dst.).
- `src/data/mock/`: implementasi mock memakai fungsi domain, persist ke IndexedDB per user (`tahajud-<userId>`), dengan:
  - jam yang bisa disuntik (time travel) untuk dev panel S3,
  - skenario: akun baru, 5 malam tuntas, Level 2 aktif, offline, jadwal stale, purchase pending, jadwal manual,
  - setiap file fixture diawali `// DEMO DATA: bukan data asli`.
- `src/data/index.ts`: pilih implementasi dari `NEXT_PUBLIC_DATA_MODE` (implementasi `http` cukup stub yang melempar "belum tersedia sampai S5").
- Test IndexedDB di Node: pakai `fake-indexeddb`.

## Dependency yang boleh ditambah
`zod`, `idb` (atau `dexie`), `fake-indexeddb` (dev), `@vitest/coverage-v8` (dev). Selain itu catat alasannya di file sesi.

## Skill
using-superpowers (alur brainstorm → plan → TDD jika skill pendukung tersedia), ponytail (solusi paling sederhana yang benar), antislop-code (komentar kode), antislop-copywriting / stop-slop untuk dokumen dan label UI di `session-status.ts`.

## Definition of done
- `pnpm typecheck && pnpm lint && pnpm test` lolos. Coverage `src/domain/**` ≥ 90% lines (`vitest run --coverage`).
- Semua ID test di tabel lulus, nama test memuat ID-nya.
- Tidak ada import React/Next di `src/domain/**` (tambahkan test atau lint rule yang memeriksa ini).
- Laporan di `docs/sessions/S2.md`, STATUS baris Domain diperbarui.
- Commit + push ke branch sesi (bukan main).
