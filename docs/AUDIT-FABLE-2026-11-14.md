<!-- Laporan audit Fable (sesi session_01HkFB32zvXuoJJMfmpNQG3r, 14 Nov 2026), disalin apa adanya oleh orchestrator. -->

# Audit akhir Munaja

Tidak ada temuan Kritis. Ada 11 temuan: 5 Sedang dan 6 Rendah, terbanyak di rate limit auth dan penautan entitlement. Audit read-only, tanpa perubahan kode, dan tidak ada test yang dijalankan. Semua temuan dari pembacaan kode; satu-satunya yang saya buktikan dengan perintah adalah checksum Qur'an.

Catatan: working tree ada di branch `claude/dreamy-mendel-a1cvcl` (HEAD `90a98e6`). Saya tidak membandingkannya dengan `main`.

## Temuan

| # | Tingkat | file:baris | Masalah | Skenario gagal konkret | Usulan perbaikan | Keyakinan |
|---|---|---|---|---|---|---|
| 1 | Sedang | `src/server/auth/service.ts:83-98`, `:203-213`, `:253-258` | Batas gagal per email/HP tidak atomik: anggaran dicek dulu, gagal dicatat setelah scrypt selesai. | Penyerang mengirim 30 login paralel untuk satu email. Semua lolos cek karena hitungan masih 0, jadi batas 10 gagal/15 menit tidak berlaku. Yang menahan hanya batas IP (30/10 menit), dan itu bisa dikalikan dengan banyak IP. | Pesan slot dulu dengan `rate_hit` atomik sebelum hash, lalu kembalikan slot bila login benar. Atau pakai advisory lock per email. | Tinggi |
| 2 | Sedang | `src/server/auth/service.ts:203`, `:253` | Penghitung gagal per email ikut memblokir pemilik sah. | Orang yang tahu email pembeli mengirim 5 aktivasi salah tiap 15 menit dari satu IP (pas di batas 20/jam). Pembeli asli terus kena 429 dan tidak bisa aktivasi. Login sama: 10 gagal/15 menit mengunci pemilik akun. | Jangan kunci keras per email. Pakai jeda bertingkat, atau kecualikan percobaan yang email + HP-nya benar dari anggaran gagal. | Tinggi |
| 3 | Sedang | `src/server/auth/service.ts:56-60`, `:200`, `:249`; `src/server/auth/config.ts:44-52` | IP jatuh ke `"unknown"` bila proxy tidak mengirim `X-Forwarded-For` atau `TRUSTED_PROXY_HOPS=0`, sehingga semua orang berbagi satu ember IP. | Hari launch dengan nginx tanpa header forward: seluruh pembeli berbagi 20 aktivasi/jam dan 30 login/10 menit, lalu massal kena 429. Kebalikannya, hops terlalu besar membuat IP bisa dipalsukan klien. | Lewati batas IP (andalkan batas email/HP) bila IP `unknown` dan catat peringatan keras. Tolak start di production bila hops = 0. | Tinggi |
| 4 | Sedang | `supabase/migrations/20261117030000_scalev_provision.sql:92`; `20261117140000_admin_staff.sql:100` | Entitlement dari order baru selalu `user_id NULL`, dan aktivasi menolak email yang sudah punya akun. Tidak ada jalur yang menautkannya ke akun lama. | (a) Akun yang aksesnya dicabut lalu beli lagi: order lunas, akses tetap mati. (b) Orang checkout memakai email korban + HP sendiri dan mengaktivasi. Saat korban beli, aktivasinya selalu `ACTIVATION_FAILED` dan entitlement-nya yatim. | Di `scalev_apply_order`, bila sudah ada profil dengan email itu dan HP order cocok dengan order milik akun tersebut, isi `user_id` langsung. Kalau tidak cocok, tandai untuk CS. | Tinggi |
| 5 | Sedang | `src/server/auth/crypto.ts:5-19`; `src/server/admin/rules/totp.ts` (`keyFor`) | `SESSION_PEPPER` jadi kunci untuk hash HP order, sesi, token reset, dan enkripsi secret TOTP admin, tanpa versi kunci. | Pepper bocor lalu dirotasi: semua `customer_phone_hash` berhenti cocok. Tidak ada pembeli yang bisa aktivasi atau reset mandiri, MFA admin tidak bisa dibuka, dan nomor asli tidak tersimpan untuk di-hash ulang. | Pisahkan kunci (`PHONE_HASH_KEY`, `MFA_KEY`) dan simpan versi kunci di baris. Tulis prosedur rotasi: GET ulang order ke Scalev. | Tinggi |
| 6 | Rendah | `supabase/migrations/20261116030000_auth_password.sql:153-176`; `20261117100000_admin_core.sql:134` | Reset mandiri (email + HP) tidak mengecualikan akun yang punya peran admin. Enrol TOTP pertama hanya butuh sesi login. | Akun pembeli diberi peran admin dan belum enrol MFA. Orang yang tahu email + HP-nya mereset password, login, enrol TOTP sendiri, lalu masuk `/admin`. | Tolak `reset_password_self` untuk user di `user_roles`. Batasi enrol MFA pertama dengan batas waktu sejak peran diberikan. | Sedang |
| 7 | Rendah | `src/server/auth/service.ts:61-62`; `src/server/auth/cookie.ts:24-36` | Flag `Secure` pada cookie sesi dan admin ditentukan dari `X-Forwarded-Proto`, tidak dipaksa di production. | Proxy lupa mengirim header itu: cookie `tt_session` terbit tanpa `Secure` dan bisa terkirim lewat HTTP polos. | Di production selalu pasang `Secure`, kecuali ada env eksplisit untuk LAN. | Sedang |
| 8 | Rendah | `src/domain/auth/phone.ts:22-30` | Nomor berbentuk `620812…` (kode negara + nol) diterima apa adanya, tidak disamakan dengan `62812…`. | Form checkout sudah menampilkan +62 dan pembeli tetap mengetik 0812…. Hash order jadi `620812…`, sedangkan di aktivasi pembeli mengetik 0812… yang jadi `62812…`. Aktivasi gagal dan harus lewat CS. | Ubah `620` + digit `8` menjadi `628`. Tambahkan ke daftar cek format HP Scalev (Q14). | Sedang |
| 9 | Rendah | `src/server/scalev/sweep.ts:71` | Jendela polling disaring dari `createdAt`, bukan dari waktu bayar. | Order dibuat lalu baru dibayar setelah lewat jendela 72 jam atau 14 hari, dan webhook-nya hilang. Sweep berhenti sebelum sampai ke order itu, sehingga akses tidak pernah dibuat. | Saring dan urutkan dengan waktu bayar bila tersedia. Kalau tidak, andalkan tombol "cek ulang ke Scalev". | Sedang |
| 10 | Rendah | `src/server/admin/routes.ts:62` | Basis tautan reset jatuh ke origin request bila `APP_BASE_URL` kosong. | Di belakang proxy, origin bisa terbaca `http://localhost:3000` atau host lain. CS mengirim tautan mati atau ke host yang salah, padahal token ada di fragmennya. | Wajibkan `APP_BASE_URL` di production. Gagal jelas bila kosong. | Sedang |
| 11 | Rendah | `scripts/import-quran.ts:324-331` | Checksum Tanzil dibandingkan dengan `SOURCE.md` yang ditulis skrip yang sama. Bila baris checksum hilang, pemeriksaan dilewati diam-diam. | Seseorang mengubah `quran-uthmani.txt` dan `SOURCE.md` dalam satu commit, atau menghapus baris SHA. Import lolos tanpa error. | Pin SHA-256 sebagai konstanta di kode atau test. Gagal bila `prevSha` kosong tanpa `--refresh`. | Tinggi |

