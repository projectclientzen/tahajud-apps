# Sesi T4b (Agen C): adapter jadwal shalat EQuran.id

Branch: `claude/t4b-equran-adapter` (dari origin/main `4fb8ae2`) · Tanggal: 2026-11-12
Status provider: PROV. Belum izin komersial dari EQuran.id (blocker produksi, lihat `docs/PROVIDER-EQURAN.md`).

## Yang dikerjakan
| Item | Status |
|------|--------|
| `EquranProvider` (`src/server/prayer/equran-provider.ts`) | REAL. POST `/api/v2/shalat`, timeout 8 dtk, 2 retry (5xx/429/timeout/network), tanpa retry 4xx lain, UA `tahajud-tracker/0.1` |
| Validasi Zod strict + isi (`equran-schema.ts`) | REAL. Satu cacat = seluruh bulan ditolak, dicatat log terstruktur, dianggap provider gagal (fallback cache lewat `PrayerService`) |
| Cek silang adhan (`crosscheck.ts`) | REAL. Selisih > 6 menit di hari mana pun = `verification: "needs_review"` |
| Peta provinsi ke zona waktu (`content/regions/province-timezones.json`) | REAL, 34 provinsi, dites terhadap snapshot API |
| Snapshot wilayah (`scripts/import-regions.ts`, `content/regions/equran-regions.json`) | REAL: 34 provinsi, 517 kab/kota, tanggal ambil di file |
| Koordinat cek silang (`content/regions/crosscheck-coordinates.json`) | PROVISIONAL, hanya 3 kota (lihat Keputusan 3) |
| Test (`tests/unit/server/prayer-equran.test.ts`) | 35 test jalan, 3 test live dilewati (opt-in) |

`PrayerDay` mendapat dua field opsional: `verification` (`verified` | `needs_review` | `unchecked`) dan `attribution` ("Bimas Islam Kemenag RI via EQuran.id"). Hanya `verified` boleh tampil sebagai jadwal terverifikasi.
regionId untuk EQuran = `"<provinsi>::<kabkota>"` (`makeEquranRegionId`), nama persis seperti di API.

## Keputusan teknis
1. Parameter adhan: `CalculationMethod.Singapore()` (Fajr 20°, Isha 18°). `METHODS.md` adhan menyebutnya dipakai untuk Indonesia. Ihtiyath Kemenag (sekitar 2 menit) tidak diterapkan di adhan; ambang 6 menit (PROV) menampungnya. Parameter adhan untuk "Kemenag" tidak ada preset resmi, jadi ini asumsi yang terdokumentasi, bukan verifikasi.
2. adhan membaca tahun/bulan/hari dari `Date` di zona proses, jadi tanggal dibuat dengan `new Date(y, m-1, d)` agar hasil tidak bergantung TZ server.
3. API tidak punya koordinat. Cek silang butuh lat/lon per kab/kota. Saya tidak mengarang 517 koordinat. Hanya 3 kota (Jakarta, Makassar, Jayapura) diisi dengan koordinat pusat kota perkiraan 2 desimal, ditulis dari pengetahuan umum, bukan dataset terverifikasi, ditandai `provisional`. Wilayah lain = `verification: "unchecked"` (log `crosscheck_skipped_no_coordinates`). Artinya di produksi hampir semua wilayah belum "terverifikasi" sampai owner menyediakan sumber koordinat.
4. `validUntil` = 23:59 lokal pada hari terakhir bulan itu (cache per region per bulan, `PrayerService` yang sudah ada).
5. Zod strict: field baru dari API membuat bulan ditolak (sengaja, sesuai brief). Konsekuensi: perubahan format sepihak dari EQuran.id memutus provider sampai skema diperbarui.
6. Dependency baru: `adhan@4.4.6` (cek silang). `pnpm audit --prod` bersih. `package.json` juga dapat script `import:regions` (file di luar daftar scope brief, tetapi diperlukan untuk dua perubahan itu).
7. Test default tidak memanggil jaringan: server HTTP palsu di 127.0.0.1. Test live hanya jalan dengan `EQURAN_LIVE_TEST=1`.

