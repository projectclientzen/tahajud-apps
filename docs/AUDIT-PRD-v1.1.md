# Audit PRD v1.1: Bug, Security, dan Risiko Pemakaian

Tanggal: 12 November 2026
Objek: `docs/PRD-v1.1.md`
Hasil: 60 temuan (16 security, 4 privasi, 20 bug logika, 13 operasional, 7 konten/dokumen). Semua perbaikan sudah dimasukkan ke `docs/PRD-v1.2.md` (kolom "Fix di v1.2").

Severity:
- P0 = bisa membuat akses berbayar bocor, data user bocor, atau user tidak bisa login/memakai fitur inti. Wajib beres sebelum launch.
- P1 = bug logika yang hampir pasti muncul di pemakaian nyata, atau celah keamanan dengan dampak terbatas.
- P2 = risiko UX/operasional, inkonsistensi dokumen.

Label confidence dipakai untuk klaim faktual eksternal (perilaku browser, layanan pihak ketiga, regulasi).

---

## Ringkasan 10 temuan teratas

| # | ID | Masalah | Kenapa berbahaya |
|---|----|---------|------------------|
| 1 | SEC-01 | Login magic link tidak masuk ke PWA yang sudah di-install di iPhone | Link email terbuka di Safari, sedangkan PWA Home Screen punya storage terpisah. User login di Safari, PWA tetap minta login. Ditambah link sekali-pakai bisa "terpakai" oleh pemindai link email. [High confidence: storage terpisah PWA standalone iOS sudah lama didokumentasikan komunitas web dev; perilaku scanner link di Outlook/Defender juga umum] |
| 2 | SEC-02 | Webhook dipercaya sebagai sumber status bayar tunggal | Kalau signing secret bocor, siapa pun bisa membuat akses. v1.2: akses aktif hanya setelah order dicek ulang ke API Scalev |
| 3 | BUG-01 | Status `missed` butuh baris sesi, padahal user yang tidak buka app tidak pernah membuat baris | Kalender kosong, completion rate terlalu tinggi, insight salah |
| 4 | BUG-02 | Koreksi 48 jam bisa menurunkan jumlah sukses setelah level berikutnya terbuka | Level bisa "turun" atau progress level berikutnya rusak |
| 5 | SEC-03 | Arsitektur akses data ganda (client langsung ke Supabase via RLS DAN lewat API) | Dua jalur = dua tempat untuk lupa validasi. User bisa set `status = completed` langsung ke tabel |
| 6 | PRIV-01 | Pola sesi "excused" bulanan dari user perempuan bisa menyiratkan siklus haid | Data kesehatan tersirat. Admin reporting tidak boleh bisa melihat pola per user |
| 7 | BUG-03 | Counter dzikir mengirim 1 request per tap | Ratusan sampai ribuan request per malam per user, boros kuota, rawan rate limit dan race |
| 8 | OPS-01 | Pembeli salah ketik email di checkout Scalev | User bayar tapi tidak pernah bisa login. Tidak ada alur support di PRD |
| 9 | BUG-04 | Jadwal Subuh hanya untuk wilayah Indonesia, tanpa fallback manual | User yang sedang umroh/luar negeri atau saat provider down tidak bisa memakai fitur inti |
| 10 | DOC-01 | "Rangkaian Ya Fattah... — 100": 100 putaran rangkaian atau 100 per asma? | Target counter salah 4x lipat |

---

## A. Security

