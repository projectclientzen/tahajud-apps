# SCALEV-AUTH-PLAN: audit Scalev + migrasi auth ke email+password + webhook Scalev

Sesi perencanaan, tanggal brief 13 Nov 2026. Branch `claude/scalev-email-pass` dari `main` @ `55187ad`. Tidak ada kode produksi yang ditulis. Branch T6 (`claude/t6-job-runner` @ df299d9) dan T7 (`claude/t7-admin` @ 072a34b) dibaca, tidak di-merge.

> REVISI 13 Nov 2026 (keputusan owner via orchestrator, lihat §8): aktivasi akun memakai email + nomor HP order, bukan email undangan SMTP. Di mana §0, §3, §4.5 dan §5 menyebut "email undangan" atau SMTP wajib, §8 yang berlaku. Bagian yang tidak disebut di §8 tetap.

Label bukti yang dipakai:
- **terverifikasi dokumen**: saya baca sendiri di dev.scalev.com (13 Nov 2026) atau di kode repo.
- **dari temuan Hermes**: hasil panggilan API live Hermes. Sesi ini tidak punya kredensial Scalev, jadi tidak saya ulang.
- **belum dicek**: tidak ada di dokumen yang saya baca dan tidak ada di temuan Hermes.

## 0. Ringkasan

1. Arsitektur sebagian besar sudah siap dipindah. Yang terikat Supabase hanya satu antarmuka kecil: `OtpProvider` (`src/server/auth/providers.ts`) plus skema `auth.users` / `auth.uid()` / role `authenticated` dan `service_role`. Sesi (cookie, perangkat, batas 3, token login tertunda), rate limit, RLS, dan seluruh fungsi SQL ibadah tidak berubah.
2. Postgres di VPS cukup dengan shim `auth` yang sudah ada di `supabase/stubs/auth_stub.sql`, dipromosikan jadi bootstrap resmi. Menghindari 38 FK diganti nama. Yang belum ada: runner migration untuk Postgres biasa (selama ini Supabase CLI atau PGlite).
3. Login jadi email+password. Akun TIDAK dibuat saat pembelian. Akun baru lahir saat pembeli memakai tautan "buat password" dari email (token sekali pakai, hash di DB). Dengan begitu aturan owner (b) terpenuhi secara struktural: tidak mungkin ada baris password untuk email yang belum terbukti dimiliki.
4. Webhook Scalev: endpoint sendiri (bukan lewat pipeline `route()`), simpan dulu lalu balas 2xx, worker memverifikasi ke API Scalev, baru entitlement aktif dan email undangan masuk outbox. Pengirim email = worker T6 dengan handler `send_email` baru (T7 sudah memasukkan job `send_email`, tetapi tidak ada handler-nya di T6).
5. Temuan baru yang mengubah desain: `GET /v3/orders/{id}` hanya memberi `orderlines[].variant` (angka) dan `variant_sku`, bukan `variant_unique_id`. Pemetaan angka ke `variant_...` perlu resolver. Ini harus dicek dengan satu order nyata sebelum S2 dikerjakan (pertanyaan Q1).

Keputusan paling mendesak untuk owner: lihat §6. Tanpa produk Tahajud Tracker di Scalev, SMTP, domain, dan VPS, tahap integrasi live tidak bisa diuji. Kode tetap bisa dibangun dengan adapter + mock.

## 1. Audit Scalev per nomor

| # | Klaim | Label | Catatan |
|---|-------|-------|---------|
| 1 | API key valid; `GET /v3/stores/simplified` 200; store id 2785, business id 2408, domain ngajigaes.com | dari temuan Hermes | Tidak saya ulang (tanpa kredensial) |
| 2 | 14 produk, tidak ada "Tahajud Tracker" | dari temuan Hermes | Blocker B1: produk harus dibuat owner |
| 3 | Join key varian = `variant_unique_id` (`variant_...`) | terverifikasi dokumen | `sell-one-time-software-with-scalev.md`: nilai yang sama muncul sebagai `variant_unique_id` di orderlines `order.created`, dan sebagai `unique_id` di `GET /v3/stores/{store_id}/products` |
| 3a | **Temuan baru**: respons `GET /v3/orders/{id}` TIDAK punya `variant_unique_id` | terverifikasi dokumen | `reference/getorder.md`: orderlines hanya `variant` (integer "Variant ID"), `variant_sku`, `variant_price`. Perlu resolver angka ke `unique_id` lewat `GET /v3/stores/{store_id}/variants/{variant_id}` (scope `product:read`) atau daftar produk (`product:list`). Cek dengan 1 order nyata (Q1) |
| 4 | Ada order dengan `customer.email = null` | dari temuan Hermes | Schema OpenAPI memang tidak mewajibkan `customer.email`. Checkout wajib mengaktifkan field email (cookbook §4). Tanpa email: karantina, bukan akses |
| 5 | Header `X-Scalev-Hmac-Sha256`, HMAC-SHA256 atas raw body, Base64, bandingkan konstan | terverifikasi dokumen | `verifying-a-webhook-request.md`. Bandingkan byte hasil decode Base64, bukan string |
| 6 | Payload `{event, unique_id, timestamp, data}`; `unique_id` = kunci idempotensi; `data.id` = UUIDv7 order; `data.order_id` = nomor tampil | terverifikasi dokumen | `webhook-events.md`, `payload-example.md`, parameter `OrderId` di OpenAPI ("Canonical UUIDv7 order primary key") |
| 7 | `payment.received` saat `payment_status` = `paid` atau `settled`; tanpa `orderlines`; bisa datang dua kali (paid lalu settled) | terverifikasi dokumen | `webhook-events.md` |
| 7a | Email di `payment.received` | belum dicek | Teks dokumen bilang payload memuat objek `customer`, tetapi contoh payload (`order.payment_status_changed`) tidak punya. Jangan diandalkan; email diambil dari GET order |
| 8 | `order.created` memuat `data.customer.email`, `data.destination_address.email`, `data.orderlines[].variant_unique_id` | terverifikasi dokumen (sebagian) | Cookbook menyebut ketiganya. Contoh payload `order.created` hanya menampilkan `destination_address.email` dan orderlines, tanpa `customer`. Urutan baca email dari snapshot: `customer.email`, lalu `destination_address.email`. Hanya petunjuk, bukan otoritas |
| 9 | Jangan pakai `order.status_changed == confirmed` sebagai sinyal bayar | terverifikasi dokumen | Cookbook §5 |
| 10 | Tidak ada event refund khusus; sinyal: `payment.failed` (conflict), `order.status_changed` (mis. canceled) | terverifikasi dokumen | Daftar event lengkap (11 event) dibaca; tidak ada event refund. `payment.failed` = `conflict`. Cara mencabut akses tetap kebijakan owner (Q7) |
| 11 | Verifikasi server-side: `GET /v3/orders/{id}` dan `POST /v3/orders/{id}/check-payment` | terverifikasi dokumen | Keduanya scope `order:read`, keduanya mengembalikan objek `Order`. Efek samping `check-payment` (POST) belum jelas: belum dicek. Default pakai GET |
| 11a | Enum `payment_status` order: `unpaid`, `paid`, `conflict`, `settled` | terverifikasi dokumen | Enum `status` order: draft, pending, confirmed, in_process, ready, shipped, completed, canceled, rts, closed. `payment_status_history[].status` di OpenAPI memakai enum status order (tampak salah di dokumen): jangan dipakai |
| 12 | Uji webhook: simpan dengan toggle ON memicu `business.test_event`, wajib balas 2xx, kalau gagal pengaturan tidak tersimpan | terverifikasi dokumen | `enabling-webhooks.md`. Akibat urutan deploy: endpoint harus sudah hidup dan secret sudah terpasang SEBELUM owner menyimpan webhook. "Tidak ada sandbox terpisah": dari temuan Hermes (dokumen tidak menyebut sandbox) |
| 13 | Email Scalev tidak bisa membawa link unik per pembeli | terverifikasi dokumen (sebagian) | `send-lms-access` tidak punya request body. `send-digital-product`: body belum saya baca. Redirect pascabayar: dokumen menyatakan Scalev tidak menambahkan data pembeli/order ke URL, dan melarang menaruh token di URL |
| 14 | Password acak LMS Scalev tidak bisa diambil lewat API | dari temuan Hermes | Tidak relevan lagi: app tidak memakai LMS Scalev |
| 15 | **Temuan baru**: webhook hanya tersedia di paket Scalev Basic ke atas | terverifikasi dokumen | `enabling-webhooks.md`. Blocker B4 (konfirmasi paket) |
| 16 | Rate limit API key: 10.000/jam, 100/10 detik; 429 bisa berupa teks biasa | terverifikasi dokumen | Klien Scalev harus menangani 429 non-JSON dan membaca `X-Ratelimit-*` |
| 17 | Jadwal retry pengiriman webhook Scalev (berapa kali, berapa lama) | belum dicek | Dokumen hanya bilang "Scalev retries failed deliveries" dan pengiriman "at least once, order tidak dijamin". Karena itu sweeper polling (§4.6) wajib ada |
| 18 | Rotasi signing secret | belum dicek | Dokumen tidak membahas. Kode mendukung dua secret (aktif + sebelumnya) sesuai PRD SEC-06 |
| 19 | `GET /v3/orders` bisa difilter `payment_status`, `store_id`, `product_id`, cursor (maks 25 per halaman, urut `created_at` turun) | terverifikasi dokumen | `reference/listorders.md`, scope `order:list`. Tidak ada filter `paid_time`; sweeper jalan dari terbaru ke belakang sampai ketemu order yang sudah direkonsiliasi |
| 20 | Pola pilihan owner (email set-password dari app, token sekali pakai di-hash, TTL contoh 60 menit, jangan timpa password user lama) | terverifikasi dokumen | Cookbook Scalev §7 menyarankan persis ini |
| 21 | Jenis API key milik Hermes (`sk_` penuh atau `rk_` terbatas) | belum dicek | App WAJIB pakai key terpisah bertipe restricted: scope `order:read`, `order:list`, `product:list` (dan `product:read` jika memakai endpoint varian). Jangan pakai ulang key Hermes |

Konsekuensi untuk PRD §20: nama event di PRD v1.2 (`order.updated`, `order.payment_status_changed`) valid tetapi tidak perlu disubscribe. Subscribe minimum: `order.created`, `payment.received`, `payment.failed`, `order.status_changed`, `order.deleted`.

