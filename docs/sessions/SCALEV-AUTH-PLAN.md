# SCALEV-AUTH-PLAN: audit Scalev + migrasi auth ke email+password + webhook Scalev

Sesi perencanaan, 13 Nov 2026 (tanggal sistem sesi: 12 Nov). Branch `claude/scalev-email-pass` dari `main` @ `55187ad`. Tidak ada kode produksi yang ditulis. Branch T6 (`claude/t6-job-runner` @ df299d9) dan T7 (`claude/t7-admin` @ 072a34b) dibaca, tidak di-merge.

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
| G9 | Tidak ada runner migration untuk Postgres nyata. `package.json` hanya punya `test:db` (PGlite). `supabase/config.toml` tidak pernah divalidasi (tanpa Docker) | `package.json`, `supabase/config.toml` | Task V6 |
| G10 | `OtpProvider` Supabase (GoTrue) tidak pernah diuji ke project nyata; config mewajibkan `SUPABASE_URL` dan `SUPABASE_ANON_KEY` | `src/server/auth/providers.ts:70`, `config.ts:36` | Dihapus seluruhnya |
| G11 | `provision_user` membuat profil dan menautkan entitlement setelah OTP; `login_otps`, `otp_issue`, `otp_verify` ada di migration T3b. T6 `housekeeping()` menghapus dari `login_otps` | `..20261114000200_api_writes.sql:20,66-120`, T6 `20261115b000100:253` | Migration drop + `create or replace housekeeping` (harus setelah T6 di-merge) |
| G12 | `callerOf` memakai entri PERTAMA `x-forwarded-for`. Di belakang nginx/Caddy yang menambahkan header, klien bisa memalsukan IP dan melewati rate limit per IP | `src/server/auth/service.ts:36-41` | Pakai entri terakhir (1 hop tepercaya) atau `x-real-ip`; atur proxy menimpa header. Task V1 + V6 |
| G13 | Pipeline `route()` memaksa cek `Origin` pada semua mutasi dan menolak tanpa cookie; webhook Scalev tidak punya keduanya | `src/server/api/route.ts:51-54` | Route webhook ditulis sendiri, tidak lewat `route()` |
| G14 | UI dan mock penuh OTP: `login-form`, `verify-form`, `auth-dev-panel`, `seed-user`, `src/data/mock/auth.ts` (393 baris), fixture, `devices-view` (teks), halaman `/auth/verify`, `domain/auth/otp.ts` | lihat §5.1 | Task V2 |
| G15 | T7 `admin_entitlement_transfer` mengganti email entitlement tetapi tidak membuat akun atau mengirim undangan untuk email baru; `admin_resend_access_email` memakai template `access_resend` yang belum punya renderer; `admin_entitlement_approve` menautkan user lewat keberadaan profil | T7 `20261115c0300:129-236` | Migration lanjutan setelah T7 merge (task V7) |
| G16 | PRD v1.2 dan `CLAUDE.md` menyatakan OTP + Supabase Auth ("Login utama = OTP 6 digit... magic link gagal di PWA iOS") | `docs/PRD-v1.2.md` §6.1, §16, §19.1, §24.1, AUTH-05..07; `CLAUDE.md` | Perlu PRD v1.3 + revisi satu baris `CLAUDE.md` oleh orchestrator (§7) |
| G17 | `scalev_order_id` di PRD v1.2 ambigu (UUIDv7 vs nomor tampil) | PRD §17.1 | Pakai `data.id` (UUIDv7) sebagai `scalev_order_id`; simpan nomor tampil di kolom baru |
