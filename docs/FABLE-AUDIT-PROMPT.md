# Prompt audit Fable (dibuat orchestrator, 14 Nov 2026)

Owner menyalin blok di bawah ke sesi Claude Code baru (model Fable) dengan repo `projectclientzen/tahajud-apps`.

```
Kamu auditor akhir untuk app Munaja (dulu "Tahajud Tracker", PWA Next.js + Postgres) di repo ini, branch main. Mode HEMAT: kuota terbatas. Kerja read-only, jangan ubah kode, jangan buat PR, jangan jalankan e2e penuh. Boleh menjalankan test tertentu (vitest satu file) hanya untuk membuktikan temuan.

Baca dulu: CLAUDE.md (aturan non-negotiable), docs/DECISIONS.md bagian 13 Nov 2026, docs/sessions/SCALEV-AUTH-PLAN.md §8.

FOKUS (urut prioritas, berhenti di area 4 bila konteks mulai berat):
1. Auth: aktivasi email + HP order, login, rate limit, token reset admin, batas 3 perangkat, cookie sesi, hash password. File: src/server/auth/**, src/server/api/**, src/app/api/v1/auth/**, supabase/migrations/20261116030000_auth_password.sql.
2. Scalev: verifikasi HMAC, idempotensi, worker GET order, pembuatan entitlement, karantina. File: src/server/scalev/**, src/app/api/v1/webhooks/scalev/route.ts, migrations 20261117020000 dan 20261117030000.
3. Admin dan otorisasi DB: RBAC, MFA TOTP, staff_comp, tautan reset, privasi (data excused per user tidak boleh terlihat admin, HP hanya hash), fungsi SECURITY DEFINER dan grant/RLS. File: src/server/admin/**, migrations 20261117100000..140000, semua migration lain untuk grant.
4. Integritas konten dan aturan domain: teks Qur'an hanya dari Tanzil + checksum, teks Arab dzikir/niat hanya dari content/*.json owner, level tidak pernah di-reset atau dikunci ulang, hitungan tanggal pakai timezone wilayah, matematika khatam. File: scripts/import-quran.ts, src/domain/**, src/components/quran/**, migration 20261117200000.

SUDAH DIKETAHUI, JANGAN DILAPORKAN ULANG:
- Tombol "approve manual" admin masih ada; akan diganti "cek ulang ke Scalev".
- Data khatam belum ada di /me/data-export; tabel regions live baru 3 wilayah demo.
- Skrip deploy VPS belum ditulis; bentuk respons Scalev nyata (NEEDS_VERIFICATION) belum dicek.
- Logo, nomor CS, harga belum ada. Nilai berlabel PROVISIONAL memang sementara.

ABAIKAN: gaya UI, copy, performa, cakupan test yang hanya "kurang lengkap".

FORMAT LAPORAN (di chat, maksimal 20 temuan, urut paling parah):
| # | Tingkat (Kritis/Tinggi/Sedang/Rendah) | file:baris | Masalah (1 kalimat) | Skenario gagal konkret | Usulan perbaikan (1-2 kalimat) | Keyakinan (Tinggi/Sedang/Rendah) |
Lalu: 3 risiko terbesar sebelum launch, dan daftar area yang TIDAK sempat diperiksa. Jangan mengarang temuan; kalau ragu tulis keyakinan Rendah atau lewati.
```