## 2. Gap kode vs temuan

Dibaca di `main` @ 55187ad, plus T6 dan T7 dari branch.

| # | Temuan | Lokasi | Dampak |
|---|--------|--------|--------|
| G1 | Tidak ada route webhook. `src/app/api/v1/` hanya punya `[...path]` catch-all dan route bernama; tidak ada `webhooks/`. Tabel `webhook_events`, `purchase_orders`, `purchase_order_items`, `access_entitlements`, `email_outbox`, `jobs` sudah ada tetapi belum ada kode yang menulisnya (kecuali T3c export/delete dan T7 approve) | `supabase/migrations/20261113000200_access.sql`, `..000600_system.sql` | Seluruh §4 dibangun baru |
| G2 | Tidak ada klien Scalev, verifikasi HMAC, allowlist varian, env Scalev | `src/server/**`, `.env.example` | Baru |
| G3 | `webhook_events` tidak punya kolom referensi order untuk pencarian dan penyapuan | `..000200_access.sql:92` | Tambah `scalev_order_id`, `event_type` sudah ada |
| G4 | `purchase_orders.customer_email_normalized` `NOT NULL`, tidak ada `quarantine_reason`, tidak ada nomor tampil order, `purchase_order_items.product_id` `NOT NULL` padahal kita hanya punya varian | `..000200_access.sql:41-68` | Order tanpa email tidak bisa dikarantina di skema sekarang |
| G5 | `email_outbox` tidak punya `idempotency_key`, `last_error`, `created_at`, `locked_*` | `..000600_system.sql:18` | Email undangan bisa dobel; tidak ada jejak gagal |
| G6 | T7 memasukkan job `send_email` (`admin_queue_email`), T6 tidak punya handler untuk jenis itu; job akan gagal "no handler" | T7 `20261115c0300_admin_support.sql:119`, T6 `src/server/jobs/handlers.ts` | Handler + pengirim SMTP belum dimiliki siapa pun |
| G7 | T6 `max_attempts` default 5, sedangkan PRD §20.3 butuh retry sampai 3 hari (1, 5, 15, 60 menit, lalu tiap 6 jam, kira-kira 16 percobaan) | T6 `jobs_enqueue(..., p_max_attempts)` | Pakai parameter `maxAttempts` per enqueue; tidak perlu ubah T6 |
| G8 | Skema terikat Supabase: FK ke `auth.users`, `auth.uid()`, role `anon/authenticated/service_role`. `createPgDb` memakai `set local role` + `request.jwt.claims`, jalan di Postgres biasa asal role dan shim ada. Role dan shim hanya dibuat oleh `supabase/stubs/auth_stub.sql` untuk PGlite | `src/server/db/pg.ts`, `supabase/stubs/auth_stub.sql` | Promosikan stub jadi bootstrap; tambah role login aplikasi yang jadi anggota `authenticated` dan `service_role` |
| G9 | Tidak ada runner migration untuk Postgres nyata. `package.json` hanya punya `test:db` (PGlite). `supabase/config.toml` tidak pernah divalidasi (tanpa Docker) | `package.json`, `supabase/config.toml` | Task X1 |
| G10 | `OtpProvider` Supabase (GoTrue) tidak pernah diuji ke project nyata; config mewajibkan `SUPABASE_URL` dan `SUPABASE_ANON_KEY` | `src/server/auth/providers.ts:70`, `config.ts:36` | Dihapus seluruhnya |
| G11 | `provision_user` membuat profil dan menautkan entitlement setelah OTP; `login_otps`, `otp_issue`, `otp_verify` ada di migration T3b. T6 `housekeeping()` menghapus dari `login_otps` | `..20261114000200_api_writes.sql:20,66-120`, T6 `20261115b000100:253` | Migration drop + `create or replace housekeeping` (harus setelah T6 di-merge) |
| G12 | `callerOf` memakai entri PERTAMA `x-forwarded-for`. Di belakang nginx/Caddy yang menambahkan header, klien bisa memalsukan IP dan melewati rate limit per IP | `src/server/auth/service.ts:36-41` | Pakai entri terakhir (1 hop tepercaya) atau `x-real-ip`; atur proxy menimpa header. Task X4 + X1 |
| G13 | Pipeline `route()` memaksa cek `Origin` pada semua mutasi dan menolak tanpa cookie; webhook Scalev tidak punya keduanya | `src/server/api/route.ts:51-54` | Route webhook ditulis sendiri, tidak lewat `route()` |
| G14 | UI dan mock penuh OTP: `login-form`, `verify-form`, `auth-dev-panel`, `seed-user`, `src/data/mock/auth.ts` (393 baris), fixture, `devices-view` (teks), halaman `/auth/verify`, `domain/auth/otp.ts` | lihat §5.1 | Task X5 |
| G15 | T7 `admin_entitlement_transfer` mengganti email entitlement tetapi tidak membuat akun atau mengirim undangan untuk email baru; `admin_resend_access_email` memakai template `access_resend` yang belum punya renderer; `admin_entitlement_approve` menautkan user lewat keberadaan profil | T7 `20261115c0300:129-236` | Migration lanjutan setelah T7 merge (task X7) |
| G16 | PRD v1.2 dan `CLAUDE.md` menyatakan OTP + Supabase Auth ("Login utama = OTP 6 digit... magic link gagal di PWA iOS") | `docs/PRD-v1.2.md` §6.1, §16, §19.1, §24.1, AUTH-05..07; `CLAUDE.md` | Perlu PRD v1.3 + revisi satu baris `CLAUDE.md` oleh orchestrator (§7) |
| G17 | `scalev_order_id` di PRD v1.2 ambigu (UUIDv7 vs nomor tampil) | PRD §17.1 | Pakai `data.id` (UUIDv7) sebagai `scalev_order_id`; simpan nomor tampil di kolom baru |

## 3. Rencana migrasi OTP ke email+password

### 3.1 Aturan owner menjadi mekanisme

| Aturan | Mekanisme | Cara diuji |
|--------|-----------|------------|
| (a) Tidak ada password default yang sama | Tidak ada jalur yang menetapkan password selain pemiliknya mengetik sendiri lewat token. Seed, admin, script, dan webhook tidak pernah menyentuh password. Admin hanya bisa memicu email "atur ulang" | Test: tidak ada fungsi SQL atau endpoint yang menerima password selain `set-password`, `login`, `me/password`; grep kode `password_hash` hanya di modul auth |
| (b) Email terbukti dimiliki minimal sekali sebelum password dibuat atau dipakai | Akun dan baris `auth_credentials` baru dibuat saat token dikonsumsi. Token hanya terkirim ke email lewat SMTP. Tanpa baris kredensial, login mustahil. Constraint DB: `email_verified_at NOT NULL` | Test DB: tidak ada `auth_credentials` tanpa `email_verified_at`; token palsu/kedaluwarsa tidak membuat akun |
| (c) Password tidak pernah plaintext | Hanya hash scrypt (string PHC dengan parameter) di `auth_credentials.password_hash`. Token hanya disimpan sebagai HMAC. Token mentah dibuat saat worker mengirim email, tidak disimpan di outbox maupun job. Logger menolak field bernama password/token. Transport email `file` (untuk test) ditolak di luar flag test | Test: scan seluruh tabel setelah alur lengkap tidak menemukan password uji; scan log; payload outbox tidak berisi token |
| (d) Link buat/reset sekali pakai dan berkadaluarsa | `auth_tokens`: `used_at`, `revoked_at`, `expires_at`; konsumsi atomik (`update ... where used_at is null and revoked_at is null and expires_at > now() returning`). Token baru mencabut yang lama untuk email dan tujuan yang sama. TTL: undangan 24 jam, reset 60 menit (PROVISIONAL, di `app_settings`, Q6) | Test: pakai dua kali ditolak, lewat TTL ditolak, token lama setelah token baru ditolak, dua konsumsi serentak hanya satu berhasil |

### 3.2 Model data dan migration

Migration baru, urutan nama (14 digit, sesuai `tests/db/schema.test.ts`): T3c 20261115010000, T6 20261115020000, T7 20261115030000 (penyeragaman dari RESUME), lalu:

| File | Isi | Pemilik |
|------|-----|---------|
| `supabase/bootstrap/00_roles_auth.sql` (pindah dari `supabase/stubs/auth_stub.sql`, `git mv`) | Role `anon`, `authenticated`, `service_role` (idempoten), skema `auth`, `auth.users`, `auth.uid()`. Dipakai PGlite dan runner VPS. Tambah blok komentar: role login aplikasi (`tt_app`) dibuat di `docs/DEPLOYMENT-VPS.md`, bukan di sini | X1 |
| `20261116030000_auth_password.sql` | Tabel baru + fungsi + drop OTP (lihat bawah) | X4 |
| `20261116010000_email_outbox_hardening.sql` | `email_outbox`: kolom `idempotency_key text` (UNIQUE parsial), `created_at`, `last_error`, `locked_at`, `locked_by`, `next_attempt_at`; fungsi `app_private.email_enqueue(...)` | X2 |
| `20261116020000_scalev_orders.sql` | `webhook_events` + `scalev_order_id text`; `purchase_orders` jadi `customer_email_normalized` nullable, + `scalev_order_number`, `quarantine_reason`, `snapshot jsonb`, `snapshot_event_id`; `purchase_order_items.product_id` nullable + `variant_sku`; tabel `scalev_variant_map`; fungsi intake | X3 |
| `20261116040000_scalev_provision.sql` | `app_private.scalev_apply_order(...)` (satu transaksi: order, item, entitlement, outbox) dan fungsi sweeper | X6 |
| `20261116050000_admin_followups.sql` | Redefinisi `admin_entitlement_transfer`, `admin_entitlement_approve`, `admin_resend_access_email`; `admin_order_set_email` | X7 (setelah T7 merge) |

Tabel baru di `20261116030000_auth_password.sql` (semua RLS aktif, tanpa grant ke `anon`/`authenticated`, hanya `service_role`):

