# DECISIONS

Keputusan teknis yang diambil agen. Format: tanggal, keputusan, alasan, alternatif.

## 2026-11-12 (S1 WIP, sesi orchestrator)
| # | Keputusan | Alasan | Alternatif ditolak |
|---|-----------|--------|--------------------|
| D1 | Next.js 15.5.29 (bukan 16.x) | Pola App Router 15 sudah stabil dan dikenal; 15.5.4 bawaan create-next-app rentan CVE RSC Des 2025, jadi dipakai patch 15.5 terbaru | Next 16: breaking changes (middleware → proxy, dll.) tanpa manfaat untuk S1 |
| D2 | React 19.1.10 dipin eksak | Patch keamanan RSC | Range `^19` |
| D3 | `pnpm.overrides` postcss ^8.5.23, sharp ^0.35.5 | `pnpm audit --prod` bersih (sebelumnya 5 high, 2 moderate dari dependency transitif next) | Menunggu next merilis patch |
| D4 | Tailwind v4 CSS-first, token di `:root` + `[data-theme]`, dipetakan via `@theme inline` | Satu sumber token; dark mode via atribut agar bisa "gelap saat malam" | `prefers-color-scheme` saja (tidak bisa override manual) |
| D5 | Komponen ditulis tangan gaya shadcn (cva + Radix Dialog/Slot) | Registry shadcn tidak dibutuhkan; dependency minimal | `shadcn init` (butuh akses registry, tambah file tak terpakai) |
| D6 | Font: Plus Jakarta Sans + Amiri Quran via `next/font/google` | Amiri Quran berlisensi OFL dan mendukung Rasm Utsmani; self-hosted otomatis saat build | KFGQPC (lisensi perlu dicek) |
| D7 | Script tema pre-paint di `<head>` dibangun dari `resolveTheme.toString()` | Logika tema tidak terduplikasi; mencegah flash terang jam 3 pagi | Script ditulis manual (rawan beda dengan logika TS) |
| D8 | "Gelap saat malam" sementara jendela 18.00-05.00 | Engine jadwal salat belum ada; ganti ke Maghrib-Subuh setelah S2/S7 | - |
| D9 | Theme toggle pakai radio native | Keyboard panah + screen reader jalan tanpa kode tambahan | `role=radio` custom |
| D10 | ProgressBar animasi `transform: scaleX`, bukan width | Aturan Hallmark Floor + performa | - |
| D11 | Uji kontras otomatis membaca `globals.css` | Token tidak bisa diam-diam turun di bawah AA | Daftar warna terpisah di TS (bisa drift) |
| D12 | `@playwright/test` 1.63.0 dipin | Cocok dengan Chromium terpasang di `/opt/pw-browsers` | Versi terbaru (browser tidak cocok) |
| D13 | Ikon PWA placeholder: bulan sabit krem di atas Deep Forest (`scripts/generate-icons.mjs`) | Bukan logo NgajiGaes palsu; diganti saat owner kirim logo | - |

## U1b (2026-11-12)
| # | Keputusan | Alasan | Alternatif ditolak |
|---|-----------|--------|--------------------|
| U1b-1 | Repository teks `src/data/quran` memuat dataset lewat `import()` di chunk terpisah | Dataset 86 KB tidak ikut layar lain | Impor statis |
| U1b-2 | `content/quran/basmalah.json` dari baris `1\|1\|` sumber, dijaga test byte-per-byte | Reader butuh 1:1 untuk aturan pemisahan; `uthmani.json` hanya 6 bacaan; guard melarang aksara Arab di `src/` | Konstanta di kode; mengubah `uthmani.json` |
| U1b-3 | Hook `__TT_QURAN_FIXTURE__` dihapus | Teks asli sudah ada | Dipertahankan |
| U1b-4 | Awalan ayat 1 yang tidak identik tidak dilepas | Aturan brief | Menebak potongan |
| U1b-5 | `PrayerTime.verification` dan `attribution` opsional di kontrak | Tambahan, tidak mematahkan T3b | Hardcode di UI |
| U1b-6 | "Terverifikasi" hanya jika `verification === "verified"`; atribusi tidak tampil untuk demo dan manual | Aturan brief dan CLAUDE.md | Atribusi Kemenag di data demo |


