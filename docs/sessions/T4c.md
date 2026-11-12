# Sesi T4c (Agen C): koordinat kab/kota dari Wikidata

Branch: `claude/t4c-wikidata-coordinates` (dari main `0e5cfd2`) · Tanggal: 2026-11-12

## Hasil pencocokan (517 kab/kota EQuran)
| Status | Jumlah |
|--------|--------|
| Cocok otomatis (nama + kelas kab/kota, unik) | 501 |
| Cocok lewat override manual (Kota Jakarta, Q3630) | 1 |
| Ambigu | 0 |
| Tidak cocok (`unmatched`) | 15 |

Total cocok 502. 26 kab/kota Papua dan Papua Barat cocok berdasarkan nama tetapi provinsi Wikidata berbeda (pemekaran 2022, wajar), ditandai `province_mismatch: true`.
Data mentah: 508 item Wikidata dipakai (423 kab + 93 kota ber-P625, dikurangi 8 yang dilewati: 7 tanpa P625, 1 dengan beberapa koordinat berbeda yaitu Q14168; tidak dipilih dengan tebakan). Daftar lengkap ada di `wikidata-coordinates.json` bagian `skipped`.

Properti: P625 koordinat, P2588 kode Kemendagri (deskripsi Wikidata: "official identifier ... issued by the Ministry of Home Affairs"), P1588 kode BPS. Kedua kode disimpan di data mentah. Kode tidak dipakai untuk mencocokkan karena daftar EQuran tidak membawa kode.

## Tidak cocok (tidak diisi tebakan, `verification: "unchecked"`)
| Provinsi | Kab/kota EQuran | Alasan |
|----------|-----------------|--------|
| DKI Jakarta | Kab. Kepulauan Seribu | no Wikidata item with this name and class and a coordinate |
| Gorontalo | Kab. Pahuwato | no Wikidata item with this name and class and a coordinate |
| Jawa Barat | Kab. Ciamis | no Wikidata item with this name and class and a coordinate |
| Kalimantan Barat | Kota Pontianak | no Wikidata item with this name and class and a coordinate |
| Kepulauan Riau | Pekajang Kab. Lingga | name is not a regency/city name (sub-area label) |
| Kepulauan Riau | Pulau Laut Kab. Natuna | name is not a regency/city name (sub-area label) |
| Kepulauan Riau | Pulau Midai Kab. Natuna | name is not a regency/city name (sub-area label) |
| Kepulauan Riau | Pulau Serasan Kab. Natuna | name is not a regency/city name (sub-area label) |
| Kepulauan Riau | Pulau Tambelan Kab. Bintan | name is not a regency/city name (sub-area label) |
| Maluku | Kab. Maluku Tenggara Barat | no Wikidata item with this name and class and a coordinate |
| Maluku Utara | Kota Sofifi | no Wikidata item with this name and class and a coordinate |
| Papua | Kab. Yapen Waropen | no Wikidata item with this name and class and a coordinate |
| Sulawesi Barat | Kab. Mamuju Utara | no Wikidata item with this name and class and a coordinate |
| Sumatera Utara | Kab. Toba Samosir | no Wikidata item with this name and class and a coordinate |
| Sumatera Utara | Kota Padangsidempuan | no Wikidata item with this name and class and a coordinate |

Dugaan penyebab (belum diverifikasi per kasus): beda ejaan (Pahuwato vs Pohuwato, Padangsidempuan vs Padang Sidimpuan, Toba Samosir vs Toba), nama lama (Mamuju Utara, Maluku Tenggara Barat, Yapen Waropen), item tanpa P625 atau berkoordinat ganda di Wikidata (Kota Pontianak diduga Q14168, belum dicek), atau bukan kab/kota di Wikidata (Kota Sofifi, Kepulauan Seribu). 5 entri Kepulauan Riau adalah label sub-area EQuran, bukan kab/kota. Owner bisa memetakan manual lewat `MANUAL_QID_OVERRIDES` di `src/server/prayer/coordinates.ts`.

## Keputusan yang perlu dilihat owner
1. **Kota Jakarta**: EQuran hanya punya satu "Kota Jakarta". Wikidata Q3630 (Jakarta, level provinsi) dipakai lewat override manual eksplisit supaya 3 kota lama tetap terverifikasi. Hapus entri override jika tidak setuju.
2. Wikidata bisa memberi titik ibu kota, bukan pusat wilayah. Cukup untuk ambang 6 menit (1,5° bujur), tidak cocok untuk keperluan lain (mis. kiblat presisi).
3. `crosscheck-coordinates.json` kini `provisional: false` (bersumber dataset CC0). Koordinat 3 kota lama (perkiraan) diganti; selisih terhadap angka lama < 0,5° (dites).

## Cek silang langsung EQuran vs adhan (November 2026, 502 wilayah, koordinat Wikidata)
| Hasil | Jumlah |
|-------|--------|
| `verified` (selisih maks <= 6 menit) | 448 |
| `needs_review` (7 menit: 29, 8 menit: 19, 9: 1, 10: 1) | 50 |
| Bulan ditolak skema (error) | 4 |

Jakarta, Makassar, Jayapura tetap `verified`.
`needs_review` terkonsentrasi di dataran tinggi (Bandung, Garut, Karo, Simalungun, Toraja, pegunungan tengah Papua, Kerinci, Solok). Dugaan: koreksi ketinggian pada data Kemenag yang tidak ada di adhan [Low confidence: pola cocok, tidak diuji]. Ambang 6 menit dibiarkan (PROV, bukan wewenang sesi ini). Efeknya: wilayah ini tampil sebagai belum terverifikasi sampai owner memutuskan ambang atau koreksi ketinggian.
**Temuan terpisah**: 4 wilayah Kalimantan Tengah (Barito Selatan, Barito Timur, Barito Utara, Murung Raya) ditolak `validateEquranMonth` karena Maghrib 17:12-17:13 di bawah batas bawah 17:15 (`equran-schema.ts`). Itu angka nyata EQuran (bujur ~115°E di zona WIB), jadi batas bawah terlalu ketat. Tidak saya ubah (di luar tugas ini, nilai itu keputusan T4b); orang yang menangani T4b perlu melonggarkan, mis. 17:00.

## File
`scripts/import-coordinates.ts` (`pnpm import:coordinates`, butuh NODE_USE_ENV_PROXY=1), `src/server/prayer/coordinates.ts` (parser, normalisasi, pencocokan), `regions.ts` (lookup pakai Map), `content/regions/wikidata-coordinates.json`, `content/regions/crosscheck-coordinates.json`, `tests/unit/server/prayer-coordinates.test.ts` (20 test), `package.json` (script baru, di luar daftar scope tetapi diperlukan).

## Output test asli
```
pnpm typecheck    -> tsc --noEmit, tanpa error
pnpm lint         -> eslint, tanpa warning
pnpm test         -> Test Files 31 passed (31), Tests 569 passed | 3 skipped (572)
pnpm audit --prod -> No known vulnerabilities found
```
E2E tidak dijalankan (tidak ada perubahan UI). Cek silang langsung dijalankan sekali dari skrip sementara (tidak di-commit).

## Skill
Tidak ada skill yang dimuat lewat tool.