```
public.auth_credentials
  user_id uuid primary key references auth.users(id) on delete cascade
  password_hash text not null              # "$scrypt$ln=15,r=8,p=3$<salt>$<hash>"
  password_changed_at timestamptz not null
  email_verified_at timestamptz not null   # aturan (b)
  created_at, updated_at

public.auth_tokens
  token_hash text primary key              # HMAC(pepper, "pwtoken:" + token)
  email_normalized text not null
  purpose text not null check (purpose in ('setup','reset'))
  created_at timestamptz not null, expires_at timestamptz not null
  used_at timestamptz, revoked_at timestamptz
  index (email_normalized, purpose) where used_at is null and revoked_at is null
```

Fungsi (`app_private`, service_role saja, `search_path = ''`, pola yang sama dengan T3b):

| Fungsi | Tugas |
|--------|-------|
| `credential_for_login(p_email)` | Mengembalikan `{user_id, password_hash}` atau null |
| `password_token_issue(p_email, p_token_hash, p_purpose, p_now, p_ttl_seconds)` | Mencabut token aktif lain (email+purpose sama), menyimpan hash baru |
| `password_token_peek(p_token_hash, p_now)` | `{valid, email, purpose}` tanpa mengonsumsi |
| `password_token_consume(p_token_hash, p_new_hash, p_now)` | Atomik: tandai dipakai; jika akun belum ada: syarat ada baris `access_entitlements` untuk email itu (status apa pun), lalu buat `auth.users` + `profiles` + `auth_credentials`; jika akun ada: ganti hash; tautkan entitlement yang `user_id` null untuk email itu; cabut SEMUA perangkat aktif (`user_devices.revoked_at`); kembalikan `{user_id}`. Tidak membuat sesi |
| `password_change(p_uid, p_new_hash, p_current_device, p_now)` | Ganti hash, cabut perangkat lain |
| `email_has_claim(p_email)` | Apakah ada akun atau entitlement untuk email itu (untuk keputusan kirim email; hasilnya tidak pernah keluar ke respons) |

Dihapus di migration yang sama: `login_otps`, `otp_issue`, `otp_verify`, `provision_user`; `create or replace` `app_private.housekeeping` tanpa `login_otps` dan dengan `auth_tokens` (hapus yang kedaluwarsa > 7 hari). Aman karena T3b belum pernah jalan di database nyata (STATUS: hanya PGlite). Seed `app_settings` baru (semua `provisional: true`): `invite_token_minutes` 1440, `reset_token_minutes` 60, `password_min_length` 10, `login_fail_limit` 10, `login_fail_window_seconds` 900.

### 3.3 Kontrak endpoint (dibekukan di task X0)

| Method | Path | Body | Sukses | Gagal |
|--------|------|------|--------|-------|
| POST | `/auth/login` | `{email, password, device_label?}` | `{status:"ok", user, device_id, expires_at, access}` + cookie, atau `{status:"device_limit", ...}` seperti sekarang | 401 `INVALID_CREDENTIALS` (satu pesan untuk email salah, password salah, akun belum ada), 429 `RATE_LIMITED` |
| POST | `/auth/password-link` | `{email}` | 200 selalu `{ok:true, message, resend_after_seconds:60}` | 400 `VALIDATION_ERROR` (format), 429 |
| POST | `/auth/password-token/check` | `{token}` | `{valid:true, purpose, email_masked}` | 400 `INVALID_TOKEN` (satu pesan untuk salah, kedaluwarsa, terpakai, dicabut) |
| POST | `/auth/set-password` | `{token, password}` | `{ok:true}` (TANPA sesi, TANPA cookie) | 400 `INVALID_TOKEN`, 422 `WEAK_PASSWORD` dengan `details.reason` (`too_short`, `common`, `same_as_email`, `too_long`), 429 |
| POST | `/me/password` | `{current_password, new_password}` | `{ok:true}`, perangkat lain dikeluarkan | 401 `INVALID_CREDENTIALS`, 422 `WEAK_PASSWORD` |
| (tetap) | `/auth/complete-pending-login`, `/auth/logout`, `/me`, `/me/devices*` | | | |
| (dihapus) | `/auth/request-otp`, `/auth/verify-otp` | | | |

Kode error baru di `contracts.ts`: `INVALID_CREDENTIALS`, `INVALID_TOKEN`, `WEAK_PASSWORD`. Dihapus: `INVALID_OTP`.

Keputusan desain yang perlu diketahui agen:
- `set-password` tidak memulai sesi. Alasan: tautan email terbuka di browser bawaan, bukan di PWA terpasang. Di iOS, PWA dan Safari memakai penyimpanan cookie terpisah [Medium confidence, perlu uji di perangkat]. Auto-login di Safari akan memakai satu slot dari batas 3 perangkat, lalu login di PWA memakai slot kedua. Setelah password dibuat, halaman menampilkan "Password dibuat. Buka aplikasi lalu masuk." Konsekuensi lain: `device_limit` tidak mungkin terjadi di jalur ini, karena semua perangkat sudah dicabut.
- Token dibawa di fragmen URL (`/set-password#t=<token>`), bukan query. Fragmen tidak dikirim ke server, tidak masuk log akses dan header `Referer`. Pemindai tautan email (Gmail, Outlook SafeLinks) hanya melakukan GET halaman, yang tidak mengonsumsi apa pun; konsumsi hanya lewat POST. Halaman memakai `Referrer-Policy: no-referrer` dan menghapus fragmen dari URL setelah dibaca (`history.replaceState`).
- `password-link` memutuskan sendiri jenis token: akun ada berarti `reset`; tidak ada akun tetapi ada entitlement untuk email itu berarti `setup`; selain itu tidak mengirim apa-apa. Respons dan pekerjaan sinkron di request sama untuk ketiganya (pengiriman email asinkron lewat outbox), jadi waktu respons tidak membocorkan status.

### 3.4 Alur

**Pembeli baru** (diperinci di §4): webhook valid, worker memverifikasi order, entitlement aktif (`user_id` null), outbox `account_invite` dengan kunci `invite:<scalev_order_id>`. Worker pengirim membuat token `setup` (TTL 24 jam), membangun tautan `${APP_BASE_URL}/set-password#t=<token>`, mengirim lewat SMTP. Pembeli membuka tautan, halaman memanggil `password-token/check`, pembeli mengetik password dua kali, `set-password` membuat akun, menautkan entitlement, memberi halaman sukses, pembeli masuk di app lewat `/login`.

**Login:** IP limit, throttle per email, ambil kredensial, verifikasi scrypt (jalankan hash tiruan bila akun tidak ada agar waktu seragam), lalu logika perangkat T3b tidak berubah: `start_device_session`, atau `create_pending_login` bila sudah 3 perangkat. Entitlement tetap dicek di SQL pada tiap baca/tulis (tidak berubah). Pengguna yang tidak punya akses aktif tetap bisa login dan melihat `/access-status` (perilaku T1 sekarang).

**Lupa password:** `/forgot-password` memanggil `password-link`. Sama untuk pembeli yang tidak pernah menerima atau melewatkan masa berlaku undangan. Halaman login selalu menampilkan tautan "Belum punya password? Dapatkan tautan lewat email" (tidak bergantung status akun).

**Ganti password** di `/settings/account`: `me/password`.

**Perangkat ke-4:** tidak berubah. Token login tertunda (10 menit, sekali pakai) dikeluarkan setelah password benar, bukan setelah OTP benar.

### 3.5 UI

| Route | Status | Catatan |
|-------|--------|---------|
| `/login` | ubah | Email + password + "Lupa password?" + tautan undangan. Salin: "Pakai email yang sama dengan saat checkout" |
| `/auth/verify` | hapus | Halaman dan `verify-form.tsx` |
| `/forgot-password` | baru | Satu field email, respons generik, hitung mundur kirim ulang 60 detik |
| `/set-password` | baru | Membaca token dari fragmen, `check` dulu, dua field password, indikator aturan (min 10 karakter, bukan password umum), state: memuat, valid, tautan tidak berlaku (tombol minta tautan baru), sukses |
| `/payment/success` | baru | Halaman publik statis untuk redirect Scalev. Salin netral: "Pembayaran diterima. Cek emailmu untuk tautan membuat password. Bisa butuh beberapa menit. Cek folder spam." Tidak memberi akses, tidak membaca query |
| `/settings/account` | ubah | Form ganti password |
| `/settings/devices`, `access-status` | ubah teks | Hapus kata "kode"/"OTP" |
| dev panel mock (`auth-dev-panel`) | ubah | Mode demo: tampilkan "tautan buat password" demo, bukan OTP |

Mode mock (`NEXT_PUBLIC_DATA_MODE=mock`) tetap ada untuk demo dan e2e. Ia membutuhkan satu password demo yang ditulis di `src/data/mock/fixtures/auth.ts`. Ini bukan password pengguna nyata dan tidak pernah masuk database; badge "Data demo" tetap wajib. Catat di STATUS agar owner tahu pengecualian ini terhadap aturan (a) (Q9).

### 3.6 Dihapus, diubah, dipertahankan

