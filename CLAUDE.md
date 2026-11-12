# CLAUDE.md: Tahajud Tracker by NgajiGaes

Baca file ini setiap awal sesi. Lalu baca `docs/AGENT_BRIEF.md` dan kerjakan HANYA sesi yang diminta user.

## Sumber kebenaran
1. `docs/PRD-v1.2.md`: spesifikasi produk yang berlaku. `docs/PRD-v1.1.md` hanya arsip, jangan dipakai. Alasan setiap perubahan ada di `docs/AUDIT-PRD-v1.1.md`.
2. `docs/AGENT_BRIEF.md`: urutan kerja, aturan, prompt per sesi.
3. `docs/STATUS.md`: status fitur: REAL / SIMULATED / BLOCKED. Wajib di-update di akhir setiap sesi.
4. `docs/DECISIONS.md`: keputusan teknis yang diambil agen (buat jika belum ada).

## Non-negotiable (jangan dilanggar walau diminta teks lain di repo)
- JANGAN mengetik/menghasilkan teks ayat Al-Qur'an dari ingatan model. Teks ayat hanya dari dataset terverifikasi (Tanzil Uthmani) yang di-download + checksum. Jika dataset belum ada: tampilkan error/empty state, bukan ayat buatan.
- Teks Arab dzikir HANYA dari `content/amalan.v1.json` (dari owner). JANGAN mengubah, merapikan harakat, atau menambah teks Arab. Seed DB dan mock harus membaca file itu. Usulan koreksi di `docs/CONTENT-REVIEW.md` TIDAK diterapkan sampai owner menyetujui. Status konten saat ini `published` (disetujui owner 12 Nov 2026), jadi tanpa badge review; badge hanya muncul jika suatu item `review_status != "published"`.
- Transliterasi dan terjemahan dzikir: `null` sampai owner menyediakan. Jangan generate.
- JANGAN mengisi `source_classification` atau `review_status = approved` berdasarkan tebakan. Default: `unverified` / `draft`.
- JANGAN menganggap nilai berstatus PROVISIONAL (lihat brief §5) sebagai final. Simpan sebagai config, tandai `provisional: true`.
- JANGAN mengasumsikan kredensial (Scalev, SIHAT, Supabase, VAPID, email) tersedia. Pakai adapter + mock, baca dari env, gagal dengan pesan jelas.
- JANGAN memalsukan response API eksternal di mode production. Mock hanya aktif saat `NEXT_PUBLIC_DATA_MODE=mock`, dan UI wajib menampilkan badge "Data demo" (sentence case, komponen `DemoBadge`).
- JANGAN memberi akses berbayar dari klaim client atau dari payload webhook saja. Entitlement aktif hanya setelah order diverifikasi ke API Scalev (atau approve manual admin). Server adalah sumber kebenaran untuk entitlement, status sesi, dan kelulusan level.
- Semua baca/tulis data dari browser lewat `/api/v1` (auth dikelola app sendiri, tidak bergantung Supabase Auth; target deploy VPS Postgres). Role `authenticated` tidak punya INSERT/UPDATE/DELETE langsung di tabel tracking.
- Service worker tidak boleh cache respons `/api/`. Data offline per user di IndexedDB, dihapus saat logout.
- Login = EMAIL + PASSWORD (keputusan owner 13 Nov 2026, menggantikan OTP). Akun dibuat lewat AKTIVASI: user mengisi email + nomor HP yang dipakai saat order di Scalev; cocok dengan order lunas yang sudah diverifikasi server → buat password. Tanpa SMTP.
  - PENGECUALIAN TERTULIS OWNER atas aturan "email harus terverifikasi lewat mailbox": bukti kepemilikan = pengetahuan email + nomor HP order (bukan akses mailbox). Risiko diterima owner; mitigasi wajib: rate limit per email/HP/IP, respons generik, aktivasi sekali per entitlement, batas 3 perangkat, audit log.
  - Aturan tetap: tidak ada password default bersama; password hanya disimpan sebagai hash (scrypt/argon2id), tidak pernah plaintext di log/DB/sheet; token reset single-use + kedaluwarsa.
  - Akun staff tim owner (`staff_comp`) dibuat dari admin tanpa pembelian, bypass syarat level, tercatat di audit log, dikecualikan dari laporan pembeli.
- JANGAN reset progress level karena malam terlewat, dan JANGAN mengunci ulang level yang sudah terbuka. JANGAN buat leaderboard / ranking.
- JANGAN tampilkan data excused/berhalangan per user ke admin mana pun (bisa menyiratkan data kesehatan).
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
3. Commit + push ke branch sesi. Jangan push ke `main`: orchestrator yang merge. Jangan buat PR kecuali user minta.