Catatan untuk #11: hari ini datanya bersih. SHA `quran-uthmani.txt` (`6933e133…ec5f`) dan `quran-data.js` (`9e9930c5…4ca4`) cocok dengan `SOURCE.md`. 114 berkas di `public/quran` memuat 6.236 ayat dengan SHA sumber yang sama.

## Yang diperiksa dan tidak bermasalah

- **Webhook Scalev:** HMAC dicek atas byte mentah dengan perbandingan constant-time. Idempotensi lewat unique `(provider, external_event_id)`. Entitlement hanya dibuat dari hasil GET order, dengan pembatas kedua di SQL.
- **Password dan token:** scrypt dalam format PHC, token reset admin sekali pakai lewat satu `UPDATE`, batas 3 perangkat memakai advisory lock.
- **Privasi admin:** fungsi admin yang saya baca tidak menyentuh data excuse, HP hanya berupa hash, dan agregat melewati aturan K=20.
- **Level:** tidak pernah dikunci ulang; `recompute_progression` hanya mengisi kolom yang masih NULL.
- **Khatam:** 29×20N + 24N = 604N, dan hitungan hari memakai timezone target.
- **Teks Arab:** tidak ada aksara Arab di `src/`. Admin tidak punya jalur tulis ke `arabic_text`.
- **Service worker:** melewati `/api/`.

## 3 risiko terbesar sebelum launch

1. **429 massal di hari launch (#3).** Selain salah konfigurasi proxy, batas 20 aktivasi/jam per IP menghitung percobaan sukses juga. Banyak pembeli seluler di balik satu IP operator (CGNAT) bisa saling menghabiskan jatah. [Medium confidence: bergantung pola IP operator, perlu diuji dengan trafik nyata.]
2. **Aktivasi dan login bisa diganggu atau ditebak lebih cepat dari rancangan (#1, #2).** Karena tanpa SMTP, pembeli yang terkunci hanya punya jalur CS.
3. **Order lunas tanpa akses (#4, #8).** Pembelian ulang, email yang sudah dipakai orang lain, dan format HP `620…` semuanya berakhir di `ACTIVATION_FAILED` generik. Beban jatuh ke CS, yang nomornya belum ada.

## Area yang tidak sempat diperiksa

- `src/server/scalev/client.ts` (parsing respons, timeout) dan `seal.ts`.
- `src/server/api/routes.ts` di luar handler auth: validasi body per endpoint, counter operations, excuse.
- Migration `admin_content` (alur empat mata), `admin_support` (transfer email, ubah status entitlement), `admin_aggregates`, dan `jobs_runner`.
- `src/server/admin/routes.ts` selain reset link dan cek HP; `health.ts`, `bootstrap.ts`.
- Fungsi `export_user_data`, dan `user_active_key` beserta seluruh hitungan tanggal sesi di SQL. `tz.ts` hanya saya baca sekilas.
- `src/domain/**` selain `time`, `khatam/plan`, `auth/phone`, `auth/email`. Belum: `khatam/progress`, `progression`, `dhikr`, `content/niat`.
- `src/components/quran/**`, notifikasi dan push, isi `supabase/seed.sql` terhadap `content/amalan.v1.json`.
- Tidak ada test yang dijalankan.
