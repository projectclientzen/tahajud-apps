# Brief U2 (Sonnet, effort high): perubahan mayor Munaja (M1 sampai M6)

Basis: `main` terbaru. Branch `claude/u2-munaja`. Spesifikasi: `docs/CHANGE-2026-11-13-MUNAJA.md` (sumber kebenaran untuk perubahan ini, menimpa PRD v1.2 bila bertentangan). Aturan: `CLAUDE.md`. Panggil skill `anthropic-skills:ui-ux-pro-max`, `anthropic-skills:antislop-ui`, `anthropic-skills:antislop-layoutmobile` sebelum mengubah UI.

## Urutan (commit + push per tahap)
1. M4 navigasi + M1 rename "Munaja" (kecil, cepat). Update e2e/screenshot yang terdampak.
2. M2a reader lengkap: perluas `scripts/import-quran.ts` agar mengekspor 114 surah dari file sumber yang sama (checksum tetap), dipecah per surah (static JSON di `public/quran/` atau import dinamis, pilih yang ringan untuk PWA offline; SW boleh cache aset statis, TIDAK boleh cache `/api/`). Unduh metadata halaman/juz Tanzil (`https://tanzil.net/res/text/metadata/quran-data.js` atau versi xml), simpan di `content/quran/source/`, catat URL + SHA-256 + lisensi di SOURCE.md, uji: 604 halaman, 30 juz, 6236 ayat, batas halaman 1 = 1:1..1:7. Bila metadata tidak bisa diunduh: STOP tahap halaman, laporkan, tetap kirim navigasi surah/juz yang bisa diverifikasi. Aturan basmalah tetap.
3. M2b khatam: domain murni `src/domain/khatam/**` (rencana 30 hari, 4N halaman per waktu salat, sisa ke hari terakhir, progres, status), unit test lengkap (batas N=1 dan 5, zona waktu WIB/WITA/WIT, hari terlewat, ganti target). Repository mock + http, migration `20261117200000_khatam.sql` (tabel target + log baca, RLS, fungsi SECURITY DEFINER, tanpa INSERT/UPDATE langsung untuk `authenticated`), endpoint `/api/v1/khatam/**`, antrean offline. Tab Al-Qur'an: kartu target + grafik lingkaran (SVG, aksesibel, ada teks angka) + checklist 5 waktu hari ini + lanjut baca + daftar surah/juz.
4. M5 riwayat level di tab Amalan (hanya level yang sudah dicapai, hanya baca, isi amalan + rekap).
5. M6 tombol niat di langkah salat, baca `content/niat.v1.json` (JANGAN mengisi teks; semua null sekarang → empty state).
6. M3 lokasi otomatis di onboarding: hitung kota terdekat di klien (haversine) dari `content/regions/wikidata-coordinates.json`, konfirmasi, fallback manual, koordinat tidak dikirim/disimpan. Hapus langkah atur waktu manual di onboarding. Test unit (kota terdekat) + e2e (izin ditolak → manual; mock geolocation Playwright → konfirmasi).

## Kepemilikan file
Boleh: `src/app/(app)/**`, `src/app/(onboarding)/**` atau lokasi onboarding yang ada, `src/components/**` (KECUALI `src/components/admin/**`, `src/components/auth/**` selain rename nama app), `src/domain/{quran,khatam,content,onboarding,regions}/**`, `src/data/**` (bagian quran/khatam/region), `src/offline/**` (op baru), `src/server/api/routes.ts` + `src/app/api/v1/khatam/**`, `src/server/khatam/**`, `supabase/migrations/20261117200000_khatam.sql`, `scripts/import-quran.ts`, `content/quran/**` (hasil skrip saja), `public/quran/**`, `public/manifest*`, `src/app/layout.tsx`, `tests/unit/**` dan `tests/e2e/**` yang terkait, `tests/db/khatam-*`, `tests/db/schema.test.ts` (baris milikmu).
Jangan sentuh: `src/server/{scalev,jobs,admin,auth}/**`, `content/amalan.v1.json`, `content/niat.v1.json`, migration lain, dokumen orchestrator selain `docs/sessions/U2.md`, baris STATUS milikmu, entri SESSION_LOG-mu. Sesi X2-A paralel memegang jobs + Scalev.

## Aturan keras
Tanpa teks ayat atau teks Arab dari ingatan model. Tanpa leaderboard. Tanpa shaming. Copy tanpa em-dash. Data demo bertanda "Data demo".

## Selesai
`pnpm typecheck && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e --trace off && pnpm audit --prod` hijau. Laporan `docs/sessions/U2.md` + screenshot 390px di `docs/preview/u2-*.png`. Push ke branch-mu, kirim ringkasan ke sesi orchestrator `session_01HkFB32yhrjHP63xkJdKYto`.
