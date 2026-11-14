# Catatan deploy (T9)

Ringkas dan hanya yang berubah di T9. Spesifikasi lain ada di `docs/PRD-v1.2.md` dan `.env.example`.

## Env wajib di production
| Env | Aturan |
|---|---|
| `SESSION_PEPPER` | 32+ karakter acak. Untuk cookie sesi, token reset, kunci rate limit |
| `PHONE_HASH_KEY` | 32+ karakter acak, beda dari pepper. Untuk hash HP order |
| `MFA_ENC_KEY` | 32+ karakter acak, beda dari pepper. Untuk secret autentikator admin |
| `TRUSTED_PROXY_HOPS` | Minimal 1. App menolak start di production dengan 0 atau tanpa nilai |
| `APP_BASE_URL` | Alamat publik (https://domain-kamu). Kosong = tautan reset admin ditolak |
| `ALLOW_INSECURE_COOKIES` | Jangan diisi. `true` hanya untuk LAN atau tes http |

Proxy (Caddy, nginx) wajib menimpa `X-Forwarded-For`, bukan meneruskan isi dari klien. Kalau header itu tidak sampai, alamat IP jadi `unknown`: batas per IP dilewati dan log memberi peringatan, batas per email dan HP tetap jalan.

## Rotasi kunci
Setiap rotasi: buat kunci baru, naikkan nomor versinya, ikuti langkah di bawah. Lakukan di jam sepi.

### `SESSION_PEPPER` (sesi, token reset, kunci rate limit)
Dampak: semua orang keluar dan semua token reset yang belum dipakai mati. Hash HP tidak terpengaruh lagi.
1. Ganti `SESSION_PEPPER`, restart app dan worker.
2. Pengguna login ulang. Admin membuat tautan reset baru kalau perlu.

### `PHONE_HASH_KEY` (hash HP order)
Dampak: `purchase_orders.customer_phone_hash` lama tidak cocok lagi. Aktivasi dan reset mandiri gagal sampai hash dibuat ulang. Nomor asli tidak disimpan, jadi hash tidak bisa dihitung ulang dari database. Sumbernya Scalev.
1. Ganti `PHONE_HASH_KEY`, naikkan `PHONE_HASH_KEY_VERSION`, restart app dan worker.
2. Untuk setiap order di tabel `purchase_orders`, minta worker membaca ulang ke Scalev (admin: "Cek ulang ke Scalev" di halaman order, atau enqueue event `payment.received` untuk order itu). Worker mengisi hash dengan kunci baru.
3. Order yang sudah punya entitlement: hash dan bukti tetap seperti saat pertama diverifikasi, karena aturan "akses yang ada tidak diubah". Untuk order itu hash baru hanya masuk lewat migration atau UPDATE manual yang ditinjau owner. Cek dulu: `select count(*) from purchase_orders where phone_key_version < <versi baru>`.
4. Selama langkah 2 belum selesai, pembeli yang belum aktivasi diarahkan ke CS.

Catatan jujur: langkah 3 belum punya alat otomatis. Rotasi `PHONE_HASH_KEY` sebaiknya hanya karena kunci bocor, dan sebelum itu owner memutuskan jalurnya. Kolom `phone_key_version` sudah ada (default 1) supaya order yang tertinggal bisa dicari. Worker belum menulis versi baru, jadi isi kolom itu manual saat rotasi.

### `MFA_ENC_KEY` (secret autentikator admin)
Dampak: secret TOTP lama tidak bisa dibuka, semua admin tidak bisa lolos MFA.
1. Ganti `MFA_ENC_KEY`, naikkan `MFA_ENC_KEY_VERSION`, restart.
2. Super_admin mereset autentikator tiap admin lain (tombol "Reset autentikator" di halaman peran admin, `POST /admin/roles/reset-mfa`). Reset membuka jendela daftar ulang 24 jam. Super_admin tidak bisa mereset dirinya sendiri.
3. Super_admin terakhir yang tidak punya rekan: belum ada alat. Jalurnya SQL yang ditinjau owner (hapus baris `admin_mfa_factors` akun itu, set `user_roles.granted_at = now()`). Rencanakan dua super_admin sebelum rotasi.

## Batas login dan aktivasi (PROVISIONAL, `src/domain/config/provisional.ts`)
- 5 percobaan gagal per email (dan per HP untuk aktivasi) gratis. Setelah itu jeda 1, 2, 5, lalu 15 menit. Tanpa kunci keras. Diam 1 jam = hitungan mulai dari nol.
- Batas per IP hanya menghitung percobaan yang gagal.
- Aktivasi yang email dan HP-nya cocok satu order tidak dihitung sebagai gagal.

## Enrol MFA admin
Enrol pertama hanya dalam 24 jam setelah peran diberikan (PROVISIONAL). Lewat itu, super_admin mereset MFA akun itu, dan jendela terbuka lagi.

## Data wilayah
`supabase/migrations/20261118020000_regions_equran.sql` mengisi 517 kab/kota EQuran (idempoten). Dihasilkan oleh `pnpm db:regions` dari `content/regions/*.json`. `pnpm db:regions --check` gagal bila migration tertinggal dari JSON. Wilayah DEMO dari `supabase/seed.sql` tetap ada.
