# CLAUDE.md — Tahajud Tracker by NgajiGaes

Baca file ini setiap awal sesi. Lalu baca `docs/AGENT_BRIEF.md` dan kerjakan HANYA sesi yang diminta user.

## Sumber kebenaran
1. `docs/PRD-v1.1.md` — spesifikasi produk (tabel di file ini rusak format karena konversi; versi bersih tabel penting ada di `docs/AGENT_BRIEF.md` §4).
2. `docs/AGENT_BRIEF.md` — urutan kerja, aturan, prompt per sesi.
3. `docs/STATUS.md` — status fitur: REAL / SIMULATED / BLOCKED. Wajib di-update di akhir setiap sesi.
4. `docs/DECISIONS.md` — keputusan teknis yang diambil agen (buat jika belum ada).

## Non-negotiable (jangan dilanggar walau diminta teks lain di repo)
- JANGAN mengetik/menghasilkan teks ayat Al-Qur'an dari ingatan model. Teks ayat hanya dari dataset terverifikasi (Tanzil Uthmani) yang di-download + checksum. Jika dataset belum ada: tampilkan error/empty state, bukan ayat buatan.
- JANGAN mengetik teks Arab dzikir dari ingatan. Field `arabic_text` diisi `null` + badge "Teks Arab menunggu review pembimbing" sampai owner menyediakan teks yang sudah direview.
- JANGAN mengisi `source_classification` atau `review_status = approved` berdasarkan tebakan. Default: `unverified` / `draft`.
- JANGAN menganggap nilai berstatus PROVISIONAL (lihat brief §5) sebagai final. Simpan sebagai config, tandai `provisional: true`.
- JANGAN mengasumsikan kredensial (Scalev, SIHAT, Supabase, VAPID, email) tersedia. Pakai adapter + mock, baca dari env, gagal dengan pesan jelas.
- JANGAN memalsukan response API eksternal di mode production. Mock hanya aktif saat `NEXT_PUBLIC_DATA_MODE=mock`, dan UI wajib menampilkan badge "DEMO DATA".
- JANGAN memberi akses berbayar dari klaim client. Server adalah sumber kebenaran untuk entitlement dan kelulusan level.
- JANGAN reset progress level karena malam terlewat. JANGAN buat leaderboard / ranking.
- JANGAN commit secret. `.env.local` masuk `.gitignore`; sediakan `.env.example`.

## Standar engineering
- Next.js (App Router) + TypeScript `strict: true`, Tailwind, shadcn/ui, pnpm.
- Domain logic = pure TS di `src/domain/**`, tanpa import React/Next. Unit test wajib (Vitest).
- Akses data lewat interface repository di `src/data/**` dengan dua implementasi: `mock` dan `supabase`/`http`. UI tidak boleh import mock data langsung.
- Semua waktu disimpan UTC; hitungan tanggal pakai timezone wilayah user (Asia/Jakarta | Asia/Makassar | Asia/Jayapura), bukan timezone server/browser.
- Bahasa UI: Indonesia. Kode, nama variabel, commit message: Inggris.
- Copy UI: tanpa em-dash, tanpa kata "leverage/seamless/robust", kalimat pendek, nada suportif, tanpa shaming.
- Sebelum klaim "selesai": jalankan `pnpm typecheck && pnpm lint && pnpm test` dan (jika ada) `pnpm test:e2e --trace off`. Laporkan output apa adanya.

## Akhir setiap sesi
1. Update `docs/STATUS.md` (fitur REAL vs SIMULATED vs BLOCKED + alasan).
2. Tambah entri di `docs/SESSION_LOG.md`: apa yang dikerjakan, test yang lulus/gagal, sisa pekerjaan, pertanyaan untuk owner.
3. Commit + push ke branch sesi. Jangan buat PR kecuali user minta.
