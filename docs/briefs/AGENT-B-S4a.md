# Brief Agen B: S4a offline, service worker, data auth/profil (non-UI)

Baca dulu: `CLAUDE.md`, `docs/briefs/PARALLEL-RULES.md`, `docs/PRD-v1.2.md` §6.1, §6.2, §6.4, §11.1, §19.1-19.2, §21, §24.1, `docs/sessions/S2.md`.

## Tugas
1. Kontrak + repository baru di `src/data/` (tambahan, tanpa mengubah yang lama):
   - `AuthRepository` (mock): `requestOtp(email)` dengan respons selalu generik, `verifyOtp(email, code)`, `logout()`, `listDevices()`, `revokeDevice(id)`. Aturan mock mengikuti PRD §24.1: OTP 6 digit, berlaku 10 menit, maks 5 percobaan per kode, 5 permintaan per email per jam, jeda kirim ulang 60 detik. Kode OTP mock terlihat di dev tools saja, bukan di UI produksi.
   - `ProfileRepository`: profil, `setLocation` (region atau jadwal manual), `completeOnboarding` (menetapkan `program_start_date` sesuai S2-3), preferensi tampilan.
   - Skenario mock tambahan: belum login, purchase pending, no active access, sesi kedaluwarsa.
2. `src/offline/`: antrean mutasi IndexedDB per user (`tahajud-<userId>`), field PRD §21.2, flush saat online/app dibuka, retry dengan backoff, hasil `accepted/duplicate/rejected` dipetakan ke status antrean, tidak ada yang dibuang diam-diam (rejected disimpan untuk ditampilkan). API untuk UI: `pendingCount()`, `subscribe()`, `flushNow()`, `canLogoutSafely()`, `purgeUser(userId)`.
3. Service worker (pilih Serwist atau tulis manual, catat alasan): cache app shell + aset statis + font; JANGAN cache `/api/`; fallback offline untuk navigasi; versi cache + pembersihan cache lama; prompt update tersedia. Registrasi hanya di production atau dengan flag.
4. `src/components/pwa/`: panduan install per platform (Android Chrome, iOS Safari dengan langkah "Bagikan > Tambah ke Layar Utama", desktop) dan deteksi `display-mode: standalone`. Komponen saja; penempatan di layar dilakukan di ronde 3.
5. `navigator.storage.persist()` helper.
6. `eslint.config.mjs`: `no-restricted-imports` untuk `src/domain/**` (larang `react`, `next`, `@/components`, `@/app`, `@/data`).
7. Test: unit untuk antrean (fake-indexeddb), aturan OTP mock (AUTH-06 versi mock), DZIKIR-02 (offline lalu online tanpa hitung ganda, level antrean + mock), DZIKIR-06 (`canLogoutSafely` false saat ada pending), SECURITY-06 (purgeUser menghapus DB user). E2E `tests/e2e/s4a-*.spec.ts`: service worker terpasang di build production, `/api/` tidak ada di Cache Storage, halaman offline fallback muncul saat `context.setOffline(true)`.

## Skill
using-superpowers, ponytail, antislop-code (komentar), antislop-copywriting (copy panduan install), antislop-human (aksesibilitas komponen PWA). Catat skill yang benar-benar dipanggil.

## Definition of done
- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e --trace off` lolos, output asli di `docs/sessions/S4a.md`.
- Coverage `src/offline/**` dan logika auth mock ≥ 90% lines.
- Commit + push ke branch sesi (bukan main).