| ID | Sev | Temuan | Fix di v1.2 |
|----|-----|--------|-------------|
| SEC-01 | P0 | Magic link gagal di PWA iOS (storage terpisah) dan rawan terpakai oleh link scanner email | OTP 6 digit yang diketik di dalam app jadi metode utama. Magic link opsional, hanya untuk browser biasa, dengan halaman konfirmasi "Klik untuk masuk" (bukan auto-login saat GET) (§11.1) |
| SEC-02 | P0 | Akses diberikan dari payload webhook saja | Webhook = trigger. Sebelum entitlement `active`, worker wajib fetch order dari API Scalev dan mencocokkan status, product/variant, email, nominal. Jika API Scalev belum tersedia: entitlement `pending_verification` + approve manual admin (§20.3) |
| SEC-03 | P0 | Jalur data ganda (client direct DB + API) | Browser memakai Supabase hanya untuk Auth. Semua baca/tulis data lewat `/api/v1` dengan Supabase client ber-JWT user (RLS tetap aktif sebagai lapis kedua). Service role hanya di webhook, worker, admin server action. Tabel privat: `REVOKE INSERT/UPDATE/DELETE` dari role `authenticated`; mutasi via RPC/API (§16.4, §18) |
| SEC-04 | P0 | OTP tanpa batas percobaan yang jelas | Rate limit: 5 permintaan OTP/email/jam, 10/IP/jam; 5 percobaan verifikasi per kode, lalu kode hangus; expiry 10 menit. Respons request OTP selalu generik (§24.1) |
| SEC-05 | P0 | Service worker berpotensi meng-cache respons API privat | Respons `/api/v1/**` diberi `Cache-Control: private, no-store`; service worker tidak boleh cache `/api/`. Data offline hanya di IndexedDB ber-namespace `user_id`, dihapus saat logout (§21.4) |
| SEC-06 | P1 | Signing secret tidak bisa dirotasi tanpa downtime | Dukung 2 secret aktif (`SCALEV_WEBHOOK_SECRET`, `SCALEV_WEBHOOK_SECRET_PREVIOUS`); bandingkan HMAC dengan constant-time compare; batasi body 256 KB (§19.8) |
| SEC-07 | P1 | Payload webhook mentah (JSONB) berisi PII pembeli: nama, telepon, alamat, disimpan tanpa batas waktu | Simpan field minimum terstruktur + hash payload. Payload mentah dienkripsi atau dihapus otomatis setelah 90 hari (PROV) (§17.1, §24.4) |
| SEC-08 | P1 | Admin tanpa MFA | Semua role admin wajib TOTP MFA (Supabase Auth MFA). Session admin lebih pendek (8 jam) (§23) |
| SEC-09 | P1 | `support_admin` berpotensi melihat detail ibadah user | Support hanya melihat akun, email, status entitlement, order. Detail sesi ibadah per user tidak terlihat oleh role admin mana pun kecuali `super_admin` dengan alasan tercatat di audit log (§18.2) |
| SEC-10 | P1 | XSS lewat konten admin (template notifikasi, deskripsi amalan) | Render plain text; variabel template hanya whitelist (`{nama}`, `{level}`); tidak ada HTML mentah (§23.4) |
| SEC-11 | P1 | CSRF pada route handler berbasis cookie | Cookie `SameSite=Lax; Secure; HttpOnly` + validasi header `Origin` pada semua mutasi (§24.1) |
| SEC-12 | P1 | Open redirect lewat parameter `next` setelah login | `next` hanya boleh path relatif internal dari allowlist (§24.1) |
| SEC-13 | P1 | `counter_operations.client_operation_id` UNIQUE global | Ubah ke UNIQUE `(user_id, client_operation_id)` agar ID milik user lain tidak bisa memblokir operasi (§17.3) |
| SEC-14 | P1 | Hapus push subscription tanpa cek kepemilikan eksplisit | Endpoint DELETE wajib match `user_id`; test SECURITY-04 (§27) |
| SEC-15 | P2 | Berbagi akun (1 pembelian dipakai banyak orang lewat forward OTP) | Batas perangkat aktif default 3 (PROV), daftar perangkat di Profil, user bisa logout perangkat lain (§11.3) |
| SEC-16 | P2 | Tidak ada secret scanning dan dependency audit | CI: secret scan + `pnpm audit` + lint rule larangan `NEXT_PUBLIC_*SECRET*` / `SERVICE_ROLE` (§24.3) |

## B. Privasi & legal