## X-part1: email + password, aktivasi (2026-11-13)
Detail dan bukti: `docs/sessions/X-part1.md`. Semua angka berlabel PROVISIONAL sampai owner menyetujui.
| # | Keputusan | Alasan | Alternatif ditolak |
|---|-----------|--------|--------------------|
| X4-1 | Akun hanya lahir di `app_private.activate_account()` (SQL, `security definer`) setelah email DAN HP cocok dengan order `scalev_api` berstatus `paid`/`settled`, entitlement `active` dan `user_id` null, order tidak diblokir CS | Satu pintu, atomik, teruji paralel. Role backend tidak punya tulis langsung ke `auth.users` | Insert dari kode TypeScript (dua langkah, bisa balapan) |
| X4-2 | Satu jawaban gagal `ACTIVATION_FAILED` untuk email asing, HP salah, belum lunas, belum terverifikasi, order tanpa HP, akun sudah ada, order diblokir | Tidak ada oracle "email + HP cocok" (CLAUDE.md: respons generik) | Pesan berbeda per sebab |
| X4-3 | Password di-hash dulu, baru DB ditanya | Waktu gagal sama dengan sukses; login memakai hash tiruan untuk akun yang tidak ada | Cek DB dulu |
| X4-4 | scrypt `N=2^15, r=8, p=3`, `maxmem` 64 MiB, string PHC dengan parameter di dalamnya; `needsRehash` mengganti hash lama setelah login benar | Sumber: OWASP Password Storage Cheat Sheet (setelan setara untuk scrypt), batas memori Node `crypto.scrypt` dicek 13 Nov 2026. PROVISIONAL: ukur di VPS nyata | argon2id (dependency biner) |
| X4-5 | HP disimpan sebagai HMAC(pepper, `phone:` + nomor ternormalisasi `62...`). Fungsi tunggal `hashPhone` di `src/server/auth/crypto.ts` | Worker Scalev memakai fungsi yang sama. Nomor asli tidak masuk DB atau log | Simpan nomor |
| X4-6 | Batas gagal login dihitung per email (10/15 mnt) hanya untuk GAGAL; per IP (30/10 mnt) menghitung semua percobaan | Login sukses tidak mengunci pemilik | Hitung semua |
| X4-7 | Aktivasi dan reset mandiri: gagal 5/15 mnt per email, 5/15 mnt per HP, 20/jam per IP, 3/jam per pasangan (email, HP). 429 satu pesan | Rencana §8.3 | - |
| X4-8 | `callerOf(req, hops)` mengambil entri `hops` dari AKHIR `X-Forwarded-For`; `TRUSTED_PROXY_HOPS` wajib di produksi, 0 = abaikan header | G12 di rencana: entri pertama bisa dipalsukan | Entri pertama |
| X4-9 | Reset mandiri (`/auth/reset-password`) mencabut semua perangkat dan TIDAK membuka sesi | Rencana §8.2 | Auto-login |
| X4-10 | Token reset admin: HMAC(pepper, `pwtoken:` + token), sekali pakai lewat satu `UPDATE ... RETURNING`, kedaluwarsa 60 menit (`app_settings.reset_token_minutes`, PROV), token baru mencabut yang lama, alasan wajib + `admin_audit_logs`. Terikat ke `user_id` (bukan email) | Rencana §8.9 | Terikat email |
| X4-11 | `/auth/set-password` (token admin) membuka sesi. Halaman `/reset` membaca token dari fragmen, menghapusnya dari address bar, dan hanya tombol yang mengirimnya | Pemindai tautan hanya melakukan GET | Auto-konsumsi saat halaman dibuka |
| X4-12 | Tidak ada `/auth/password-link` dan `/auth/password-token/check` | Rencana §8.3 (tanpa SMTP) | - |
| X4-13 | Kebijakan password: min 10, maks 128 karakter, NFKC, tanpa aturan komposisi, daftar kecil password umum di dalam kode, tolak sama dengan email / nomor HP | Rencana §3.7 | Aturan huruf besar/angka |
| X4-14 | `ACTIVATION_PHONE_REQUIRED` hanya boleh `true` atau kosong; nilai lain membuat server gagal start | Mematikan cek HP berarti menghapus bukti kepemilikan | Flag yang bisa dimatikan di non-produksi |
| X4-15 | Mode mock: satu password demo (`demo-password-aman`) di `fixtures/auth.ts`, hash SHA-256 khusus demo, order demo dengan HP demo, dev panel menampilkannya berlabel "Data demo". State mock versi lama (OTP) dibuang saat dibaca | Pengecualian aturan (a) untuk demo saja (Q9, default PROV) | Tanpa mode demo |
| X4-16 | `entitlement_type` boleh `staff_comp` (tanpa order, `granted_by`); fungsi level BELUM bypass untuk staff, agregat BELUM mengecualikan staff | Itu lingkup X8 (rencana §8.6) | Mengerjakan semuanya di sini |
| X4-17 | Fungsi SQL pembuat akun dan token admin `security definer` | Role backend tidak diberi tulis `auth.users` | Grant tulis ke `auth.users` |

