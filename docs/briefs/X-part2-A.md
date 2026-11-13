# Brief X2-A (Sonnet, effort high): selesaikan T6 job runner, lalu Scalev intake (X3) + worker (X6)

Basis: `main` @ 242e0b7 (auth email + password sudah masuk). Buat branch `claude/x2a-jobs-scalev` dari main. Lanjutkan pekerjaan WIP `origin/claude/t6-job-runner` (cherry-pick/merge ke branch-mu; baca `docs/sessions/T6.md` di branch itu). Rencana rinci: `docs/sessions/SCALEV-AUTH-PLAN.md` §4, §5.3, §5.4, §8 (§8.9 menimpa §4 bila bertentangan). Aturan: `CLAUDE.md`.

## Tahap 1: T6 sampai hijau (commit + push sendiri)
1. Ganti nama migration `20261115b000100_jobs_runner.sql` jadi `20261117010000_jobs_runner.sql`. Kembalikan regex nama migration di `tests/db/schema.test.ts` ke 14 digit (`^\d{14}_[a-z0-9_]+\.sql$`).
2. `housekeeping()` tidak boleh menyentuh `login_otps` (tabel dihapus oleh `20261116030000_auth_password.sql`). Bersihkan `auth_tokens` kedaluwarsa/terpakai dan `auth_events` sesuai retensi yang sudah ada di migration auth (cek, jangan menebak; bila belum ada retensi, 90 hari PROVISIONAL di config).
3. Perbaiki test TTL push yang dihapus (`vi.hoisted`). Smoke `pnpm worker --once` dengan `DB_DRIVER=pglite`.
4. `.env.example`: `CRON_SECRET`, `NOTIF_ALLOW_DEMO_BANK`, `PRAYER_PROVIDER`.
5. Handler `send_email` = no-op terdokumentasi (§8.9): tandai outbox `failed`, `last_error='EMAIL_NOT_CONFIGURED'`. Tanpa SMTP.

## Tahap 2: X3 intake
Migration `20261117020000_scalev_orders.sql`. Route `POST /api/v1/webhooks/scalev`:
- Body mentah dibaca sekali, batas 256 KB (413). Secret kosong → 503. Header `X-Scalev-Hmac-Sha256` = Base64 HMAC-SHA256 body mentah, banding `timingSafeEqual`, dukung `SCALEV_WEBHOOK_SIGNING_SECRET_PREVIOUS`. Salah → 401 tanpa tulisan DB.
- Payload `{event, unique_id, timestamp, data}`. `unique_id` = kunci idempoten. `business.test_event` dibalas 200 tanpa efek.
- Simpan payload terenkripsi AES-256-GCM (`SCALEV_PAYLOAD_KEY`), purge 90 hari. Enqueue job `scalev_event`. Balas cepat 2xx.

## Tahap 3: X6 worker
Migration `20261117030000_scalev_provision.sql`. Modul `src/server/scalev/{client,verify,variant-resolver,provision,sweep,purge,handlers}.ts`.
- Jangan percaya payload. Worker memanggil `GET {SCALEV_API_BASE}/v3/orders/{id}` (`data.id`, UUIDv7). Trigger lunas: `payment.received` dengan `payment_status` `paid` atau `settled` (dicek ulang di hasil GET).
- Varian: orderlines punya `variant` (angka) dan `variant_sku`, bukan `variant_unique_id`. `SCALEV_ALLOWED_VARIANT_IDS` berisi id angka dan/atau SKU (dukung keduanya, dokumentasikan). Varian asing, email kosong, HP kosong (`missing_phone`), nominal < `SCALEV_MIN_AMOUNT_IDR`, batal → karantina, tanpa akses.
- Email dan HP hanya dari hasil GET (`customer.email`/`customer.phone`, cadangan `destination_address.*`). HP dinormalisasi + `hashPhone` (pakai `src/server/auth/crypto.ts`, jangan buat fungsi kedua). Isi `purchase_orders.customer_phone_hash`. Entitlement dibuat dalam satu transaksi, idempoten (paid lalu settled = satu entitlement).
- Tanpa email undangan (aktivasi lewat `/activate`, sudah ada).
- Sweeper: menjemput order lunas yang tak pernah dikirim webhook (pakai list order bila endpoint tersedia; bila belum terverifikasi, tandai `NEEDS_VERIFICATION` dan buat bisa dimatikan lewat config). 401/403 Scalev tidak diulang; 5xx/timeout retry dengan backoff.
- Refund/batal: hanya tandai untuk admin (Q7 PROV), jangan cabut otomatis.
- Format HP nyata belum dikonfirmasi Hermes (Q14): normalisasi menerima `08…`, `62…`, `+62…`; tulis di DECISIONS.
- Fixture di `tests/fixtures/scalev/*.json` bertanda `NEEDS_VERIFICATION`, data samaran. Test memakai server Scalev palsu lokal, tanpa jaringan.

## Test wajib
SCALEV-01..12 (§5.4), plus: aktivasi end-to-end di PGlite (webhook bertanda tangan → job → GET palsu → entitlement → `POST /auth/activate` email+HP berhasil → login).

## Kepemilikan file
Boleh: `supabase/migrations/2026111701*..03*`, `src/server/jobs/**`, `src/server/notifications/**`, `src/server/push/**`, `src/server/scalev/**`, `src/server/email/**`, `src/app/api/v1/webhooks/**`, `src/app/api/internal/**`, `scripts/worker.ts`, `tests/unit/server/{jobs,notif,scalev,email}-*`, `tests/db/{jobs,scalev,email}-*`, `tests/fixtures/scalev/**`, `tests/db/schema.test.ts` (hanya baris milikmu + regex), `.env.example` (blok jobs + Scalev), `package.json` (script saja).
Jangan sentuh: `src/server/admin/**`, `src/app/admin/**`, `src/components/**`, `src/app/(auth)/**`, `src/server/auth/**` (kecuali import), `content/**`, dokumen orchestrator selain `docs/sessions/X2-A.md`, baris STATUS milikmu, dan entri SESSION_LOG-mu. Sesi lain (X2-B) memegang admin dengan migration `20261117100000+`.

## Aturan keras
Tanpa secret di repo/log. Jangan memalsukan respons Scalev di production (mock hanya di test). Entitlement aktif hanya setelah GET order terverifikasi. Jangan log email/HP mentah.

## Selesai
`pnpm typecheck && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e --trace off && pnpm audit --prod` hijau. Laporan `docs/sessions/X2-A.md` dengan output asli. Push WIP per tahap ke branch-mu (bukan main). Kirim ringkasan ke sesi orchestrator `session_01HkFB32yhrjHP63xkJdKYto`.