| ID | Sev | Temuan | Fix di v1.2 |
|----|-----|--------|-------------|
| PRIV-01 | P0 | Pola excused bisa menyiratkan data kesehatan (haid) | Excused tanpa alasan, tanpa kategori. Admin hanya melihat agregat dengan ambang minimal 20 user per grup. Tidak ada export per user oleh admin (§10.6, §22) |
| PRIV-02 | P1 | Hapus akun vs kewajiban simpan data transaksi bertentangan | Hapus akun = hapus data ibadah, profil, push, progress Qur'an. Order & entitlement dianonimkan (email diganti hash) dan disimpan sesuai retensi bisnis (§24.4) |
| PRIV-03 | P1 | Kewajiban regulasi Indonesia belum masuk checklist | Launch checklist: kebijakan privasi sesuai UU PDP (UU 27/2022), syarat & ketentuan, kebijakan refund, cek kewajiban pendaftaran PSE Lingkup Privat. [Medium confidence: perlu verifikasi ke konsultan hukum, aturan PSE pernah berubah] (§30.3) |
| PRIV-04 | P2 | Analytics pihak ketiga tidak diatur | Tidak ada tracker iklan (Meta Pixel dll.) di dalam app setelah login. Pixel hanya di landing/checkout Scalev. Analytics produk: self-hosted atau tanpa PII (§24.4) |

## C. Bug logika & data

| ID | Sev | Temuan | Fix di v1.2 |
|----|-----|--------|-------------|
| BUG-01 | P0 | Missed butuh baris sesi | Missed diturunkan (derived): untuk setiap tanggal sejak `program_start_date` sampai hari ini tanpa sesi berstatus final, status = missed. Baris sesi dibuat lazy saat interaksi pertama. Finalisasi status terjadi saat dibaca setelah cutoff (lazy) + job harian sebagai pengaman (§11.3) |
| BUG-02 | P0 | Koreksi menurunkan sukses setelah unlock | Level bersifat monoton: sekali terbuka tidak pernah terkunci lagi. Progress level N = jumlah sesi completed dengan snapshot level N. Koreksi hanya mengubah angka level sesi itu (§10.7) |
| BUG-03 | P1 | 1 request per tap | Tap di-coalesce: buffer lokal, flush tiap 2 detik / saat mencapai target / saat `visibilitychange` hidden. Setiap flush = 1 operasi delta dengan operation_id unik (§12.3) |
| BUG-04 | P1 | Tidak ada fallback jadwal Subuh | Mode "Jadwal manual": user isi jam Subuh sendiri, label jelas "Diatur manual". Juga dipakai untuk user di luar Indonesia (§14.5) |
| BUG-05 | P1 | Aturan penentuan sesi aktif tidak eksplisit | Formula: `activeSessionKey(now) = localDate(now)` jika `now < cutoff(localDate(now))`, selain itu `localDate(now) + 1 hari`. Cutoff = 12.00 lokal (PROV) (§11.1) |
| BUG-06 | P1 | "Request completion" ambigu: sesi selesai karena tombol atau karena data? | Status dihitung otomatis dari aktivitas. Tombol "Selesaikan sesi" hanya menampilkan ringkasan dan tidak memengaruhi status (§10.3) |
| BUG-07 | P1 | Partial vs missed tidak terdefinisi saat sesi dibuka tapi tidak ada progres | Partial = minimal 1 aktivitas punya progres > 0 tapi requirement belum lengkap. Sesi tanpa progres = missed (§10.5) |
| BUG-08 | P1 | User pindah zona waktu di tengah sesi | Timezone & region sesi dibekukan saat sesi dibuat. Perubahan wilayah berlaku untuk sesi berikutnya (§11.5) |
| BUG-09 | P1 | Jam perangkat salah | Semua penentuan status & session key memakai waktu server. `client_recorded_at` hanya informasi, di-clamp jika lebih dari 5 menit di masa depan (§12.3) |
| BUG-10 | P1 | Reset counter dengan 2 perangkat bersamaan | Reset = operasi `set_zero` yang dicatat sebagai correction event. Server clamp hasil di 0. Delta yang datang setelah reset tetap diterapkan (§12.4) |
| BUG-11 | P1 | Logout saat masih ada operasi offline belum tersinkron | Logout dicegah dengan dialog "Ada X catatan belum tersinkron". Opsi: sinkron dulu, atau buang dengan konfirmasi eksplisit (§21.4) |
| BUG-12 | P1 | Penyimpanan browser bisa dihapus OS/browser | Panggil `navigator.storage.persist()`. Server tetap sumber final; app sinkron sesering mungkin (§21.1) |
| BUG-13 | P1 | Completion rate menghitung hari sebelum user mulai | Periode laporan dimulai dari `program_start_date` (tanggal onboarding selesai) (§22.2) |
| BUG-14 | P1 | Duplikasi timezone di `profiles` dan `notification_preferences` | Timezone diturunkan dari region. Kolom di notification_preferences dihapus (§17.5) |
| BUG-15 | P1 | Notifikasi terlambat tetap terkirim | Job kadaluwarsa jika lewat batas: bedtime 30 menit, tahajud 15 menit, fajr 20 menit (PROV) (§15.4) |
| BUG-16 | P1 | Event webhook bisa tidak punya ID unik dari Scalev | Fallback dedupe key = SHA-256 raw body. Perlu verifikasi format event Scalev (§20.2) |
| BUG-17 | P2 | Counter melewati target tanpa sadar | Saat target tercapai: getar + layar konfirmasi. Tap lanjutan tetap dihitung, ditampilkan sebagai "+N lebih" (§12.2) |
| BUG-18 | P2 | Layar mati saat counter dipakai | Screen Wake Lock API jika didukung, toggle di layar counter (§12.1) |
| BUG-19 | P2 | Tap tidak sengaja/zoom | `touch-action: manipulation`, `user-select: none`, area tap minimal 160×160 px di mobile (§12.1) |
| BUG-20 | P2 | Wake plan bisa menyisakan tidur sangat pendek | Jika `wake - bedtime < 5 jam` (PROV), tampilkan saran netral untuk tidur lebih awal atau memakai estimasi durasi lebih pendek (§14.6) |