## 2026-11-13: perubahan mayor owner (Munaja)
- Nama app "Munaja". Niat di salat sesi tahajud saja. Periode khatam 30 hari sejak mulai. Riwayat level hanya untuk level yang sudah dicapai. Detail: `docs/CHANGE-2026-11-13-MUNAJA.md`.
- Default orchestrator (PROVISIONAL): sisa 4N halaman masuk hari terakhir; bacaan di sesi tidak dihitung ke khatam; kota terdekat dihitung di perangkat, GPS tidak dikirim.
## X2-A: job runner selesai, intake dan worker Scalev (2026-11-13)
Detail dan bukti: `docs/sessions/X2-A.md`. Semua angka berlabel PROVISIONAL sampai owner menyetujui. Bentuk respons Scalev yang dipakai kode dan fixture berlabel NEEDS_VERIFICATION (ditulis dari dokumen dev.scalev.com, belum dari panggilan nyata).
| # | Keputusan | Alasan | Alternatif ditolak |
|---|-----------|--------|--------------------|
| J1 | `housekeeping()` menghapus `auth_tokens` (kedaluwarsa, terpakai, atau dicabut) 7 hari setelah akhir hidupnya, dan `auth_events` setelah `auth_events_retention_days` (setting PROV, 90) | Migration auth tidak menyebut retensi; angka token dari rencana §3.2, angka event = default 90 hari brief. Tabel `login_otps` tidak disentuh lagi | Tebakan lain |
| J2 | Handler `send_email` = no-op: baris outbox jadi `failed` dengan `last_error='EMAIL_NOT_CONFIGURED'`, job selesai (`done`) | Rencana §8.9. Job tidak mati "no handler", baris tidak pernah tampak terkirim. SMTP nanti cukup mengganti handler | Job `failed` (menumpuk di admin_health) |
| J3 | Job berulang Scalev dibuat tick: `scalev_sweep` tiap 10 menit, `scalev_sweep_deep` dan `scalev_purge` tiap 24 jam (mengambang, tidak dipaku 03.00 WIB) | `enqueueRecurring` per jenis job, tidak punya jam tetap. Self-heal (hanya DB) harus jalan walau Scalev belum dikonfigurasi, jadi sweep selalu dibuat; polling di dalamnya mengikuti konfigurasi | Sweep hanya bila API key ada |
| X3-1 | Hanya `payment.received`, `payment.failed`, `order.status_changed`, `order.deleted` memicu job. `order.created` dan lainnya disimpan `ignored` | Keputusan akses selalu dari GET order (§4.3, §8.9 menghapus cadangan email dari snapshot `order.created`). Memproses `order.created` menambah satu GET dan siklus tunggu 3 hari untuk tiap order belum bayar | Snapshot `order.created` |
| X3-2 | `business.test_event` dibalas 200 tanpa menulis apa pun; secret atau `SCALEV_PAYLOAD_KEY` kosong dibalas 503 sebelum membaca body | Tes simpan di dashboard Scalev harus gagal jelas, bukan pura-pura sukses (§1 butir 12) | 200 tanpa konfigurasi |
| X3-3 | Tanda tangan dicek atas byte mentah sebelum JSON di-parse. Salah = 401 tanpa membuka DB. Log hanya alasan, ukuran, dan hash IP berkunci. Body sah tetapi bentuk salah = 400, tanpa tulisan | AUTH-02. Penyerang tanpa secret tidak bisa memicu kerja DB | Parse dulu |
| X3-4 | Kolom polos `payload_minimal` hanya berisi `event`, nomor order tampil, `payment_status`, `status`. Payload asli AES-256-GCM: `0x01 \| nonce 12 \| tag 16 \| cipher`, AAD = `scalev:<unique_id>`, kunci dari `SCALEV_PAYLOAD_KEY` | Payload di baris lain tidak bisa dibuka (AAD). Hapus akun (T3c) mengganti email di `payload_minimal`; di sini memang tidak ada email | Simpan polos |
| X3-5 | Job `scalev_event` `max_attempts` 20, `dedupe_key = scalev:evt:<unique_id>` | Percobaan ulang panjang diatur handler sendiri; batas ini hanya untuk crash | Default 5 |
| X6-1 | `SCALEV_ALLOWED_VARIANT_IDS` berisi id angka (`orderlines[].variant`, hanya digit) dan/atau SKU (`variant_sku`, abaikan huruf besar). Tanpa resolver jaringan, tanpa tabel `scalev_variant_map` | GET order tidak punya `variant_unique_id` (rencana §1 butir 3a). Kedua kunci ada di respons yang sama | Resolver lewat endpoint varian (scope tambahan) |
| X6-2 | Urutan cek: varian, batal/closed, spam, email, HP, nominal. Order varian asing disimpan TANPA email, HP, dan nama | Order produk lain di toko yang sama tidak boleh membawa data pembeli ke DB kita. Label alasan juga tidak bergantung pada data pembeli | Urutan rencana (batal dulu) |
| X6-3 | Email dan HP hanya dari hasil GET: `customer.email` lalu `destination_address.email`; `customer.phone` lalu `destination_address.phone`. HP dinormalisasi `08…`/`62…`/`+62…`/`8…` menjadi `62…` lalu `hashPhone` (satu fungsi, `src/server/auth/crypto.ts`). Nomor yang tidak bisa dinormalisasi dilewati, bila tak ada yang lolos = `missing_phone` | Brief + X-part1. Format HP nyata belum dikonfirmasi Hermes (Q14) | Fungsi hash kedua |
| X6-4 | Tidak ada nominal `net_revenue` saat `SCALEV_MIN_AMOUNT_IDR` diset = dianggap di bawah batas (karantina) | Sisi aman. Tanpa batas, tidak ada cek nominal (harga belum final, Q4) | Lolos bila kosong |
| X6-5 | Order belum lunas: hanya `payment.received` yang menunggu (1, 5, 15, 60 menit, lalu tiap 6 jam, sampai 3 hari). Event lain (`payment.failed`, `order.status_changed`, `order.deleted`) menyegarkan sekali. Belum lunas dan sudah batal = ditutup seketika | Menunggu 3 hari untuk tiap order belum bayar hanya membuat bising. Jadwal dari PRD §20.3 | Semua event menunggu |
| X6-6 | Gangguan sementara Scalev (5xx, timeout, 429, respons tak terbaca) = `JobError` retryable dengan backoff runner; 429 memakai `X-Ratelimit-Reset`/`Retry-After` (detik atau epoch, maks 1 jam). 404: tiga kali lihat (30 dtk, 60 dtk), lalu event `failed`. 401/403: event dan job `failed`, tidak diulang | Brief, rencana §4.3, SCALEV-12 | Retry semua |
| X6-7 | Refund/batal/hilang setelah entitlement ada: `purchase_orders.quarantine_reason='post_payment_change'`, akses TIDAK dicabut, bukti email/HP tidak ditimpa. Lunas lagi menghapus tanda | Q7 PROV | Cabut otomatis |
| X6-8 | Order dengan `verified_via='admin_manual'` tidak ditimpa oleh pembacaan Scalev | Keputusan admin (T7/X8) menang | Timpa |
| X6-9 | `scalev_apply_order` menolak membuat entitlement bila tidak lunas, tanpa email, atau tanpa bukti HP (pembatas kedua di DB). Advisory lock per order, satu transaksi untuk order + item + entitlement + status event | "Lunas lalu settled = satu entitlement" teruji paralel | Cek hanya di TypeScript |
| X6-10 | Sweeper: self-heal (event `received` > 5 menit atau menunggu tanpa job diberi job; > 3 hari = `failed`), lalu polling `paid` dan `settled` terbaru dulu, jendela 72 jam (dalam sehari 14 hari), maksimal 8 halaman per status. Order yang semua baris varian-nya asing dilewati tanpa GET. Event sintetis `poll:<order_id>:<status>` lewat jalur yang sama dengan webhook | Daftar order memuat semua produk toko. Bentuk respons daftar NEEDS_VERIFICATION: respons tak terbaca = hasil `NEEDS_VERIFICATION`, job tetap `done`; `SCALEV_SWEEP_ENABLED=false` mematikan polling | Berhenti di order pertama yang dikenal |
| X6-11 | Purge: `payload_encrypted` dikosongkan setelah `scalev_payload_retention_days` (setting PROV, 90); baris tetap | PRD §24.4 | Hapus baris |