## Perbandingan Subuh/Maghrib EQuran vs adhan (live, November 2026, jam lokal)
Selisih = EQuran minus adhan (Singapore 20°/18°). Koordinat: lihat Keputusan 3.
| Kota | Tanggal | Subuh EQuran | Subuh adhan | Selisih | Maghrib EQuran | Maghrib adhan | Selisih |
|------|---------|--------------|-------------|---------|----------------|---------------|---------|
| Jakarta (WIB) | 1 Nov | 04:09 | 04:07 | +2 m | 17:49 | 17:47 | +2 m |
| | 12 Nov | 04:06 | 04:04 | +2 m | 17:51 | 17:49 | +2 m |
| | 30 Nov | 04:06 | 04:04 | +2 m | 17:58 | 17:55 | +3 m |
| Makassar (WITA) | 1 Nov | 04:20 | 04:18 | +2 m | 17:58 | 17:55 | +3 m |
| | 12 Nov | 04:17 | 04:15 | +2 m | 18:00 | 17:57 | +3 m |
| | 30 Nov | 04:18 | 04:16 | +2 m | 18:06 | 18:03 | +3 m |
| Jayapura (WIT) | 1 Nov | 03:58 | 03:56 | +2 m | 17:30 | 17:27 | +3 m |
| | 12 Nov | 03:56 | 03:54 | +2 m | 17:31 | 17:28 | +3 m |
| | 30 Nov | 03:57 | 03:55 | +2 m | 17:37 | 17:34 | +3 m |

Selisih maksimum 30 hari: Jakarta Subuh 3,0 / Maghrib 3,0; Makassar 3,0 / 3,0; Jayapura 3,0 / 3,0 menit. Ketiganya `verified` (ambang 6 menit). Pola konsisten +2 sampai +3 menit cocok dengan ihtiyath, tetapi kecocokan ini membuktikan EQuran selaras dengan hitungan astronomis, bukan bahwa angkanya sama dengan data resmi Kemenag [Medium confidence: tidak ada pembanding resmi di sesi ini].

## Catatan lingkungan
- fetch bawaan Node tidak memakai proxy container. `pnpm import:regions` dan test live butuh `NODE_USE_ENV_PROXY=1` (dan `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`). Berlaku juga untuk `pnpm import:quran --refresh` dari T4. Tidak ada perubahan kode untuk ini.
- Header cache EQuran: `public, max-age=2592000, stale-while-revalidate=604800` (diperiksa langsung).

## Output test asli
```
pnpm typecheck    -> tsc --noEmit, tanpa error
pnpm lint         -> eslint, tanpa warning
pnpm test         -> Test Files 22 passed (22), Tests 397 passed | 3 skipped (400)
pnpm audit --prod -> No known vulnerabilities found
EQURAN_LIVE_TEST=1 ... -t live -> 3 passed (Jakarta, Makassar, Jayapura), tabel di atas
```
E2E tidak dijalankan ulang (tidak ada perubahan UI).

## Skill
Tidak ada skill yang dimuat lewat tool.

## Sisa pekerjaan dan pertanyaan untuk owner
1. Izin tertulis dari EQuran.id untuk app berbayar (blocker produksi).
2. Sumber koordinat untuk 517 kab/kota agar cek silang berlaku di semua wilayah (mis. dataset resmi BPS/Kemendagri; butuh persetujuan owner sebelum diimpor).
3. Pilih provider produksi: EQuran (PROV) atau SIHAT langsung bila izin tersedia. `SihatProvider` tetap stub.
4. Job server (T6) yang memanggil `PrayerService` sebulan sekali per wilayah, dan UI yang membaca `verification` + `attribution`.
