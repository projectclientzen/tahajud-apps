> DIJEDA OLEH OWNER (13 Nov 2026 ~20.45 WIB): semua pekerjaan sudah di main, tidak ada agen aktif. Lanjut HANYA setelah owner memberi kabar domain/VPS + setup Scalev (Hermes, `docs/HERMES-PROMPT.md`) + email super_admin. Logo menyusul.
> Main berisi: auth email+password, jobs/notifikasi (T6), Scalev webhook+worker (X2-A, tidak aktif tanpa secret), Munaja U2 (Qur'an lengkap, khatam, nav, riwayat level, niat owner, lokasi otomatis), admin T7+X8 (X2-B). Gerbang terakhir: unit 1533 + 3 skip, db 344, e2e mock 352, live 38, admin 20, audit bersih.
> Sisa kerja saat lanjut (urut): (0) ganti approve manual admin dengan cek ulang ke Scalev (DECISIONS 13 Nov, Q-X2B); (1) brief kecil: data khatam di `/me/data-export` + impor 517 wilayah ke tabel `regions` (pakai `content/regions/crosscheck-coordinates.json`); (2) X1 VPS Postgres runner + deploy docs; (3) T8 QA + launch checklist; (4) prompt audit Fable untuk owner; (5) T9 perbaikan; (6) aktivasi Scalev dengan data nyata Hermes (NEEDS_VERIFICATION di `docs/sessions/X2-A.md`).
> Pertanyaan owner terbuka: Q-X2B-1..5 (`docs/sessions/X2-B.md`), pertanyaan U2 (`docs/sessions/U2.md`), PROV password/limit, Q14 format HP.
> DIJEDA OLEH OWNER (13 Nov 2026 06.55 WIB): tidak ada agen atau jadwal aktif. Lanjut HANYA atas perintah owner. Posisi: main @ 90fe8ee (Q1 + T3c + T3b merged, CLAUDE.md auth email+password). Rencana Scalev + auth final: branch claude/scalev-email-pass @ 65adeae, docs/sessions/SCALEV-AUTH-PLAN.md §8. Eksekusi bagian 1 (sesi session_01HkFB32vWd22ucHjTFVhCQu) dihentikan sebelum/sesaat setelah mulai; cek branch itu sebelum melanjutkan. T6 (claude/t6-job-runner) dan T7 (claude/t7-admin) WIP, belum merge. Menunggu jawaban Hermes (prompt di docs/HERMES-PROMPT.md).
 (diperbarui 12 Nov 2026 19.50 WIB)

Dipakai jika sesi orchestrator berhenti (limit token, error) dan dilanjutkan oleh jadwal otomatis atau sesi baru.

## Posisi (19.50 WIB)
- `main` = T1 (versi Agen A lama) + T1b (batas 3 perangkat, perbaikan e2e T1-T2, checklist lewat antrean, pesan revoked) + T2 + T3a + T4 + T4b. Gerbang penuh hijau: unit 549 (+3 live skip), e2e 210 passed / 14 skipped / 0 failed, audit bersih.
- T1 versi sesi baru (`claude/t1-auth-onboarding` e7ebbc2) TIDAK dipakai (digantikan T1b yang menambahkan batas perangkat di atas versi Agen A).
- Semua sesi agen gagal ~15.25 WIB karena limit token; U1a, U1b, T3b, T4c baru mulai dan tidak menghasilkan commit. Harus dijalankan ulang di SESI BARU (sesi lama membawa context besar dan sebagian menolak pesan antar-sesi).

## Sesi aktif (20.30 WIB, main 2333cb7)
- Selesai & merged: U1a, U1b, T4c (+ T1, T1b, T2, T3a, T4, T4b).
- Berjalan: T3b session_01HkFB31WZSsK53dbhMBNkZk (API v1 + data live), Q1 session_01HkFB2yjk91AbSymgLRYH8V (stabilkan e2e flaky).

## Urutan berikutnya (prioritas owner: UI/UX dulu)
1. Tunggu T3b dan Q1. Owner diberi tahu bahwa UI siap direview (U1a+U1b merged).
2. Setelah T3b merged: T5 + T6 paralel, lalu T7, T8, lalu prompt audit Fable untuk owner.
Catatan limit: reset terakhir 19.40 WIB; jendela 5 jam. Simpan pekerjaan dengan push WIP berkala.

## Keputusan owner yang berlaku (ringkas)
Batas 3 perangkat (ke-4 ditolak), sesi 30 hari, label "Sedang berjalan", legenda syarat aplikasi, post-Fajr semua level, tilawah malam opsional, Al-Waqi'ah wajib, tanpa terjemahan Qur'an (default), EQuran.id dipakai (izin komersial dikirim owner setelah MVP, sebelum launch), nomor CS dan link Scalev diisi saat build produksi, logo/nama app belum final.

## Aturan orchestrator
Agen push ke branch sesi; hanya orchestrator yang merge ke main setelah typecheck, lint, test, test:e2e --trace off, audit lolos di hasil gabungan. Jangan force-push. Tanya owner hanya untuk approval, kredensial, biaya, legal, konten agama, keputusan produk baru.

## Catatan biaya
Sesi agen lama (agen a, agen b) membawa context 570-620 ribu token, sehingga tiap langkahnya mahal. Tugas baru berikutnya dijalankan di sesi baru (create_session); sesi baru menerima tugas dari prompt pembukanya, sedangkan sesi lama yang tidak dibuat orchestrator bisa menolak pesan antar-sesi.

## Status WIP R4 saat dihentikan (05.39 WIB 13 Nov)
| Agen | Branch @ commit | Sudah | Belum |
|------|-----------------|-------|-------|
| Q1 | claude/q1-e2e-flaky @ 24f055e | merge main, unit 819, audit bersih, 1 run penuh e2e 260/0 failed | bukti 3 run penuh berturut-turut |
| T3c | claude/t3c-api-missing @ 31f2bda | 8 endpoint, migration 20261115010000, kode error baru, http repo, unit 966 | test:e2e, test:e2e:live, audit |
| T6 | claude/t6-job-runner @ df299d9 | jobs/notifications/worker/cron, test per file lulus, test:db 210 | test TTL push, gerbang penuh, smoke worker, .env.example |
| T7 | claude/t7-admin @ becd1a2 | migration admin, MFA TOTP sendiri, audit, workflow, support tools, API admin, 17 test | UI /admin, test workflow/PRIV-01, e2e, bootstrap super_admin, gerbang penuh |

Catatan integrasi saat merge (orchestrator):
- Tambah `INTERNAL_ERROR` dan `FORBIDDEN_ORIGIN` ke TRANSIENT di `src/offline/sender.ts`, kalau tidak 500 membuat antrean offline membuang operasi (temuan T3c).
- Penamaan migration bentrok aturan 14 digit di `tests/db/schema.test.ts`; T6 melonggarkan regex, T7 pakai `20261115c*`. Seragamkan: T3c 20261115010000, T6 20261115020000, T7 20261115030000.
- Daftar tabel/RPC di `tests/db/schema.test.ts` perlu digabung (admin_sessions, admin_mfa_factors, RPC T6/T7).
- `regions` di DB baru berisi DEMO: muat wilayah EQuran (`content/regions/`) ke DB agar `prayer_sync` T6 bekerja.
- T7: MFA dibuat sendiri (bukan Supabase MFA) karena sesi admin pakai cookie sendiri; review keamanan saat merge.
- Keputusan owner tertunda: email yang sudah menghapus akun lalu daftar ulang = tanpa akses (default T3c).
