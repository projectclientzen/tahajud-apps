# Brief T4b (Agen C, Sonnet, effort medium): adapter jadwal shalat EQuran.id

Konteks: owner mengusulkan https://equran.id/api/v2/shalat. Orchestrator sudah memeriksa (12 Nov 2026), hasilnya di `docs/PROVIDER-EQURAN.md`. Adapter ini ditambahkan di belakang interface `PrayerTimeProvider` yang sudah ada (T4). Belum menjadi keputusan produksi: owner masih perlu izin pemakaian komersial dari EQuran.id.

## Kepemilikan file
Tulis: `src/server/prayer/**`, `tests/unit/server/prayer-*`, `content/regions/**` (snapshot daftar wilayah), `scripts/import-regions.ts`, `docs/sessions/T4b.md`. Jangan sentuh file lain. Environment `tahajud-apps` mengizinkan `equran.id`.

## Tugas
1. `EquranProvider` (server-side saja, tidak pernah dipanggil dari browser):
   - `POST https://equran.id/api/v2/shalat` body `{provinsi, kabkota, bulan, tahun}`; daftar wilayah dari `GET /api/v2/shalat/provinsi` dan `POST /api/v2/shalat/kabkota`.
   - Timeout 8 detik, maksimal 2 retry dengan backoff untuk 5xx/429/timeout, tanpa retry untuk 4xx lain.
   - Header `User-Agent` generik (nama app + versi), tanpa data user.
2. Validasi respons dengan Zod (strict) lalu validasi isi. Tolak seluruh bulan jika salah satu gagal:
   - `code === 200`, provinsi/kabkota/bulan/tahun sama dengan permintaan, jumlah hari = jumlah hari bulan itu, `tanggal_lengkap` berurutan tanpa celah.
   - Format jam `HH:mm`; urutan `imsak < subuh < terbit < dzuhur < ashar < maghrib < isya`.
   - Rentang wajar: subuh 03:30-05:15, maghrib 17:15-19:00 waktu lokal.
   - Data yang ditolak dicatat (log terstruktur) dan dianggap provider gagal → pakai cache valid / jadwal manual (PRD §14.5).
3. Cek silang (defense in depth): hitung Subuh dan Maghrib lokal dengan library `adhan` (parameter Kemenag: Fajr 20°, Isha 18°, ihtiyath sesuai dokumentasi; catat sumber parameter). Jika selisih > 6 menit pada hari mana pun, tandai bulan itu `needs_review` dan jangan tampilkan sebagai terverifikasi. Ambang 6 menit = PROV.
4. Timezone: respons tidak berisi zona waktu. Buat peta provinsi → `Asia/Jakarta | Asia/Makassar | Asia/Jayapura` di `content/regions/` dengan test untuk 34 provinsi dalam daftar API. Konversi `HH:mm` lokal ke UTC memakai peta ini.
5. Wilayah: `scripts/import-regions.ts` menyimpan snapshot provinsi + kab/kota dari API ke `content/regions/equran-regions.json` (dengan tanggal ambil). Catat bahwa API memuat 34 provinsi (provinsi pemekaran Papua 2022 tidak ada) sebagai keterbatasan.
6. Metadata sumber: `provider: "equran"`, atribusi "Bimas Islam Kemenag RI via EQuran.id", `fetched_at`, `valid_until` akhir bulan. Cache per region per bulan (sesuai `Cache-Control` 30 hari).
7. Test: semua aturan validasi (kasus valid dan 8+ kasus rusak), retry/timeout dengan server palsu, PRAYER-01, PRAYER-02 versi EQuran, peta timezone. Test unit TIDAK boleh memanggil equran.id sungguhan; satu test integrasi opsional di balik env `EQURAN_LIVE_TEST=1`.

## Acceptance criteria
`pnpm typecheck && pnpm lint && pnpm test && pnpm audit --prod` lolos; tidak ada panggilan jaringan di test default; laporan `docs/sessions/T4b.md` berisi output asli, keputusan, dan perbandingan Subuh/Maghrib EQuran vs `adhan` untuk 3 kota (Jakarta, Makassar, Jayapura) bulan ini.
