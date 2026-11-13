# X2-B: admin T7 selesai + X8 (staf, tautan reset, blokir aktivasi, UI /admin)

Tanggal 13 Nov 2026. Branch `claude/x2b-admin` dari main @ `fec57ae` (X2-A sudah merge). Brief: `docs/briefs/X-part2-B.md`. WIP T7 diambil dari `origin/claude/t7-admin` (file milik T7 saja, di-checkout ke branch ini, bukan merge). Tidak ada PR, tidak ada push ke main. Sesi U2 tidak disentuh (`src/components/**` di luar `admin/`, migration `20261117200000`).

## Hasil
| Bagian | Status |
|--------|--------|
| Migration T7 dinamai ulang: `20261117100000_admin_core`, `110000_admin_content`, `120000_admin_support`, `130000_admin_aggregates` | Selesai. Jalan dari nol dan dua kali (tes schema) |
| `tests/db/schema.test.ts`: tabel `admin_mfa_factors`, `admin_sessions` | Selesai |
| Sesuai skema auth baru: email lewat OTP dihapus, `admin_resend_access_email` + `admin_queue_email` dihapus, transfer email tanpa antrean email, komentar OTP dibersihkan | Selesai (X8-9) |
| Sisa T7: test review, PRIV-01, audit immutable, k-anon, vektor TOTP RFC 6238 + RFC 4226, support tools | Selesai (daftar test di bawah) |
| `scripts/admin-grant-role.ts` + `src/server/admin/bootstrap.ts` + SQL `admin_bootstrap_grant` | Selesai (X8-10) |
| X8 migration `20261117140000_admin_staff.sql` | Selesai (isi di bawah) |
| UI `/admin/**` (mobile-first + desktop, Bahasa Indonesia) | Selesai: login admin, MFA (pasang + kode), ringkasan, cari pembeli, akun, pembelian + detail order, akses, staf, review konten, amalan, dzikir, detail versi + diff, notifikasi (template), level, konten Qur'an, jadwal salat, job, audit log, peran |
| E2E `tests/e2e/admin-flow.live.ts` + `playwright.admin.config.ts` + `pnpm test:e2e:admin` | Selesai, 20 lulus (mobile 360 dan desktop 1280) |

### Isi migration X8
- `is_staff_user`, `has_all_levels`; `level_for_session`, `level_progress_json`, `get_current_level` dibuat ulang: staf aktif melihat semua level terbuka (sesi pakai level 3), tanpa baris `user_level_state` palsu (X8-5).
- `activate_account` dibuat ulang: order `admin_manual` boleh diaktivasi (X8-3). Test X4 `tests/db/auth-password.test.ts` diubah satu kasus (`d2-manual` keluar dari daftar "harus gagal"). Itu file milik X4, perubahan minimal, perlu konfirmasi orchestrator.
- `admin_staff_create` (security definer, tanpa password), `admin_staff_revoke`, `admin_staff_list`.
- `admin_reset_precheck`, `admin_order_detail`, `admin_order_approve`, `admin_order_set_activation_blocked`, `admin_order_phone_check`, `admin_user_detail` (+ staf, punya password, riwayat tautan), `admin_aggregates` (tanpa staf), `admin_bootstrap_grant`.
- Semua aksi menulis `admin_audit_logs` di transaksi yang sama.

### Aturan keras, di mana dijaga
| Aturan | Di mana |
|--------|---------|
| Data excused tidak pernah tampil | `tests/db/admin-privacy.test.ts` (scan isi semua fungsi `admin_*`: tidak ada "excus"/"berhalangan"; hanya `admin_aggregates` menyentuh tabel ibadah, dan hanya menghitung status `completed`), `admin-staff.test.ts` (scan respons HTTP) |
| Tanpa leaderboard | Tidak ada endpoint atau layar per pengguna untuk ibadah; agregat hanya hitungan, grup < 20 digabung (`admin-rules.test.ts`) |
| Teks Arab tidak bisa diedit | Whitelist kolom di SQL (`not_editable`), `admin-review.test.ts` (7 kolom ditolak, teks Arab dalam kolom yang boleh juga ditolak, Arab di DB tidak berubah) |
| Tanpa password bawaan | `admin_staff_create` dan bootstrap tidak membuat kredensial; Zod strict menolak field `password` (test); script tidak berisi hash password (test) |
| Server sumber kebenaran | Peran dicek dua kali (tabel TS + `admin_require` di SQL); entitlement hanya berubah lewat fungsi SQL beraudit |
| HP tersembunyi | Tidak ada fungsi atau respons admin yang memuat HP atau hash-nya (test DB dan HTTP). Lihat X8-1 |