## D. Operasional & pemakaian

| ID | Sev | Temuan | Fix di v1.2 |
|----|-----|--------|-------------|
| OPS-01 | P0 | Salah ketik email saat checkout | Halaman login: "Tidak menerima kode?" berisi cek folder spam, cek email yang dipakai di Scalev, tombol WhatsApp CS. Admin support bisa memindahkan entitlement ke email baru setelah verifikasi manual, tercatat di audit (§6.4, §23) |
| OPS-02 | P0 | Email OTP masuk spam / limit SMTP bawaan | Wajib custom SMTP dengan domain sendiri + SPF, DKIM, DMARC. [Medium confidence: SMTP bawaan Supabase memang dibatasi untuk development, angka limit perlu dicek di dashboard] (§24.1) |
| OPS-03 | P1 | Pembelian untuk orang lain (hadiah untuk orang tua) | Admin "transfer entitlement" ke email lain dengan audit. Self-service gifting di luar MVP (§20.4) |
| OPS-04 | P1 | Queue/job processor tidak ditentukan | Satu mekanisme: tabel `jobs` Postgres (atau Supabase Queues/pgmq) + worker Edge Function yang dipanggil `pg_cron` tiap menit. Dipakai webhook processing, email, notifikasi, reconciliation (§16.2) |
| OPS-05 | P1 | Onboarding 8 langkah sebelum nilai pertama | Jalur minimum: wilayah → konfirmasi Subuh → dashboard. Notifikasi & install PWA bisa dilewati dan muncul lagi sebagai kartu di dashboard (§6.2) |
| OPS-06 | P1 | Layar terang jam 3 pagi | Default theme mengikuti sistem, dengan opsi "Otomatis gelap antara Maghrib dan Subuh" (§7.2) |
| OPS-07 | P1 | Izin notifikasi diminta terlalu awal | Prompt hanya setelah penjelasan + gesture user. Di iOS, prompt hanya muncul jika app sudah terpasang di Home Screen (§15.3) |
| OPS-08 | P1 | Perangkat Android kelas bawah | Budget JS awal ≤ 200 KB gzip per route user, uji di profil throttling "Slow 4G + 4x CPU" (§25) |
| OPS-09 | P1 | Lingkungan dev/staging/prod tidak dipisah | 3 environment, project Supabase terpisah, webhook Scalev staging ke URL staging (§16.5) |
| OPS-10 | P1 | Backup harian | Backup otomatis harian Supabase butuh paket berbayar. [Medium confidence: cek paket terbaru] Masuk anggaran (§25) |
| OPS-11 | P2 | Copy status bernuansa menghakimi ("gagal", "berhasil") | Label: Tuntas, Sebagian, Terlewat, Berhalangan, Akan datang (§8.2) |
| OPS-12 | P2 | Perempuan saat haid: excused tiap malam satu per satu melelahkan | Mode "Berhalangan" untuk rentang beberapa hari dalam satu aksi. Dzikir tetap bisa dicatat tapi tidak memengaruhi progress. Perlu persetujuan pembimbing (PROV) (§10.6) |
| OPS-13 | P2 | Model lifetime vs biaya infrastruktur berjalan | Catat estimasi biaya per user aktif per bulan (email, push, DB) sebelum harga final. Keputusan bisnis owner (§30.3) |