| Dihapus | Diubah | Dipertahankan |
|---------|--------|---------------|
| `src/domain/auth/otp.ts` + test | `src/server/auth/service.ts` (hapus `requestOtp`/`verifyOtp`, tambah `login`, `requestPasswordLink`, `checkToken`, `setPassword`, `changePassword`; `callerOf`) | `cookie.ts`, `crypto.ts` (hapus `newOtp`, tambah `newToken`), `completePendingLogin`, `resolveSession`, `logout`, `listDevices`, `revokeDevice` |
| `OtpProvider`, `createLocalProvider`, `createSupabaseProvider` | `src/server/auth/config.ts` (hapus `provider`, `supabase*`, `mailDir`), `src/server/api/deps.ts` | `src/domain/auth/devices.ts`, `email.ts` |
| `/auth/request-otp`, `/auth/verify-otp` route + handler `h.requestOtp`, `h.verifyOtp` | `src/server/api/routes.ts` (bagian auth), `src/server/db/errors.ts` | Seluruh fungsi SQL ibadah, RLS, `device_sessions`, `pending_logins`, `rate_hit` |
| `app_private.local_auth_user` (CLOCK_OVERRIDE di `pglite.ts`) | `src/server/db/pglite.ts` (jalankan bootstrap baru) | Batas 3 perangkat, sesi 30 hari sliding |
| `login_otps`, `otp_issue`, `otp_verify`, `provision_user` | `src/data/contracts.ts`, `repositories.ts`, `http/index.ts`, `mock/auth.ts`, `mock/fixtures/auth.ts`, `mock/index.ts` | Tabel `profiles`, `user_devices`, dan hapus akun |
| Env: `AUTH_PROVIDER`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TAHAJUD_ALLOW_LOCAL_AUTH`, `TAHAJUD_MAIL_DIR` | `.env.example` | `SESSION_PEPPER`, `APP_ORIGINS`, `DATABASE_URL`, flag test `DB_DRIVER=pglite` + `TAHAJUD_ALLOW_TEST_DB` |
| `supabase/config.toml` (tidak pernah divalidasi) | | Direktori `supabase/` tetap bernama itu agar PGlite dan test tidak berubah |

### 3.7 Hash dan kebijakan password

- Algoritma: **scrypt bawaan Node** (`node:crypto`), tanpa dependency native, parameter di dalam string hash supaya bisa dinaikkan dan di-rehash saat login. Parameter awal `N=2^15, r=8, p=3` (sekitar 32 MiB per hash) [High confidence, diverifikasi 13 Nov 2026: OWASP Password Storage Cheat Sheet (raw GitHub, bagian scrypt) menyebut N=2^15 (32 MiB), r=8, p=3 sebagai salah satu setelan setara; Node `crypto.scrypt` memakai `maxmem` default 32 MiB dan galat bila sekitar `128*N*r > maxmem`, jadi N=2^15, r=8 tepat di batas: set `maxmem` eksplisit 64 MiB. Pilih ulang setelah benchmark di VPS nyata]. Alternatif: argon2id lewat `@node-rs/argon2` (pilihan pertama OWASP, tetapi menambah dependency biner dan konfigurasi Next `serverExternalPackages`). Default rencana: scrypt. Keputusan Q5.
- Kebijakan: panjang minimal 10, maksimal 128, tanpa aturan komposisi, tolak daftar password umum (daftar kecil yang di-bundle, tanpa panggilan ke layanan luar) dan password yang sama dengan email. Normalisasi Unicode NFKC sebelum hash.
- Pepper password: tidak dipakai. Salt acak per hash cukup; pepper menambah beban rotasi. Boleh ditambah kemudian dengan penanda versi di string hash.

### 3.8 Rate limit

Semua lewat `app_private.rate_hit` (sudah ada), kunci di-hash dengan pepper.

| Endpoint | Batas |
|----------|-------|
| `login` | 30 per 10 menit per IP; 10 gagal per 15 menit per email (setelah itu 429 untuk email itu sampai jendela habis); sukses tidak menghapus hitungan |
| `password-link` | 60 detik jeda + 3 per jam per email; 10 per jam per IP (AUTH-06 disesuaikan: permintaan ke-4 per jam ditolak) |
| `password-token/check`, `set-password` | 30 per 10 menit per IP; 10 per jam per hash token |
| `me/password` | 5 gagal per 15 menit per user |

Trade-off yang disengaja: penyerang bisa mengunci login satu email selama maksimal 15 menit. Diterima karena akun berisi data ibadah, bukan uang, dan reset lewat email tetap jalan.

### 3.9 Hubungan dengan admin T7

Sesi admin T7 tetap berdiri di atas sesi user + TOTP sendiri; tidak ada perubahan di `src/server/admin/session.ts`. Login admin = login password biasa lalu kode TOTP. Bootstrap `super_admin` pertama (`scripts/admin-grant-role.ts`, belum ada di T7): script memberi role pada akun yang sudah ada; bila akun belum ada, script mengantrekan undangan `setup` lewat outbox untuk email itu. Opsi `printLink` mencetak tautan sekali ke stdout hanya jika dijalankan di TTY dan tidak pernah ke log. Tidak ada password yang diketik atau disimpan oleh script.

## 4. Webhook Scalev, reconciliation, dan email outbox

Prinsip tetap dari CLAUDE.md dan PRD §20: akses aktif hanya setelah order diverifikasi ke API Scalev (atau approve manual admin teraudit). Payload webhook hanya pemicu, tidak pernah jadi dasar akses.

### 4.1 Intake: `POST /api/v1/webhooks/scalev`

File `src/app/api/v1/webhooks/scalev/route.ts`. Tidak memakai `route()` (G13): tanpa cek `Origin`, tanpa sesi. Runtime Node, `force-dynamic`.

1. `Content-Length` lebih dari 256 KB: balas 413 sebelum membaca. Bila tidak ada atau bohong: baca stream dengan batas 256 KB, hentikan dan balas 413 saat lewat.
2. Baca raw bytes (`Buffer`), JANGAN `req.json()`.
3. Secret: `SCALEV_WEBHOOK_SIGNING_SECRET` dan opsional `SCALEV_WEBHOOK_SIGNING_SECRET_PREVIOUS`. Tidak ada secret terpasang: 503 (agar tes simpan di dashboard Scalev gagal dengan jelas, bukan pura-pura sukses).
4. HMAC-SHA256 atas raw bytes, bandingkan dengan decode Base64 header `X-Scalev-Hmac-Sha256` lewat `timingSafeEqual` (panjang sama dulu). Cocok dengan salah satu secret berarti lolos.
5. Tidak valid: 401. Hanya log metadata (waktu, hash IP, panjang body). Tidak menulis ke DB, tidak mencatat body (AUTH-02).
6. Parse JSON, validasi Zod: `event`, `unique_id`, `timestamp` string, `data` objek.
7. Satu transaksi: insert `webhook_events` (`provider='scalev'`, `external_event_id=unique_id`, `event_type`, `scalev_order_id=data.id`, `payload_minimal` berisi `event`, nomor tampil, `payment_status`, `status`, tanpa email dan tanpa nama; `payload_encrypted` AES-256-GCM dengan `SCALEV_PAYLOAD_KEY`; `payload_sha256`) dengan `on conflict do nothing`, lalu enqueue job `scalev_event` (`dedupe_key = scalev:evt:<unique_id>`). Event bukan pemicu (mis. `business.test_event`, `order.updated`) disimpan `ignored`, tanpa job.
8. Duplikat (`unique_id` sudah ada): 200 tanpa kerja. Sukses: 200. Kegagalan DB: 503 supaya Scalev mengirim ulang. Tidak ada panggilan jaringan keluar di request ini (PRD §19.8.6).

### 4.2 Penanganan event (job `scalev_event`)

| Event | Aksi worker |
|-------|-------------|
| `business.test_event` | Tidak ada job |
| `order.created` | Simpan snapshot ke `purchase_orders.snapshot` (status bayar unpaid, varian, email petunjuk). Hanya audit dan petunjuk; TIDAK menjadi dasar keputusan akses. Boleh ditunda ke iterasi kedua bila waktu sempit |
| `payment.received` dengan `payment_status` `paid` atau `settled` | Verifikasi §4.3. Nilai lain: abaikan, log anomali |
| `payment.failed`, `order.status_changed` (canceled/closed), `order.deleted` | Segarkan order lewat GET dan terapkan kebijakan §4.8 |
| Lainnya | `ignored` |

Event tidak berurutan aman: keputusan selalu dari hasil GET order terbaru, bukan urutan kedatangan (PRD §20.2).

### 4.3 Verifikasi (worker)

Klien Scalev (`src/server/scalev/client.ts`): `fetch` dengan timeout 10 detik, `Authorization: Bearer ${SCALEV_API_KEY}`, 429 dibaca dari `X-Ratelimit-Reset` (bisa teks biasa), tidak pernah mencatat header otorisasi, URL dasar dari `SCALEV_API_BASE` (default `https://api.scalev.com`).

1. `GET /v3/orders/{data.id}`.
   - Tidak ada API key atau store id: event `awaiting_order_verification`, tanpa akses, retry panjang (6 jam), muncul di `admin_health` sebagai "Scalev belum dikonfigurasi". Admin masih bisa approve manual bila entitlement `pending_verification` ada (T7).
   - 401/403: alarm konfigurasi (event `failed`, job `failed`, tidak diulang sampai key diganti).
   - 404: ulangi 3 kali dengan jeda singkat (order baru kadang belum terbaca), lalu `dead` dan tampil di admin.
   - 5xx, timeout, 429: ulangi sesuai jadwal.
2. Evaluasi, urutan ini:

| Cek | Gagal berarti |
|-----|---------------|
| `payment_status` adalah `paid` atau `settled` | `awaiting_order_verification` + retry (AUTH-08). Jadwal PRD: 1, 5, 15, 60 menit, lalu tiap 6 jam sampai 3 hari. Dijalankan handler sendiri: handler menyelesaikan job sekarang lalu `enqueue` percobaan berikut dengan `runAfter` dan menaikkan `webhook_events.attempt_count` (backoff T6 dibatasi 1 jam, tidak cocok). Lewat 3 hari: `failed` + tampil di admin |
| `status` bukan `canceled`/`closed` | Karantina `order_canceled` |
| `is_probably_spam` bukan true | Karantina `spam_flag` (admin bisa approve) |
| Ada satu orderline yang `variant` angkanya berpadanan dengan `variant_unique_id` di `SCALEV_ALLOWED_VARIANT_IDS` (resolver di bawah) | Karantina `unknown_variant`, tanpa akses (AUTH-04) |
| `customer.email` terisi dan lolos `isPlausibleEmail` (cadangan: `destination_address.email` dari snapshot `order.created`) | Karantina `missing_email` |
| Bila `SCALEV_MIN_AMOUNT_IDR` diset: `net_revenue` memenuhi batas | Karantina `amount_below_min` |

Karantina = baris `purchase_orders` dengan `quarantine_reason`, tanpa entitlement aktif, event `done` dengan catatan. Admin melihatnya di `/admin/purchases` dan memutuskan (T7 + `admin_order_set_email`, X7). Nominal: batas minimal bersifat opsional karena kode diskon dan kode unik membuat `net_revenue` berbeda dari harga daftar; harga final belum ada (Q4).

Resolver varian (`variant-resolver.ts`): tabel `scalev_variant_map (numeric_id, unique_id, sku, fetched_at)`. Cache miss: `GET /v3/stores/{SCALEV_STORE_ID}/variants/{id}` (atau daftar produk satu kali). Resolver gagal: ulangi, jangan menebak. Jika Q1 ternyata menunjukkan GET order memang mengembalikan `variant_unique_id`, resolver dibuang dan task X6 mengecil.

### 4.4 Provisioning (satu transaksi SQL)

