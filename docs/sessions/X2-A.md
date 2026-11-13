# X2-A: T6 job runner selesai, intake Scalev (X3), worker Scalev (X6)

Tanggal 13 Nov 2026. Branch `claude/x2a-jobs-scalev` dari main @ `10c4081` (auth email + password sudah masuk), ditambah merge `origin/claude/t6-job-runner` (WIP T6). Brief: `docs/briefs/X-part2-A.md`. Rencana: `docs/sessions/SCALEV-AUTH-PLAN.md` §4, §5.3, §5.4, §8 (§8.9 menimpa §4).
Tidak ada kredensial Scalev yang diminta atau dipakai. Semua test memakai server Scalev palsu di `127.0.0.1` (`tests/unit/server/scalev-fake.ts`) dan fixture berlabel NEEDS_VERIFICATION. Tidak ada PR, tidak ada push ke main.

## Commit (push per tahap)
| Tahap | Commit | Isi |
|-------|--------|-----|
| 1 | `b8598af` | T6 hijau di atas auth password |
| 2 | `122ee46` | X3 intake webhook |
| 3 | `a0ce6b7` | X6 worker, sweeper, purge, tes aktivasi end-to-end |
| 3b | commit terakhir branch | config test, perbaikan regex host lokal, dokumen |

## Hasil
| Bagian | Status |
|--------|--------|
| T6: migration `20261117010000_jobs_runner.sql` (rename), regex nama migration kembali 14 digit | Selesai |
| T6: `housekeeping()` tanpa `login_otps`; `auth_tokens` (7 hari setelah akhir hidup) dan `auth_events` (90 hari, setting `auth_events_retention_days`, PROV) | Selesai, teruji |
| T6: test TTL push (`vi.hoisted`), smoke `pnpm worker --once` (`DB_DRIVER=pglite`) | Selesai (4 test, smoke tanpa error kecuali `prayer_sync` yang memang gagal jelas tanpa `PRAYER_PROVIDER`) |
| T6: `.env.example` `CRON_SECRET`, `NOTIF_ALLOW_DEMO_BANK`, `PRAYER_PROVIDER` | Selesai |
| T6: handler `send_email` no-op (`EMAIL_NOT_CONFIGURED`) | Selesai, 4 test |
| X3: `POST /api/v1/webhooks/scalev` + migration `20261117020000_scalev_orders.sql` | Selesai |
| X6: `src/server/scalev/{client,verify,variant-resolver,provision,sweep,purge,handlers}.ts` + migration `20261117030000_scalev_provision.sql` | Selesai |
| Aktivasi end-to-end (webhook bertanda tangan, job, GET palsu, entitlement, `POST /auth/activate`, login) | Selesai, `scalev-activation.test.ts` |

## Peta test penerimaan (rencana §5.4)
| ID | Di mana |
|----|---------|
| SCALEV-01 tanda tangan salah: 401, DB tidak dibuka | `scalev-intake.test.ts` |
| SCALEV-02 body > 256 KB: 413 (Content-Length, stream tanpa panjang, panjang bohong) | `scalev-intake.test.ts` |
| SCALEV-03 secret atau kunci payload kosong: 503 | `scalev-intake.test.ts`, `scalev-config.test.ts` |
| SCALEV-04 `unique_id` ganda, juga serentak: satu baris, satu job | `scalev-intake.test.ts`, `scalev-apply.test.ts` (DB) |
| SCALEV-05 rotasi dua secret | `scalev-intake.test.ts` |
| SCALEV-06 paid lalu settled (juga serentak): satu entitlement | `scalev-worker.test.ts`, `scalev-apply.test.ts` |
| SCALEV-07 payment sebelum order.created | `scalev-worker.test.ts` |
| SCALEV-08 belum lunas menunggu 1/5/15/60 menit lalu 6 jam, 3 hari lalu `failed` | `scalev-worker.test.ts` |
| SCALEV-09 karantina: varian asing, email kosong, HP kosong, spam, batal, nominal | `scalev-worker.test.ts`, `scalev-verify.test.ts` |
| SCALEV-10 payload terenkripsi, bisa dibuka hanya dengan kunci + id event; dikosongkan setelah 90 hari | `scalev-intake.test.ts`, `scalev-sweep.test.ts` |
| SCALEV-11 sweeper menjemput order tanpa webhook | `scalev-sweep.test.ts` |
| SCALEV-12 401/403 Scalev tidak diulang (job, event, sweeper) | `scalev-worker.test.ts`, `scalev-sweep.test.ts` |
| Aktivasi end-to-end | `scalev-activation.test.ts` |

## Gerbang (output asli, checkout ini)
@@GATES@@

## Keputusan
Semua ada di `docs/DECISIONS.md` bagian "X2-A" (J1..J3, X3-1..5, X6-1..11). Yang paling berpengaruh ke sesi lain:
1. Entitlement dari Scalev: `active`, `user_id` null, `entitlement_type='lifetime'`, tanpa email apa pun. Pembeli menautkan lewat `/activate`.
2. Order varian asing disimpan tanpa email, HP, nama.
3. Refund/batal setelah bayar hanya menandai `purchase_orders.quarantine_reason='post_payment_change'`; akses tidak dicabut.
4. `GET /v3/orders/{id}` dibaca tanpa `variant_unique_id`: allowlist = id angka dan/atau SKU.