## E. Konten & dokumen

| ID | Sev | Temuan | Fix di v1.2 |
|----|-----|--------|-------------|
| DOC-01 | P1 | Satuan counter rangkaian asma ambigu | Default: 1 hitungan = 1 putaran rangkaian 4 asma. Ditandai PROV, wajib dikonfirmasi pembimbing (§9.2) |
| DOC-02 | P1 | Dzikir setelah Qabliyah "sesuai materi program" tidak punya isi | Ditandai BLOCKED sampai owner memberi teks (§9.5) |
| DOC-03 | P2 | "Istiqomah" vs "Istikamah" tidak konsisten | Usulan: brand pakai "Istiqomah" di semua UI termasuk judul Level 3. Keputusan owner (§30.2) |
| DOC-04 | P2 | Tabel PRD rusak saat konversi | Semua tabel ditulis ulang di v1.2 |
| DOC-05 | P2 | Tabel yang hilang: role admin, jobs, rate limit, email outbox, permintaan hapus data, app settings, perangkat | Ditambahkan di §17 v1.2 |
| DOC-06 | P2 | Kontras warna Sage di atas Cream sekitar 2.6:1 (gagal AA) | Aturan pemakaian token di §7.2 |
| DOC-07 | P2 | Route `/` "public landing" padahal produk dijual lewat landing Scalev | `/` = halaman masuk ringan (info + tombol login + link beli). User login diarahkan ke `/dashboard` (§5.2) |

## Acceptance test baru di v1.2

AUTH-06 (rate limit & anti-enumeration OTP), AUTH-07 (login OTP di PWA iOS), AUTH-08 (verifikasi order ke API Scalev), SESSION-03 (batas cutoff 11.59/12.01), SESSION-04 (pindah zona waktu), SESSION-05 (koreksi tidak mengunci level), SESSION-06 (missed derived), DZIKIR-04 (coalescing tap), DZIKIR-05 (2 perangkat bersamaan), DZIKIR-06 (logout dengan antrean belum sinkron), PRAYER-03 (jadwal manual), NOTIF-04 (notifikasi terlambat dibuang), NOTIF-05 (quiet hours), SECURITY-03 (client tidak bisa update tabel langsung), SECURITY-04 (hapus subscription milik orang lain), SECURITY-05 (non-admin akses /admin), SECURITY-06 (cache dihapus saat logout), PRIV-01 (admin tidak bisa melihat pola excused per user).
