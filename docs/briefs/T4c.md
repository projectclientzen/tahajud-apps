# Brief T4c (Agen C, Sonnet, effort medium): koordinat kab/kota dari Wikidata

Environment `tahajud-apps` mengizinkan `query.wikidata.org` dan `www.wikidata.org` (disetujui owner). Basis: branch integrasi `claude/great-cerf-mfce32`.

## Tugas
1. `scripts/import-coordinates.ts`: query SPARQL Wikidata (CC0) untuk kabupaten (Q3191695) dan kota (Q3199141) di Indonesia dengan koordinat (P625) dan kode wilayah Kemendagri jika ada (P2588 atau properti kode yang tersedia; cek dulu, jangan menebak). Simpan hasil mentah + tanggal ambil + query + lisensi CC0 di `content/regions/wikidata-coordinates.json`.
2. Cocokkan ke 517 kab/kota di `content/regions/equran-regions.json` (normalisasi "Kab."/"Kabupaten", "Kota", spasi, huruf). Laporkan jumlah cocok otomatis, ambigu, dan tidak cocok. Kasus ambigu/tidak cocok TIDAK diisi tebakan: ditandai `unmatched` dan dicantumkan di laporan.
3. Ganti `content/regions/crosscheck-coordinates.json` (3 kota perkiraan) dengan data hasil cocok; cek silang EQuran vs adhan memakai koordinat ini. Wilayah `unmatched` tetap `verification: "unchecked"`.
4. Test: parser hasil SPARQL, normalisasi nama, tidak ada koordinat di luar kotak Indonesia (lat -11..6, lon 95..141.1), 3 kota lama tetap terverifikasi.
Scope: `scripts/import-coordinates.ts`, `content/regions/**`, `src/server/prayer/**`, `tests/unit/server/prayer-*`, `docs/sessions/T4c.md`. Gerbang: typecheck, lint, test, audit. Push ke branch sesi, lapor ke orchestrator. Pakai `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` untuk fetch dari Node.