## Antarmuka untuk X2-B (admin) dan orchestrator
- Nilai `purchase_orders.quarantine_reason`: `unknown_variant`, `missing_email`, `missing_phone`, `amount_below_min`, `order_canceled`, `spam_flag`, `post_payment_change` (CHECK di DB). Order terkarantina punya `verified_via='scalev_api'`, TIDAK punya entitlement. Satu pengecualian: `post_payment_change` terjadi justru pada order yang punya entitlement aktif.
- Approve manual admin yang memberi akses ke order Scalev sebaiknya mengisi `verified_via='admin_manual'`: `scalev_apply_order` melewati order seperti itu (event ditandai `done`, `error_message='admin_manual'`), jadi pembacaan ulang dari Scalev tidak menimpa keputusan admin.
- `webhook_events.process_status`: `received` (menunggu job), `awaiting_order_verification` (belum lunas atau Scalev belum dikonfigurasi; `error_message` = `NOT_PAID_YET` atau `ORDER_NOT_FOUND_YET` atau `SCALEV_NOT_CONFIGURED`), `done` (`error_message` null, atau `quarantined:<alasan>`, `not_paid`, `canceled_unpaid`, `order_deleted`, `admin_manual`, `flagged:post_payment_change`), `failed` (`SCALEV_AUTH_REJECTED`, `ORDER_NOT_FOUND`, `NOT_VERIFIED_IN_3_DAYS`), `ignored` (`not_a_trigger`, `missing_order_id`, `payment_status_not_paid`). Untuk `admin_health`: event `failed` atau `awaiting_order_verification` dengan `SCALEV_NOT_CONFIGURED` = alarm konfigurasi.
- `activation_blocked` tidak disentuh worker (default false, dipertahankan pada order yang dibaca ulang).
- `Services` (src/server/jobs/services.ts) kini punya field wajib `scalev` (`{ config, client, pepper }`). Harness test: `makeServices()` di `tests/unit/server/jobs-harness.ts` sudah mengisinya. Test X2-B yang membuat `Services` manual perlu field itu.
- `JobError(message, retryable, retryAfterSeconds?)`: field ketiga baru, memakai jeda dari handler menggantikan backoff default.
- Migration saya: `20261117010000`, `20261117020000`, `20261117030000`. X2-B memakai `20261117100000+`. Tidak ada tabel baru (35+6 tabel, daftar `EXPECTED_TABLES` tidak berubah).
- Satu file di luar kepemilikan saya diubah: `tests/db/api-missing.test.ts` (test T3c "drops work still waiting for the person"). Trigger reschedule T6 kini membuat job `notification_reschedule` untuk user lain di test itu, jadi perbandingan dipersempit ke jenis job yang dibuat test, dan ditambah cek bahwa tidak ada job jenis apa pun yang masih menunggu untuk user yang dihapus.

## Yang belum terbukti
- Bentuk respons Scalev (NEEDS_VERIFICATION): bungkus `GET /v3/orders/{id}` (kode menerima `{data: order}` atau order polos), bentuk daftar order (`data.results`/`data`/`results`, cursor `next_cursor`/`cursor`, `has_next`), nama `net_revenue` dan `created_at`, apakah daftar memuat `orderlines`, format `customer.phone` (Q14). Respons daftar yang tak terbaca ditandai `NEEDS_VERIFICATION` dan tidak menggagalkan job; `SCALEV_SWEEP_ENABLED=false` mematikan polling.
- Format `X-Ratelimit-Reset` (detik atau epoch): kode menerima keduanya.
- Webhook Scalev nyata: format `timestamp`, apakah `data.id` selalu UUID, jadwal retry Scalev (§1 butir 17).
- Tidak ada Postgres nyata: `FOR UPDATE SKIP LOCKED` dan advisory lock diuji di PGlite (satu koneksi). Perilaku paralel di Postgres 16/17 belum terbukti.
- Sweeper polling lewat Scalev nyata belum pernah jalan (hanya server palsu).
- Jadwal harian sweep dalam dan purge mengambang (24 jam sejak job sebelumnya), tidak dipaku 03.00 WIB.
- Jalur live e2e (`test:e2e:live`) tidak diubah dan tidak dijalankan; `scalev-journey.live.ts` milik X7.

## Pertanyaan untuk owner (semua sudah diberi default PROVISIONAL)
1. Hermes: satu order nyata dari `GET /v3/orders/{id}` dan satu halaman `GET /v3/orders?...` (tanpa data pribadi): bungkus respons, `net_revenue`, `created_at`, `orderlines` di daftar, format dan keterisian `customer.phone` (Q14), format `X-Ratelimit-Reset`.
2. Nominal minimum (`SCALEV_MIN_AMOUNT_IDR`, Q4): default kosong = tanpa cek nominal. Bila diisi dan Scalev tidak mengirim `net_revenue`, order dikarantina.
3. Refund/batal setelah bayar: default hanya menandai untuk admin (Q7). Setuju, atau suspend otomatis?
4. Order yang ditandai spam oleh Scalev (`is_probably_spam`) dikarantina walau lunas (admin bisa approve). Setuju?
5. Retensi: payload webhook 90 hari, `auth_events` 90 hari, `auth_tokens` 7 hari setelah habis. Setuju?
6. Urutan go-live: pasang `SCALEV_WEBHOOK_SIGNING_SECRET` dan `SCALEV_PAYLOAD_KEY` di server SEBELUM menyimpan webhook di dashboard Scalev (endpoint menjawab 503 sampai keduanya ada). Konfirmasi paket Scalev yang mendukung webhook (B4).
