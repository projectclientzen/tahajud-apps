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

## U2: Munaja, Al-Qur'an lengkap, khatam, riwayat level, niat, lokasi otomatis (2026-11-13)
Detail dan bukti: `docs/sessions/U2.md`. Semua yang berlabel PROVISIONAL menunggu owner.
| # | Keputusan | Alasan | Alternatif ditolak |
|---|-----------|--------|--------------------|
| U2-1 | Kota terdekat dihitung dari `content/regions/crosscheck-coordinates.json` (502 wilayah, turunan Wikidata), bukan langsung `wikidata-coordinates.json` | File mentah Wikidata tidak punya nama EQuran, jadi tidak bisa dipetakan ke id wilayah. File crosscheck sudah dicocokkan ke 517 nama EQuran (15 tanpa koordinat, sama dengan angka di spesifikasi) dan nama 517 wilayah itu unik | Mencocokkan nama sendiri di klien |
| U2-2 | Teks 114 surah = 114 berkas statis `public/quran/surah-NNN.json` (1,7 MB total), dimuat per surah lewat `fetch`. Service worker cache-first hanya untuk `/quran/*.json` di cache `tahajud-quran-v1`; `/api/` tetap tidak disentuh | Ringan untuk PWA, bisa dibaca offline setelah dibuka. Naikkan `QURAN_VERSION` di `public/sw.js` bila berkas berubah | Satu chunk 1,4 MB di bundel |
| U2-3 | Metadata halaman/juz dari `quran-data.js` Tanzil (SHA-256 `9e9930c5...4ac4`), dibaca dengan regex, file tidak pernah dieksekusi. Hanya nama latin surah yang dipakai | File luar tidak dijalankan. Nama Arab tidak dibutuhkan | `eval` / `new Function` |
| U2-4 | Khatam PROVISIONAL: sisa 4N halaman dibagi rata ke lima waktu salat hari ke-30 (waktu awal mengambil sisa pembagian, hari ke-30 = 24N halaman) | Spesifikasi hanya bilang "ke hari terakhir". Membagi rata menghindari satu waktu salat memikul 8N halaman | Semua sisa ke Isya hari ke-30 |
| U2-5 | Halaman yang dikreditkan disimpan per centang (`khatam_reads.pages`). Ganti N di tengah periode: halaman terbaca tetap, total dan rencana ikut N baru. Ganti N hanya selama periode berjalan | Tanpa reset, tanpa menulis ulang riwayat | Hitung ulang semua centang dengan N baru |
| U2-6 | "Terakhir dibaca sampai halaman X" memilih nilai `k*604+X` terdekat dari posisi sekarang (seri ke depan), dengan `k >= 0`. Mengulang tanda yang sama tidak mengubah apa pun | Aman diulang dari antrean offline, bisa mundur untuk koreksi, bisa maju melewati halaman 604 ke khatam berikutnya. Tes DB menemukan bug `k = -1` (halaman 604 dari posisi 0 jadi 0); sudah diperbaiki di TS dan SQL | Posisi absolut tanpa aturan terdekat |
| U2-7 | Server menyimpan keadaan mentah (target, centang, adjustment) dan jam server; tampilan dihitung `src/domain/khatam` di klien. Aturan penjatahan halaman dan posisi juga ditulis di SQL dan dicek sama persis dengan domain (`tests/db/khatam-rules.test.ts`) | Satu implementasi tampilan untuk mock dan live; kebenaran penjatahan tetap di server | Duplikasi tampilan di SQL |
| U2-8 | Centang untuk hari 1 sampai hari ini diterima (antrean offline terlambat tetap masuk), hari depan ditolak. Target baru hanya setelah target lama selesai atau lewat 30 hari. Hari dihitung dari zona yang tersimpan di target | Tidak ada pengunci ulang, tidak ada reset. WIB/WITA/WIT diuji | Menolak centang hari lalu |
| U2-9 | Enam bacaan malam tetap ada, dilipat di bawah daftar Al-Qur'an ("Enam bacaan malam"). Rute `/quran/[surah]` tidak berubah | Sesi malam belum punya tautan ke bacaan itu, jadi tanpa ini ia tidak terjangkau. Bacaan di sesi tidak dihitung ke khatam | Menghapus daftar |
| U2-10 | Profil: ikon di header SETIAP halaman (`PageHeader`) dan tautan di bawah sidebar desktop. Laporan masuk bottom nav, ikon laporan di header dashboard dihapus | M4 | Profil tetap di bottom nav |
| U2-11 | Riwayat level: `/worship/level/N`. Level terkunci tidak menampilkan isi apa pun, juga lewat URL. Rekap dari riwayat sesi level itu. `LevelAmalan` dipakai bersama halaman Bantuan | M5, satu renderer teks Arab | Pratinjau level terkunci |
| U2-12 | Niat: tersedia bila Arab ATAU Latin terisi; terjemahan opsional; badge tinjauan hanya bila ada teks dan `review_status != "published"`. Teks dilewatkan tanpa trim | M6, owner mungkin mengisi bertahap | Wajib Arab dan Latin sekaligus |
| U2-13 | Lokasi otomatis: `MAX_MATCH_KM = 300` (PROVISIONAL) sebagai batas pencocokan; di luar kotak Indonesia ditolak; titik GPS hanya hidup di dalam satu fungsi dan tidak dikembalikan, disimpan, atau dikirim (diuji di e2e: jaringan, localStorage, IndexedDB). `Region.place` opsional di kontrak untuk memetakan nama kota | M3 | Mengirim koordinat ke server |
| U2-14 | Onboarding tidak lagi punya jadwal manual. Jam Subuh manual tetap ada di Pengaturan | M3 | Menghapus di Pengaturan juga |
