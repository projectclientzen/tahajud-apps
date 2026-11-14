# Brief T9 (Sonnet): perbaiki temuan audit Fable + 2 tugas kecil

Basis: main terbaru. Branch `claude/t9-fix`. Temuan lengkap: `docs/AUDIT-FABLE-2026-11-14.md` (F1..F11). Aturan: `CLAUDE.md`. Mode HEMAT kuota owner: kerjakan langsung, tanpa refactor di luar temuan, tanpa e2e penuh sampai gerbang akhir.

## A. Temuan audit
- F1: batas gagal per email/HP atomik (pesan slot dengan `rate_hit` sebelum scrypt, kembalikan bila sukses, atau advisory lock per email). Test paralel: 30 login serentak untuk satu email tidak melebihi batas.
- F2: jangan kunci keras pemilik sah. Login: jeda bertingkat (mis. 1, 2, 5, 15 menit) bukan blokir 15 menit penuh. Aktivasi/reset: percobaan yang email + HP-nya benar tidak dihitung ke anggaran gagal. Respons tetap generik. Nilai baru = PROVISIONAL di config.
- F3: batas per IP hanya menghitung percobaan GAGAL (aman untuk CGNAT). Bila IP `unknown`: lewati batas IP, log peringatan. Production + `TRUSTED_PROXY_HOPS` < 1 = gagal start dengan pesan jelas.
- F4: `scalev_apply_order` menautkan entitlement ke akun yang sudah ada bila email sama DAN hash HP order cocok dengan order lain milik akun itu; kalau tidak cocok, karantina `needs_cs_review` (tampil di admin). Pembelian ulang setelah dicabut = tertaut otomatis bila syarat itu terpenuhi.
- F5: pisahkan kunci: `PHONE_HASH_KEY`, `MFA_ENC_KEY` (fallback ke `SESSION_PEPPER` hanya di dev/test), kolom versi kunci, dokumen prosedur rotasi di `docs/DEPLOYMENT-NOTES.md` (rotasi HP = GET ulang order ke Scalev).
- F6: `reset_password_self` menolak user yang punya baris di `user_roles`. Enrol MFA pertama hanya dalam 24 jam sejak peran diberikan (PROVISIONAL), setelah itu perlu super_admin.
- F7: cookie `Secure` selalu di production; pengecualian hanya `ALLOW_INSECURE_COOKIES=true` (dev/LAN).
- F8: normalisasi `620` + `8…` menjadi `628…`. Unit test.
- F9: sweep menyaring/urut berdasarkan waktu bayar bila ada, cadangan `createdAt`.
- F10: `APP_BASE_URL` wajib di production; tautan reset gagal jelas bila kosong.
- F11: pin SHA-256 Tanzil (`quran-uthmani.txt` dan `quran-data.js`) sebagai konstanta + test; import gagal bila baris SHA hilang tanpa `--refresh`.

## B. Keputusan owner (13 Nov)
- Ganti "approve manual" di admin dengan "Cek ulang ke Scalev" (enqueue verifikasi worker X6 untuk order itu, audit log). Hapus jalur `verified_via='admin_manual'` untuk aktivasi pembeli (kembalikan aturan X4), sesuaikan test DB dan e2e admin.

## C. Dua tugas kecil
- Data khatam (target + log baca) ikut `/me/data-export` (`src/server/api/account.ts` dan fungsi `export_user_data`).
- Seed/impor 517 wilayah ke tabel `regions` dari `content/regions/crosscheck-coordinates.json` + `equran-regions.json` (skrip `scripts/import-regions.ts` yang ada, atau migration data), idempoten, wilayah demo tetap untuk mode mock.

## Kepemilikan
Boleh menyentuh `src/server/**`, `src/domain/auth/**`, `src/app/api/**`, `src/app/admin/**`, `src/components/admin/**`, `scripts/**`, migration BARU mulai `20261118010000`, test terkait, `.env.example`, `docs/DEPLOYMENT-NOTES.md`, `docs/sessions/T9.md`, baris STATUS + entri SESSION_LOG milikmu. Jangan ubah migration lama (tambah migration baru), jangan sentuh `content/**`.

## Selesai
`pnpm typecheck && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e --trace off && pnpm test:e2e:live --trace off && pnpm test:e2e:admin --trace off && pnpm audit --prod` hijau. Laporan `docs/sessions/T9.md` (per F1..F11 + B + C: diperbaiki/ditolak + alasan) dengan output asli. Push ke `claude/t9-fix`, kirim ringkasan ke orchestrator `session_01HkFB32yhrjHP63xkJdKYto`.