`app_private.scalev_apply_order(...)` (migration `20261116040000`): dalam satu transaksi,
1. upsert `purchase_orders` (`scalev_order_id = data.id`, nomor tampil, email ternormalisasi, nama pembeli, `payment_status`, nominal, `verified_via='scalev_api'`, `payment_verified_at`), item varian;
2. insert `access_entitlements` (`status='active'`, `user_id` NULL, `entitlement_type='lifetime'`) `on conflict (purchase_order_id, entitlement_type) do nothing returning`: event kedua (paid lalu settled) tidak membuat akses atau email baru (AUTH-03);
3. bila entitlement BARU: panggil `email_enqueue` dengan kunci `entitlement:<id>`: template `account_invite` jika tidak ada akun untuk email itu, atau `access_granted` jika akun sudah ada (akun lama tidak diubah dan passwordnya tidak disentuh, sesuai cookbook Scalev);
4. tandai `webhook_events.process_status='done'`.

Entitlement tidak ditautkan ke `user_id` di sini. Penautan terjadi saat token dikonsumsi (§3.2) atau saat login. Jadi "link hanya setelah email terbukti dimiliki" tetap berlaku (PRD §20.4).

### 4.5 Email outbox dan pengirim

Task X2. Semua email lewat `email_outbox`; pemicu enqueue selalu satu transaksi dengan perubahan datanya.

- `app_private.email_enqueue(p_to, p_template, p_payload jsonb, p_idempotency_key)`: insert outbox `on conflict (idempotency_key) do nothing`, enqueue job `send_email {outbox_id}` (hanya id, tidak ada alamat atau token di payload job). Kompatibel dengan `admin_queue_email` T7 (kolom baru semua opsional).
- Handler `send_email`: klaim baris (`queued` ke `sending`, kunci), render template, kirim, tandai `sent` (isi `sent_at`, `provider_message_id`, kosongkan `payload`), atau naikkan `attempt_count` dan simpan `last_error` yang sudah dibersihkan dari alamat email. Retry: 1, 5, 15, 60 menit, 6 jam, maksimal 8 percobaan, lalu `failed` dan tampil di `admin_health`.
- Template yang butuh tautan (`account_invite`, `password_reset`, `access_resend`) membuat token SAAT dikirim: handler memanggil `password_token_issue` (mencabut token aktif sebelumnya, TTL sesuai tujuan) dan menyusun `${APP_BASE_URL}/set-password#t=<token>`. Token mentah hanya ada di memori worker dan di badan email. Konsekuensi: jika SMTP menerima email tetapi worker mati sebelum menandai `sent`, percobaan ulang mengirim email kedua dengan token baru dan token pertama tidak berlaku. Teks email menyebut "pakai email terbaru".
- Template: `account_invite`, `password_reset`, `access_granted`, `entitlement_transfer_old`, `entitlement_transfer_new`, `access_resend` (dua terakhir dari T7, mereka belum punya renderer). Bahasa Indonesia, nada suportif, kalimat pendek, tanpa em-dash, versi teks polos + HTML sederhana, tanpa pixel pelacak, tanpa nama atau data ibadah.
- Transport: `EMAIL_TRANSPORT=smtp` memakai `nodemailer` (dependency baru; TLS wajib, timeout 15 detik, debug mati). `EMAIL_TRANSPORT=file` menulis pesan ke `EMAIL_FILE_DIR` HANYA bila flag test aktif (`TAHAJUD_ALLOW_TEST_DB=true` dan `DB_DRIVER=pglite`); di luar itu server menolak mulai. Tanpa konfigurasi SMTP: job gagal dengan pesan jelas (`EMAIL_NOT_CONFIGURED`), outbox tetap `queued`.
- Tanpa SPF, DKIM, dan DMARC di domain pengirim, email undangan akan masuk spam atau ditolak. Ini blocker B2, bukan hal yang bisa diselesaikan di kode.

### 4.6 Reconciliation (sweeper)