## Test baru
| File | Isi |
|------|-----|
| `tests/db/admin-staff.test.ts` (21) | Staf (buat, tanpa kredensial, audit, konflik, revoke, bypass level, di luar agregat), approve manual + aktivasi sesudahnya, blokir/buka, cek HP (peran, rate limit, audit tanpa nomor), pre-check reset |
| `tests/db/admin-privacy.test.ts` (7) | Audit append-only (UPDATE/DELETE/TRUNCATE ditolak, privilege dicabut), PRIV-01 |
| `tests/unit/server/admin-rules.test.ts` (20) | RFC 6238 (6 vektor) + RFC 4226 (10 vektor), drift, replay, base32, aturan 20 pengguna, tabel permission, aturan teks |
| `tests/unit/server/admin-review.test.ts` (7) | Empat mata, tarik kembali, draf basi, aturan teks template, whitelist Arab, publish aktivitas |
| `tests/unit/server/admin-staff.test.ts` (11) | Alur HTTP penuh staf (tautan sekali, set password sendiri, level 3, revoke), tautan reset pembeli (alasan, kedaluwarsa 60 menit, tautan baru mencabut lama, perangkat lama keluar, tanpa token di DB/audit), order (approve, blokir, cek HP, tanpa HP di respons), PRIV-01 lewat HTTP |
| `tests/unit/server/admin-bootstrap.test.ts` (4) | Super_admin pertama, tautan hanya ke TTY, tanpa password |
| `tests/unit/server/admin-security.test.ts` (17, dari T7) | SECURITY-05, RBAC, replay MFA, rate limit, 8 jam, cabut peran |
| `tests/e2e/admin-flow.live.ts` (10 x 2 viewport) | Login + pasang autentikator lewat layar, ringkasan, tanpa scroll samping, axe wcag2a/aa/21aa bersih di layar utama, tautan staf tampil sekali dan dipakai staf, cabut, audit, CS: cari, detail order, cek HP, approve, blokir/buka, aktivasi pembeli, content admin: template + penolakan Arab |

## Gerbang (output asli, checkout ini)
```
pnpm typecheck                exit 0, tanpa error
pnpm lint                     exit 0, tanpa warning
pnpm test                     Test Files 70 passed (70) · Tests 1418 passed | 3 skipped (1421)
pnpm test:db                  Test Files 13 passed (13) · Tests 327 passed (327)
pnpm test:e2e --trace off     288 passed, 46 skipped, 0 failed (5.0m, mode mock)
pnpm test:e2e:admin --trace off   20 passed (1.4m)
pnpm audit --prod             No known vulnerabilities found
```
Catatan: `pnpm test` sudah memuat test DB. Run pertama gagal 2 test (guard "tanpa aksara Arab di src/" kena regex literal di `rules/text.ts`, dan test X4 di atas); keduanya diperbaiki, lalu semua gerbang diulang (angka di atas dari run kedua, kecuali e2e mock yang dijalankan sebelum dua perbaikan kecil itu dan tidak menyentuh `/admin`). Live e2e lama (`test:e2e:live`) tidak dijalankan.

## Keputusan
`docs/DECISIONS.md` bagian "X2-B" (X8-1 sampai X8-12). Satu ketidaksepakatan dengan brief: brief meminta HP "tampil hanya dua peran + audit", tetapi yang tersimpan cuma hash (X4-5), jadi admin hanya bisa mengecek nomor, bukan melihatnya.

## Belum / batas
- Tidak ada Postgres nyata: semua diuji di PGlite. `admin_*` memakai `FOR UPDATE` dan advisory lock yang perilaku paralelnya belum terbukti di Postgres 16/17.
- Edit konfigurasi level (target malam, urutan) dari admin: backend ada (`configs` di patch aktivitas), UI hanya menampilkan. Draf teks, deskripsi, referensi, satuan hitung sudah bisa.
- Jalur CS membuat akun untuk order tanpa HP (Q-X2B-2) belum ada.
- Tidak ada QR autentikator (kunci manual atau tautan `otpauth://`).
- Aksesibilitas: axe dijalankan di layar utama (ringkasan, audit, detail order). Layar lain belum diaudit satu per satu. Kontras memakai token yang sudah teruji.
- Layar admin belum diuji di perangkat nyata. Cookie admin dan sesi 8 jam di PWA iOS belum dicoba.
- Push ke GitHub sempat gagal 503 beberapa kali; semua commit akhirnya ter-push.

## Pertanyaan untuk owner (semua sudah diberi default PROVISIONAL)
1. Q-X2B-1: CS perlu MELIHAT nomor HP pembeli, bukan hanya mengecek? Kalau ya, nomor asli harus disimpan terenkripsi (keputusan privasi, perlu retensi).
2. Q-X2B-2: Order karantina `missing_phone` yang disetujui: pembeli tidak bisa aktivasi sendiri. Boleh CS membuatkan akun + tautan atur password atas nama pembeli (melonggarkan bukti email + HP, dengan audit)?
3. Q-X2B-3: Staf memakai level 3 (semua level terbuka). Perlu bisa memilih level untuk menguji level 1 dan 2?
4. Q-X2B-4: Hanya super_admin boleh membuat staf, dan CS boleh membuat tautan reset (kecuali untuk akun admin). Setuju?
5. Q-X2B-5: Order yang disetujui manual kini bisa diaktivasi pembeli (email + HP cocok). Setuju, mengingat X4 awalnya menolak `admin_manual`?