## X2-B: admin T7 + X8 (2026-11-13)
| # | Keputusan | Alasan | Alternatif ditolak |
|---|-----------|--------|--------------------|
| X8-1 | Nomor HP TIDAK pernah ditampilkan, termasuk ke super_admin dan CS. Admin hanya bisa MENGECEK nomor yang disebut pembeli (cocok atau tidak, dibatasi 5 per 15 menit per order, setiap cek masuk audit tanpa nomornya). PROVISIONAL, Q-X2B-1 | Yang tersimpan hanya HMAC (X4-5); nomor asli tidak ada di DB. Menampilkan HP berarti menyimpan nomor asli terenkripsi, keputusan owner. Brief minta "tampil hanya dua peran + audit"; ini cara terdekat yang bisa dipenuhi tanpa menyimpan nomor | Mendekripsi payload webhook (bentuk payload belum terbukti, NEEDS_VERIFICATION); kolom `last4` (X6 tidak mengisinya) |
| X8-2 | `admin_order_approve`: order tanpa akses aktif (karantina, belum lunas, `pending_verification`) jadi `verified_via='admin_manual'` + entitlement `active`, referensi persetujuan wajib, `quarantine_reason` dikosongkan (nilai lama ada di audit `before`). Tidak membuka entitlement `suspended`/`revoked` (pakai endpoint status). Order tanpa email ditolak | Worker X6 melewati order `admin_manual`, jadi keputusan admin tidak tertimpa | Membuat entitlement tanpa mengubah `verified_via` (worker bisa menimpanya) |
| X8-3 | `activate_account` didefinisikan ulang di migration X8: `admin_manual` dianggap terverifikasi tanpa cek `payment_status`. Cocok email + HP dan `activation_blocked` tetap berlaku | Tanpa ini order yang disetujui manual tidak bisa diaktivasi pembeli (fungsi X4 hanya menerima `scalev_api`) | Biarkan order manual tidak bisa aktivasi |
| X8-4 | Order disetujui tanpa HP di order: akses aktif tapi pembeli tidak bisa aktivasi sendiri. Halaman order memberi peringatan. Jalur CS (buat akun untuk pembeli + tautan reset) belum dibuat. PROVISIONAL, Q-X2B-2 | Membuat akun atas nama pembeli melonggarkan aturan bukti email + HP; keputusan owner | Membuat jalur itu sekarang |
| X8-5 | Staf: level terbuka semua tanpa baris `user_level_state` palsu. `level_for_session` mengembalikan 3 untuk staf aktif; layar level menampilkan semua `unlocked`. Progres tetap tercatat apa adanya. PROVISIONAL, Q-X2B-3 | Aturan "jangan reset/kunci ulang level" aman; satu perubahan di tiga fungsi level | Staf memilih level (butuh UI + kolom baru) |
| X8-6 | Staf dikecualikan dari agregat (`admin_aggregates`) pada status apa pun (staf yang dicabut tetap bukan pembeli) | Aturan CLAUDE.md | Hanya staf aktif |
| X8-7 | Buat staf hanya `super_admin`. Email yang sudah punya akun atau entitlement ditolak (409), agar tidak merebut order yang menunggu pembelinya | Akun staf bypass level; hak sebesar itu tidak untuk CS | CS boleh |
| X8-8 | Tautan reset: `admin_reset_precheck` (peran, alasan, 10 per jam per admin, pembeli tanpa akun ditolak 404, hanya `super_admin` yang boleh mereset akun yang punya peran admin) lalu `issueAdminResetToken` (X4: hash, 60 menit, audit). Tautan hanya ada di respons itu, tampil sekali di UI (state komponen, tanpa storage). Basis tautan: `APP_BASE_URL` bila diisi, kalau tidak origin request | Support tidak boleh mengambil alih admin; token mentah tidak pernah disimpan | Satu fungsi SQL (butuh token hash dari TS, tetap dua langkah) |
| X8-9 | `resend-email` dan `admin_queue_email` dihapus; transfer email tidak mengantrekan email | Tanpa SMTP, `send_email` hanya menandai `failed` (X2-A). Tombol yang pasti gagal menyesatkan | Dibiarkan menumpuk baris `failed` |
| X8-10 | Bootstrap `super_admin` pertama: fungsi SQL `admin_bootstrap_grant` (security definer, karena `service_role` tidak boleh menulis `auth.users`) + `scripts/admin-grant-role.ts`. Akun dibuat tanpa password; tautan `--print-link` hanya ke TTY, tidak ke log; super_admin kedua butuh `--allow-another-super-admin` | Aturan: tanpa password bawaan | Script mengisi password |
| X8-11 | UI `/admin` selalu memakai `/api/v1/admin` dan login HTTP, tidak bergantung `NEXT_PUBLIC_DATA_MODE`; tanpa mock admin. Halaman `force-dynamic`, `noindex` | Admin tidak punya mode demo; data nyata saja | Mock admin |
| X8-12 | MFA = TOTP sendiri (T7-1), tanpa library QR: layar menampilkan kunci base32 dan tautan `otpauth://` | Tanpa dependency baru | Library QR |