Job berulang `scalev_sweep` tiap 10 menit (didaftarkan lewat hook `EXTRA_RECURRING` di `tick.ts`; scaffolding di X0). Karena jadwal retry Scalev belum diketahui (#17) dan VPS bisa mati, sweeper adalah jaring pengaman, bukan pelengkap:

1. Self-heal: `webhook_events` berstatus `received` lebih dari 5 menit, atau `awaiting_order_verification` tanpa job aktif, dienqueue ulang.
2. Polling: `GET /v3/orders?payment_status=paid&store_id=<id>&page_size=25` lalu `settled`, terbaru dulu dengan cursor, berhenti saat ketemu order yang sudah punya `purchase_orders` terverifikasi atau melewati jendela (72 jam; sapuan dalam 14 hari tiap hari pukul 03.00 WIB). Setiap order paid yang belum dikenal dibuatkan event sintetis (`external_event_id = poll:<order_id>:<payment_status>`) dan masuk jalur `scalev_event` yang sama. Kebutuhan API: sekitar 2 panggilan per 10 menit, jauh di bawah 10.000/jam.
3. Pembersihan harian (`scalev_purge`): `payload_encrypted` dikosongkan setelah 90 hari (PROVISIONAL, PRD §24.4).

### 4.7 Matriks kegagalan

| Kondisi | Hasil |
|---------|-------|
| Signature salah | 401, tidak ada yang tersimpan |
| Body lebih dari 256 KB | 413 |
| Secret belum terpasang | 503 |
| DB mati | 503, Scalev mengirim ulang; sweeper menutup celah |
| `unique_id` ganda | 200, tidak ada kerja |
| `payment.received` datang sebelum `order.created` | Aman, keputusan dari GET |
| Paid lalu settled | Satu entitlement, satu email |
| GET order belum lunas | `awaiting_order_verification` + retry sampai 3 hari |
| Scalev 5xx, timeout, 429 | Retry |
| Scalev 401/403 | Alarm konfigurasi, tidak diulang |
| Varian tak dikenal, email kosong, spam, order batal | Karantina, tanpa akses |
| SMTP mati | Entitlement tetap aktif; pembeli bisa memakai "Lupa password" setelah SMTP pulih; outbox mengulang |
| Worker tidak berjalan | Antrean menumpuk; `admin_health` menampilkan umur job tertua. Wajib dipantau di VPS |

### 4.8 Refund dan pembatalan

Tidak ada event refund (#10). Sinyal tidak langsung (`payment.failed`, `order.status_changed` canceled, `order.deleted`) hanya memicu penyegaran GET. Bila entitlement sudah aktif lalu order berubah menjadi `conflict`, canceled, closed, atau hilang (404 stabil): worker memperbarui `purchase_orders.payment_status`, mengisi `quarantine_reason='post_payment_change'`, dan TIDAK mencabut akses otomatis. Admin memutuskan lewat `admin_entitlement_set_status` T7 (alasan wajib, tercatat di audit). Alasan: status `conflict` pada payment gateway bisa sementara; salah cabut merugikan pembeli yang sah. Rekomendasi default; owner boleh memilih suspend otomatis (Q7). Data historis tidak dihapus saat akses dicabut (PRD §20.5).

## 5. Rencana eksekusi

Prasyarat (orchestrator, bukan agen): merge Q1 dan T6 ke main dengan penamaan migration yang diseragamkan (T3c 20261115010000, T6 20261115020000, T7 20261115030000) dan perbaikan catatan integrasi di `docs/RESUME.md`. T7 tidak harus merge dulu, kecuali untuk X7. Semua task baru dibuat di sesi baru (aturan biaya di RESUME), satu branch per task, push WIP berkala, hanya orchestrator yang merge.

### 5.1 Task, ukuran, dan kepemilikan file

Ukuran: S sekitar 1 sampai 2 jam sesi, M sekitar 3 sampai 5 jam, L sekitar 6 sampai 10 jam dan bisa menghabiskan lebih dari satu jendela token. Ini perkiraan kasar dari ukuran T3b dan T6, belum terukur.

| ID | Task | Ukuran | Gelombang | File yang boleh disentuh (satu-satunya pemilik) |
|----|------|--------|-----------|-------------------------------------------------|
| X0 | Pembekuan kontrak + kerangka | S | 0 | `src/data/contracts.ts` (bagian auth: skema baru, kode error), `src/data/repositories.ts` (`AuthRepository`), `src/server/auth/tokens.ts` (kerangka: tipe `TokenIssuer`, fungsi `issuePasswordToken` yang melempar "belum diimplementasi"), `src/server/jobs/extra.ts` (baru: `extraHandlers(svc)`, `EXTRA_RECURRING`), `src/server/jobs/handlers.ts` (1 baris spread), `src/server/jobs/tick.ts` (loop `EXTRA_RECURRING`), `src/server/email/handlers.ts` dan `src/server/scalev/handlers.ts` (kerangka mengembalikan `{}`), `tests/unit/contracts-auth.test.ts` |
| X1 | Postgres VPS: bootstrap, runner migration, deploy | M | 1 | `git mv supabase/stubs/auth_stub.sql supabase/bootstrap/00_roles_auth.sql`, `src/server/db/pglite.ts` (hanya path bootstrap), `scripts/db-migrate.ts` (baru), `deploy/**` (unit systemd untuk Next dan worker, contoh Caddy/nginx, `deploy/sql/roles.sql` untuk `tt_app`, skrip backup `pg_dump` + retensi), `docs/DEPLOYMENT-VPS.md`, `package.json` (script `db:migrate`), `tests/db/migrate-runner.test.ts` |
| X2 | Email: outbox, SMTP, handler `send_email`, template | M | 1 | `supabase/migrations/20261116010000_email_outbox_hardening.sql`, `src/server/email/**` (config, transport, templates, handler), `package.json` (`nodemailer` + tipe), `.env.example` (blok email), `tests/unit/server/email-*.test.ts`, `tests/db/email-outbox.test.ts` |
| X3 | Scalev intake: route, HMAC, enkripsi payload | M | 1 | `supabase/migrations/20261116020000_scalev_orders.sql`, `src/app/api/v1/webhooks/scalev/route.ts`, `src/server/scalev/{config,signature,seal,intake,types}.ts`, `.env.example` (SELURUH blok Scalev dari §5.3), `tests/unit/server/scalev-{signature,intake}.test.ts`, `tests/db/scalev-intake.test.ts`, `tests/fixtures/scalev/*.json` (bertanda `NEEDS_VERIFICATION`) |
| X5 | UI auth email+password | L | 1 | `src/app/(auth)/**` (login, forgot-password, set-password; hapus `auth/verify`), `src/app/payment/success/page.tsx`, `src/components/auth/**`, `src/components/settings/**` + `src/app/(app)/settings/account/**` (ganti password, teks perangkat), `src/data/http/index.ts` dan `src/data/mock/**` (bagian auth), `src/data/index.ts`, `tests/e2e/r3a-*.ts`, `r3b-fixtures.ts`, `u1a-shots.spec.ts`, `tests/unit/auth/mock-auth.test.ts`, `tests/unit/ui/auth-*`, `docs/SITEMAP.md` |
| X4 | Auth server email+password | L | 2 | `supabase/migrations/20261116030000_auth_password.sql`, `supabase/seed.sql` (hasil `pnpm db:seed`), `src/server/auth/**` (hapus `providers.ts`; baru `password.ts`, `policy.ts`; isi `tokens.ts`), `src/server/api/{routes,deps}.ts` (bagian auth), `src/app/api/v1/auth/**` + `me/password/route.ts` (hapus `request-otp`, `verify-otp`), `src/server/db/{errors,pglite}.ts` (blok `local_auth_user`), `src/domain/auth/**` (hapus `otp.ts`), `src/domain/config/provisional.ts`, `.env.example` (hapus var Supabase), `tests/db/{api-writes,security,schema}.test.ts` (bagian OTP/tabel), `tests/unit/auth/domain-auth.test.ts`, `tests/unit/server/api-*.ts`, `tests/unit/server/auth-*.test.ts` |
| X6 | Scalev worker: verifikasi, provisioning, sweeper, purge | L | 2 | `supabase/migrations/20261116040000_scalev_provision.sql`, `src/server/scalev/{client,verify,variant-resolver,provision,sweep,purge}.ts`, `src/server/scalev/handlers.ts`, `tests/unit/server/scalev-{client,verify,sweep}.test.ts` (server Scalev palsu lokal, tanpa jaringan), `tests/db/scalev-apply.test.ts` |
| X7 | Integrasi, tindak lanjut admin, e2e live | M | 3 (setelah T7 merge) | `supabase/migrations/20261116050000_admin_followups.sql`, `src/server/admin/**` (endpoint `order set email`), `src/components/admin/**` dan `src/app/admin/**` (daftar karantina, set email), `scripts/admin-grant-role.ts`, `tests/e2e/{t3b-level1,t3c-endpoints}.live.ts`, `playwright.t3b.config.ts`, `tests/e2e/scalev-journey.live.ts` (webhook bertanda tangan, Scalev palsu, email file, set-password, login, akses), `tests/unit/server/admin-*` |

Ketergantungan: X0 dulu (kecil, tidak ada yang boleh mulai tanpa kontrak dan kerangka). Gelombang 1 = X1, X2, X3, X5 paralel. Gelombang 2 = X4 (butuh X1 ter-merge karena `pglite.ts`) dan X6 (butuh X2 dan X3). Gelombang 3 = X7. Mode hemat: jalankan berurutan X0, X2, X3, X1, X4, X6, X5, X7 tanpa kehilangan kebenaran.

Pemeriksaan irisan file: dalam satu gelombang tidak ada file yang dimiliki dua task, kecuali berkas bersama di bawah ini yang diselesaikan orchestrator saat merge (aturan sama seperti PLAN.md):

| Berkas bersama | Siapa menyentuh | Aturan |
|----------------|-----------------|--------|
| `package.json`, `pnpm-lock.yaml` | X1 (script), X2 (`nodemailer`) | Orchestrator `pnpm install` ulang saat konflik |
| `.env.example` | X2 (blok email), X3 (blok Scalev), X4 (hapus Supabase) | Blok terpisah, konflik teks saja |
| `tests/db/schema.test.ts` (daftar tabel dan RPC) | X2, X3, X4, X6 | Tiap task menambah barisnya sendiri; orchestrator menggabungkan |
| `docs/STATUS.md`, `docs/sessions/<ID>.md`, `docs/SESSION_LOG.md` | Setiap task | Hanya baris milik task (STATUS), satu file sesi per task |

### 5.2 Migration baru

Sudah dirinci di §3.2. Ringkas, berurutan menurut urutan merge: `20261116010000_email_outbox_hardening`, `20261116020000_scalev_orders`, `20261116030000_auth_password`, `20261116040000_scalev_provision`, `20261116050000_admin_followups`. Plus `supabase/bootstrap/00_roles_auth.sql` (bukan migration, dijalankan runner dan PGlite sebelum migration). Runner (X1) menolak migration baru yang namanya lebih awal daripada yang sudah diterapkan (hindari urutan terbalik setelah T7 merge) dan menyimpan checksum tiap file yang sudah jalan.

### 5.3 Variabel environment baru

Semua server-only. Tidak ada `NEXT_PUBLIC_` baru selain yang sudah ada. Tidak satu pun diisi di repo; `.env.example` hanya kerangka.

| Variabel | Wajib di produksi | Rahasia | Isi |
|----------|-------------------|---------|-----|
| `APP_BASE_URL` | ya | tidak | `https://...` untuk tautan email |
| `SCALEV_API_BASE` | tidak | tidak | Default `https://api.scalev.com` |
| `SCALEV_API_KEY` | ya | ya | Key RESTRICTED: `order:read`, `order:list`, `product:list` (+ `product:read` bila memakai endpoint varian) |
| `SCALEV_STORE_ID` | ya | tidak | 2785 (dari temuan Hermes) |
| `SCALEV_WEBHOOK_SIGNING_SECRET` | ya | ya | Signing secret dashboard Scalev |
| `SCALEV_WEBHOOK_SIGNING_SECRET_PREVIOUS` | tidak | ya | Selama rotasi |
| `SCALEV_ALLOWED_VARIANT_IDS` | ya | tidak | Daftar `variant_unique_id`, koma |
| `SCALEV_MIN_AMOUNT_IDR` | tidak | tidak | Batas bawah `net_revenue` (Q4) |
| `SCALEV_PAYLOAD_KEY` | ya | ya | 32 byte base64 untuk AES-256-GCM payload webhook |
| `EMAIL_TRANSPORT` | ya | tidak | `smtp` (produksi) atau `file` (test, dijaga flag) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | ya | `SMTP_PASS` ya | Kredensial SMTP |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | ya, opsional | tidak | Pengirim di domain ber-SPF/DKIM/DMARC |
| `EMAIL_FILE_DIR` | test saja | tidak | Folder pesan untuk e2e |
| `TRUSTED_PROXY_HOPS` | ya | tidak | Jumlah proxy tepercaya (1 untuk Caddy/nginx), dipakai `callerOf` |

Sudah ada dari T3b/T6: `DATABASE_URL`, `SESSION_PEPPER`, `APP_ORIGINS`, `CRON_SECRET`, `VAPID_*`, `PRAYER_PROVIDER`. Dihapus: `AUTH_PROVIDER`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TAHAJUD_ALLOW_LOCAL_AUTH`, `TAHAJUD_MAIL_DIR`.

### 5.4 Test penerimaan baru (ID di awal nama test)

| ID | Isi |
|----|-----|
| AUTH-06r | `password-link`: respons identik untuk email dengan akun, dengan entitlement saja, dan tak dikenal; permintaan ke-4 per jam ditolak `RATE_LIMITED` |
| AUTH-09 | `login`: pesan dan status sama untuk email tak dikenal dan password salah; hash tiruan dijalankan untuk akun yang tidak ada |
| AUTH-10 | Token sekali pakai, TTL, token baru mencabut token lama, dua konsumsi serentak hanya satu berhasil |
| AUTH-11 | `set-password` tidak membuat sesi dan mencabut semua perangkat; password yang sama dengan email, terlalu pendek, atau umum ditolak |
| AUTH-12 | Setelah alur penuh, pemindaian seluruh tabel dan log tidak menemukan password uji maupun token mentah; payload outbox tidak berisi token |
| AUTH-13 | Akun hanya terbentuk bila ada entitlement untuk email tersebut; tanpa baris `auth_credentials` tanpa `email_verified_at` |
| AUTH-14 | Login di perangkat ke-4 setelah password benar menghasilkan `device_limit`, token tertunda sekali pakai 10 menit |
| AUTH-15 | Throttle login per email dan per IP; `callerOf` memakai hop tepercaya, entri palsu di depan diabaikan |
| SCALEV-01..12 | Signature salah 401 tanpa tulisan DB; body > 256 KB 413; secret kosong 503; `unique_id` ganda tidak dobel; rotasi dua secret; paid lalu settled satu entitlement dan satu email; payment sebelum order; order belum lunas menunggu dan retry; varian asing, email kosong, spam, batal masuk karantina tanpa akses; payload terenkripsi dan dibersihkan 90 hari; sweeper menjemput order yang tidak pernah dikirim webhook; 401/403 Scalev tidak diulang |
| EMAIL-01..06 | Kunci idempoten; retry dan `failed`; payload dibersihkan setelah terkirim; token dibuat saat kirim; transport `file` ditolak tanpa flag test; teks lolos aturan copy (tanpa em-dash) |
| RESET-01 | Jalur penuh e2e live: webhook bertanda tangan, Scalev palsu, email file, set-password, login, `access_status=active` |

### 5.5 Pekerjaan orchestrator (di luar agen)

Merge T6 dan Q1 sebelum X0. Merge T7 sebelum X7. Seragamkan nama migration. Tulis PRD v1.3 dan ubah `CLAUDE.md` (§7). Tambah keputusan teknis ke `docs/DECISIONS.md` (daftar usulan di §7). Perbarui `docs/PLAN.md`: T5 digantikan X0..X7. Review keamanan hasil gabungan X3, X4, X6 sebelum merge ke main (HMAC, enkripsi payload, hash password, konsumsi token).

## 6. Blocker dan pertanyaan untuk owner

### Blocker (di luar kode)

| # | Blocker | Memblokir |
|---|---------|-----------|
| B1 | Produk Tahajud Tracker belum ada di Scalev (14 produk, tidak ada). Buat produk Digital, akses Permanent, satu varian, masukkan ke store 2785. Catat `variant_unique_id` dan id numerik varian. Checkout Page: field email WAJIB, PayLink aktif, redirect pascabayar ke `https://<domain app>/payment/success`. Konfirmasi paket Scalev Basic ke atas (webhook, temuan #15) | Uji live X3, X6, X7 |
| B2 | Domain app + domain pengirim email dengan SPF, DKIM, DMARC, kredensial SMTP | Email nyata (X2 jalan dengan transport `file` tanpa ini) |
| B3 | VPS: sistem operasi, spesifikasi, versi Postgres (PRD sebut 15 sampai 17), reverse proxy dan TLS, tujuan backup harian | Deploy (X1 menulis dokumen dan skrip, tidak bisa menguji tanpa VPS) |
| B4 | API key Scalev terpisah bertipe restricted untuk app dan signing secret webhook, dimasukkan lewat secret environment (bukan chat). Jangan pakai ulang key Hermes | X6 live |
| B5 | Tidak ada Docker atau Postgres nyata di sesi agen. Runner migration dan pembuatan role `tt_app` hanya teruji di PGlite; perilaku `set local role` dengan role login bukan superuser belum terbukti di Postgres 16/17 | Perlu uji pertama di VPS atau Postgres lokal |
| B6 | T6 (dan T7 untuk X7) belum merge | Mulai X0 |

### Pertanyaan

| # | Pertanyaan | Rekomendasi | Memblokir |
|---|------------|-------------|-----------|
| Q1 | Untuk Hermes: ambil satu order nyata berstatus paid lewat `GET /v3/orders/{id}`. Apakah `orderlines[]` memuat `variant_unique_id`? Bentuk `customer.email`? Simpan juga satu payload `order.created` dan satu `payment.received` nyata (hapus email dan nama) ke `tests/fixtures/scalev/` | Wajib sebelum X6 dimulai; menentukan perlu tidaknya resolver varian dan menutup temuan 7a, 8 | X6 |
| Q2 | Domain produksi app (untuk `APP_BASE_URL`, redirect Scalev, `APP_ORIGINS`) | | X7, deploy |
| Q3 | Subscribe event Scalev: `order.created`, `payment.received`, `payment.failed`, `order.status_changed`, `order.deleted` | Setuju | Uji live |
| Q4 | Harga final, dan apakah memakai kode diskon atau kode unik. Menentukan `SCALEV_MIN_AMOUNT_IDR` atau tanpa batas | Tanpa batas sampai harga final; nominal tetap dicatat | X6 (opsional) |
| Q5 | Hash password: scrypt bawaan Node tanpa dependency baru (default) atau argon2id dengan dependency biner | scrypt, parameter dinaikkan setelah benchmark di VPS | X4 |
| Q6 | Masa berlaku tautan: undangan pembeli baru 24 jam, reset 60 menit. Password minimal 10 karakter. Batas gagal login 10 per 15 menit per email | Setuju (semua PROVISIONAL di `app_settings`) | X4 |
| Q7 | Refund atau `conflict` setelah akses aktif: tandai untuk admin tanpa cabut otomatis (default) atau suspend otomatis dari hasil GET | Tandai saja; refund pembelian lifetime jarang, salah cabut merugikan pembeli sah | X6 |
| Q8 | Email `super_admin` pertama (untuk undangan bootstrap) | | X7 |
| Q9 | Mode demo (mock) butuh satu password demo di fixture, tidak pernah masuk DB. Boleh sebagai pengecualian aturan (a)? | Boleh, dengan badge "Data demo" | X5 |
| Q10 | Pembelian untuk orang lain atau email salah ketik: ditangani admin lewat fitur transfer T7 (PRD OPS-03), tanpa self-service pembeli | Setuju | X7 |
| Q11 | Keputusan T3c yang masih tertunda: email yang sudah menghapus akun lalu daftar ulang = tanpa akses. Di model baru, entitlement lama sudah dianonimkan, jadi pembelian baru lewat Scalev tetap satu-satunya jalan ke akses | Pertahankan default | tidak memblokir |

## 7. Perubahan dokumen yang harus dibuat orchestrator

Saya tidak mengubah berkas ini (hak orchestrator menurut PLAN.md dan CLAUDE.md).

| Berkas | Perubahan |
|--------|-----------|
| `CLAUDE.md` | Ganti "Login utama = OTP 6 digit diketik di app (magic link gagal di PWA iOS)" menjadi: "Login = email + password. Link email hanya untuk membuat atau mengatur ulang password: sekali pakai, ada masa berlaku, token di-hash, dibuka di browser lalu kembali ke app dengan login manual. Akun hanya lahir dari token yang dikirim ke email pembeli." Ganti "Browser hanya memakai Supabase untuk Auth" menjadi "Browser tidak memegang kredensial database; semua baca/tulis lewat `/api/v1`". Tambah non-negotiable: password hanya hash, tidak ada password default, tidak ada jalur set password selain token |
| `docs/PRD-v1.3.md` | §6.1 (alur pembelian), §16.1-16.4 dan §16.5 (VPS + Postgres, bukan Supabase; job runner `pnpm worker` + `/api/internal/cron`), §19.1 (endpoint auth baru), §19.8 dan §20 (event, resolver varian, karantina, sweeper), §24.1 (autentikasi), §27 (AUTH-05..07 diganti AUTH-06r, AUTH-09..15, tambah SCALEV-01..12, EMAIL-01..06, RESET-01), §30 (nilai PROVISIONAL baru: TTL token, batas login, parameter hash, retensi payload 90 hari) |
| `docs/DECISIONS.md` | D-X1 akun lahir saat token dikonsumsi; D-X2 token di fragmen URL dan tanpa auto-login; D-X3 token dibuat saat kirim email, bukan disimpan di outbox; D-X4 `auth` schema dipertahankan sebagai shim Postgres biasa; D-X5 refund hanya menandai; D-X6 sweeper polling sebagai jaring pengaman; D-X7 hash scrypt |
| `docs/PLAN.md` | T5 diganti X0..X7; T7 mengambil `scripts/admin-grant-role.ts` dari X7 |
| `docs/STATUS.md` | Baris Integrasi Scalev diperbarui di sesi ini; baris Auth, Admin, Backend diperbarui oleh task masing-masing |

Catatan keamanan untuk reviewer akhir (Fable): webhook tidak punya perlindungan replay selain `unique_id` dan verifikasi GET (tanda tangan hanya menutup body, tidak ada header waktu terpisah di dokumen); pemblokiran login per email bisa dipakai penyerang untuk mengunci email target maksimal 15 menit; keamanan bergantung pada `TRUSTED_PROXY_HOPS` yang benar (G12); `SCALEV_PAYLOAD_KEY` tidak punya mekanisme rotasi di iterasi pertama.

## 8. Revisi keputusan owner: aktivasi email + nomor HP, tanpa SMTP

Sumber: pesan orchestrator (session_01HkFB32yhrjHP63xkJdKYto) yang meneruskan keputusan owner. Saya mencatatnya apa adanya; belum saya konfirmasi langsung ke owner.

### 8.1 Peringatan sebelum dikerjakan

1. **Bertentangan dengan aturan tim (b)** ("pemilik email harus terverifikasi minimal sekali"). Bukti kepemilikan berubah dari "bisa membuka mailbox" menjadi "tahu email + nomor HP order". Itu bukti pengetahuan, bukan kepemilikan. Perlu konfirmasi eksplisit owner bahwa ini pengecualian aturan (b), dan `CLAUDE.md` perlu menuliskannya.
2. **Nomor HP semi-rahasia** (diketahui keluarga, teman, admin iklan, kurir, bahkan tampil di bukti transfer). Email pembeli juga sering tahu orang dekat. Penyerang yang tahu keduanya sebelum pembeli asli mengaktivasi mengambil akun. Mitigasi dalam desain: wajib cocok keduanya, rate limit per email, per HP, per IP, respons gagal generik, aktivasi hanya sekali per entitlement, dan notifikasi tidak ada (tanpa email, pembeli asli tidak tahu akunnya diambil). Risiko sisa dicatat; satu-satunya penutup yang kuat adalah SMTP atau WhatsApp OTP nanti.
3. **Nomor HP order dari Scalev**: tersedia di `customer.phone` dan `destination_address.phone` pada GET order (terverifikasi dokumen: kunci `phone` ada di kedua objek). Apakah terisi dan formatnya apa pada order nyata: belum dicek (tambah ke Q1 untuk Hermes). Order tanpa email atau tanpa HP tidak bisa diaktivasi mandiri, jalur CS.
4. Penyimpanan HP: simpan HMAC (pepper, `phone:`) dari nomor ternormalisasi untuk pencocokan, bukan teks asli. Teks asli hanya di payload webhook terenkripsi. Admin butuh melihat HP untuk menghubungi pembeli: tampilkan sebagian (4 digit terakhir) kecuali `support_admin`/`super_admin` dengan audit.

### 8.2 Alur baru

**Aktivasi** `POST /auth/activate {email, phone, password, device_label?}`: satu langkah, atomik. Server menormalisasi email (aturan PRD) dan HP (`08...`, `62...`, `+62...` menjadi `62...`; buang spasi, tanda hubung, tanda kurung), lalu dalam satu transaksi mencari entitlement `active` untuk email itu dengan order terverifikasi yang `customer_phone_hash` cocok, `user_id` NULL, dan belum ada kredensial. Cocok: buat `auth.users` + `profiles` + `auth_credentials`, tautkan entitlement, mulai sesi di perangkat ini (aturan 3 perangkat sama). Tidak cocok, sudah diaktivasi, order belum lunas, atau order belum diverifikasi: SATU respons `ACTIVATION_FAILED` ("Data tidak cocok atau akun sudah aktif. Coba masuk, atau hubungi CS"). Tidak ada respons berbeda yang membedakan "email tak dikenal" dari "HP salah" dari "sudah aktif". Setelah punya password, aktivasi ulang ditolak dengan pesan yang sama; layar login selalu menawarkan "Lupa password".

Satu langkah dipilih agar tidak ada oracle "email+HP cocok" sebelum password diketik. Hash tiruan dijalankan saat gagal agar waktu seragam.

**Lupa password** `POST /auth/reset-password {email, phone, new_password}`: pembuktian sama (email + HP cocok dengan order milik akun itu), tetapi untuk akun yang sudah punya kredensial. Berhasil: ganti hash, cabut semua perangkat, tanpa sesi (login manual). Atau **tautan reset dari CS**: admin membuat token sekali pakai dari halaman admin (§8.6), CS mengirim manual via WhatsApp; pembeli membuka `/reset?...#t=<token>` lalu memanggil `POST /auth/set-password {token, password}` (endpoint dari §3 dipertahankan, hanya untuk token admin).

**Login** `POST /auth/login`, ganti password `POST /me/password`, perangkat, logout: seperti §3.

### 8.3 Dampak ke rencana awal

| Bagian | Perubahan |
|--------|-----------|
| §3.2 tabel | `auth_tokens` tetap, hanya untuk `reset` buatan admin (tanpa `setup`; kolom `email_normalized`, `created_by`). `password_token_*` dipakai admin saja. `provision_user` tetap dihapus |
| §3.3 endpoint | Hapus `/auth/password-link` dan `/auth/password-token/check` sebagai jalur publik pembeli. Tambah `/auth/activate`, `/auth/reset-password`. `/auth/set-password` tetap tetapi hanya menerima token admin; sekarang boleh membuat sesi (pembeli datang dari tautan WA di perangkatnya, bukan dari email di Safari) |
| §3.5 UI | Tambah `/activate` (email, HP, password dua kali, aturan password), `/forgot-password` meminta email + HP + password baru (bukan kirim tautan), `/reset` (tautan CS). `/set-password` diganti `/reset`. `/payment/success` memakai salinan baru: "Pembayaran diterima. Buka aplikasi lalu pilih Aktivasi akun. Pakai email dan nomor HP yang sama dengan saat order." |
| §4.4 provisioning | Tidak lagi mengantrekan email undangan. `scalev_apply_order` menyimpan `customer_phone_hash` di `purchase_orders` dan mengubah entitlement jadi `active` (user_id NULL). Email outbox tidak dipakai alur ini |
| §4.5, X2 | SMTP menjadi OPSIONAL dan bukan prasyarat apa pun. X2 turun prioritas ke "nanti"; X0 tetap membuat kerangka supaya `email_enqueue` bisa ditambahkan tanpa mengubah alur. Hapus B2 sebagai blocker peluncuran |
| §5.3 env | `SMTP_*`, `EMAIL_*`, `APP_BASE_URL` tidak wajib. Tambah `ACTIVATION_PHONE_REQUIRED=true` (default, tidak boleh dimatikan di produksi) |
| Rate limit (§3.8) | Tambah: `activate` dan `reset-password`: 5 gagal per 15 menit per email, 5 per 15 menit per hash HP, 20 per jam per IP, 3 per jam per (email, HP). Respons 429 `RATE_LIMITED` tidak membedakan sebab |

### 8.4 Model data tambahan (migration `auth_password`, X4)

- `public.purchase_orders`: kolom `customer_phone_hash text` (nullable), `activation_blocked bool default false` (CS bisa memblokir).
- `public.access_entitlements.entitlement_type` check: `('lifetime','staff_comp')`. `staff_comp` tidak punya `purchase_order_id`, punya `granted_by uuid`, `revoked_at/reason` (sudah ada). Dibuat hanya oleh admin (§8.6).
- Kebijakan level: untuk entitlement `staff_comp`, `has_all_levels(p_uid)` bernilai benar dan fungsi level (`get_current_level`, `get_level_progress`, unlock) menganggap semua level terbuka tanpa menulis `user_level_state` palsu; progres tetap tercatat apa adanya. Aturan "tidak reset progress dan tidak kunci ulang" tidak berubah. Ini mengubah fungsi SQL level T3b (`20261114000100_api_reads.sql`): masuk lingkup X4 atau task staff (§8.6), diputuskan orchestrator.
- Pengecualian laporan: agregat admin (`admin_aggregates`, T7) dan hitungan pembeli harus mengecualikan user dengan entitlement `staff_comp` (kolom turunan `is_staff`). Tidak menyentuh data per user.
- Audit: `admin_audit_logs` dipakai untuk pembuatan, pencabutan, tautan reset, blokir aktivasi. Aktivasi mandiri dan reset mandiri tidak di-audit per baris admin tetapi dicatat di tabel baru `auth_events (id, user_id, kind in ('activated','reset_self','reset_admin'), at, ip_hash)` tanpa email/HP mentah.

### 8.5 Test baru (tambahan §5.4)

| ID | Isi |
|----|-----|
| ACT-01 | Aktivasi berhasil hanya jika email + HP cocok order lunas/terverifikasi varian Tahajud; normalisasi 08/62/+62 setara |
| ACT-02 | Semua kegagalan (email asing, HP salah, order belum lunas, order tanpa HP, sudah diaktivasi) menghasilkan respons dan status identik |
| ACT-03 | Aktivasi kedua untuk entitlement yang sama ditolak; akun tidak ganda; dua aktivasi serentak hanya satu berhasil |
| ACT-04 | Rate limit per email, per HP, per IP; 429 tidak membedakan sebab |
| ACT-05 | Tidak ada HP atau password mentah di DB dan log (scan seperti AUTH-12) |
| ACT-06 | Setelah reset mandiri semua perangkat dicabut; reset tanpa akun berkredensial ditolak |
| STAFF-01 | Entitlement `staff_comp`: semua level terbuka, tercatat di audit, bisa dicabut, dikecualikan dari agregat, tanpa `purchase_orders` |
| ADMIN-RESET-01 | Token reset admin sekali pakai, kedaluwarsa (default 60 menit, PROVISIONAL), token baru mencabut lama, dibuat dengan alasan wajib dan audit |

### 8.6 Brief singkat untuk pekerjaan yang dijalankan orchestrator paralel

| ID | Isi | File yang dimiliki | Bergantung |
|----|-----|--------------------|------------|
| X3 + X6 (Scalev) | Seperti §4 dengan perubahan: simpan `customer_phone_hash` dari `customer.phone` (cadangan `destination_address.phone`) saat `scalev_apply_order`; karantina `missing_phone` selain `missing_email`; tanpa email undangan. Baca ulang Q1 untuk bentuk `phone` | `supabase/migrations/*_scalev_*.sql`, `src/server/scalev/**`, `src/app/api/v1/webhooks/scalev/route.ts`, `tests/unit/server/scalev-*`, `tests/db/scalev-*` | Migration `auth_password` (kolom HP); T6 |
| X8 (admin: staff + tautan reset) | Setelah T7 merge: endpoint dan UI admin untuk (1) membuat akun staff tanpa pembelian: membuat `auth.users` + profil + entitlement `staff_comp`, password awal TIDAK dibuat admin, staf diberi tautan reset sekali pakai; (2) mencabut `staff_comp`; (3) membuat tautan reset untuk pembeli (alasan wajib, ditampilkan sekali, tidak disimpan teks asli); (4) blokir aktivasi sebuah order; (5) menyembunyikan HP kecuali dua peran dengan audit. Perubahan `get_*level*` untuk bypass staff bila belum di X4 | `supabase/migrations/*_admin_staff.sql`, `src/server/admin/**`, `src/components/admin/**`, `src/app/admin/**`, `tests/unit/server/admin-*`, `tests/e2e/admin-*` | T7 merge, X4 |

### 8.7 Task bagian 1 (X0, X4, X5 yang berubah)

- **X0**: kontrak baru (`activate`, `reset-password`, `ACTIVATION_FAILED`, `WEAK_PASSWORD`, `INVALID_CREDENTIALS`, `INVALID_TOKEN`), hapus `password-link`.
- **X4**: migration `auth_password` (kredensial, token reset admin, kolom HP, `staff_comp`, `auth_events`), servis `activate/reset/login/changePassword`, hapus OTP.
- **X5**: layar `/login`, `/activate`, `/forgot-password`, `/reset`, `/payment/success`, `/settings/account`; mock repository dengan order demo (email + HP demo, bukan password nyata); e2e.
- Urutan bagian 1 saat dieksekusi: X0, X4 (butuh bootstrap DB: bisa ikut di task yang sama bila X1 belum ada), X5, lalu hapus jalur OTP setelah alur baru hijau.

### 8.8 Pertanyaan tambahan

| # | Pertanyaan | Rekomendasi |
|---|------------|-------------|
| Q12 | Konfirmasi owner: aktivasi tanpa mailbox adalah pengecualian aturan tim (b) | Konfirmasi tertulis, catat di `CLAUDE.md` |
| Q13 | Perlu notifikasi ke pembeli asli bila akun diaktivasi? Tanpa SMTP tidak ada saluran | Tampilkan di layar sukses "Akun aktif untuk [email]"; tambah email/WA saat tersedia |
| Q14 | Format HP di Scalev nyata dan apakah selalu terisi (Q1, Hermes) | Tambahkan ke daftar cek Hermes |

### 8.9 Tambahan dari orchestrator (13 Nov, pesan ke-3) dan default PROV

- Email + HP pembeli disimpan dari hasil `GET /v3/orders/{id}` yang dibaca worker, BUKAN dari payload webhook. HP dinormalisasi lalu di-hash (§8.1 butir 4). Ini sudah sesuai §4.3; bedanya §4.3 memberi cadangan email dari snapshot `order.created`: untuk aktivasi cadangan itu DIHAPUS (hanya data dari GET yang boleh dipakai mencocokkan).
- Layar `/activate` satu halaman: email + HP, lalu form password pada halaman yang sama. Server tetap menerima semuanya dalam satu request `POST /auth/activate` (§8.2) supaya tidak ada oracle antar langkah. Tampilan dua tahap hanya urusan UI.
- X2 keluar dari jalur kritis. Handler `send_email` (T7 sudah mengantrekan job ini) menjadi no-op terdokumentasi: menandai baris outbox `failed` dengan `last_error='EMAIL_NOT_CONFIGURED'` dan tidak mencoba kirim. SMTP ditambahkan nanti tanpa mengubah alur.
- Token reset admin: TTL 60 menit (menggantikan 24 jam di ADMIN-RESET-01), hash HMAC, sekali pakai, token baru mencabut yang lama.
- Default yang berlaku sampai owner mengubah (semua PROVISIONAL): Q5 scrypt (N=2^15, r=8, p=3, sumber di §3.7); Q6 password minimal 10 karakter, reset admin 60 menit, batas gagal login 10 per 15 menit; Q7 refund hanya menandai untuk admin; Q9 password demo hanya di mode mock dengan label jelas; Q10 transfer email lewat admin dengan audit.
- Status eksekusi bagian 1: belum dimulai. Perintah eksekusi hanya datang lewat pesan antar-sesi dan belum dikonfirmasi owner langsung atau lewat prompt sesi baru, sedangkan brief sesi ini melarang kode produksi.
