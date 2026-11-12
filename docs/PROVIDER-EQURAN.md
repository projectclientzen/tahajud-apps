# Pemeriksaan provider jadwal shalat: EQuran.id

Diperiksa orchestrator, 12 Nov 2026, dari container (curl, HTTPS). Status: LAYAK DIPAKAI DENGAN SYARAT. Belum disetujui untuk produksi.

## Fakta yang terlihat
| Aspek | Temuan |
|-------|--------|
| Endpoint | `GET /api/v2/shalat/provinsi`, `POST /api/v2/shalat/kabkota` `{provinsi}`, `POST /api/v2/shalat` `{provinsi, kabkota, bulan, tahun}` |
| Respons | `{code, message, data:{provinsi, kabkota, bulan, tahun, jadwal:[{tanggal, tanggal_lengkap, hari, imsak, subuh, terbit, dhuha, dzuhur, ashar, maghrib, isya}]}}`, jam `HH:mm` tanpa zona waktu |
| Contoh | DKI Jakarta / Kota Jakarta, 12 Nov 2026: imsak 03:56, subuh 04:06, maghrib 17:51 |
| Wilayah | 34 provinsi; nama kab/kota harus persis (mis. "Kota Jakarta", bukan "Kota Jakarta Selatan" → 404) |
| Auth | Tanpa API key |
| Transport | HTTPS, sertifikat valid, HSTS, `nosniff`, Cloudflare. CORS `*` |
| Cache | `Cache-Control: public, max-age=2592000` (30 hari) |
| Sumber data (klaim situs) | "Jadwal shalat: Bimas Islam Kementerian Agama RI" |
| Rate limit | Disebut ada di syarat layanan, angka tidak dipublikasikan, header rate limit tidak terlihat |

## Syarat layanan (versi 1.0, berlaku 15 Juni 2025), poin relevan
- Diizinkan: "Menggunakan API untuk pengembangan aplikasi", "Membagikan konten dengan mencantumkan sumber dari EQuran.id".
- "API disediakan gratis untuk penggunaan yang wajar", "Terdapat rate limiting".
- "Data yang diperoleh tidak boleh dijual atau diperjualbelikan".
- Layanan "sebagaimana adanya", tanpa tanggung jawab atas kesalahan informasi atau gangguan; ketentuan bisa berubah sewaktu-waktu.

## Risiko dan mitigasi
| # | Risiko | Mitigasi di app |
|---|--------|-----------------|
| 1 | App berbayar vs larangan "dijual atau diperjualbelikan": area abu-abu | BLOCKER produksi: minta izin tertulis ke EQuran.id. Sampai ada izin, status provider = PROV |
| 2 | Data salah atau berubah (tanpa tanda tangan data, tanpa SLA) | Validasi ketat + cek silang astronomis lokal (selisih > 6 menit → tidak ditampilkan sebagai terverifikasi), cache, jadwal manual |
| 3 | Layanan mati / rate limit / ketentuan berubah | Panggilan hanya dari job server sebulan sekali per wilayah, cache 30 hari, fallback cache + jadwal manual, label sumber |
| 4 | Privasi | Hanya nama provinsi/kab-kota yang dikirim, dari server; tidak ada data user, IP user, atau lokasi presisi ke pihak ketiga |
| 5 | Klaim sumber Kemenag belum terverifikasi independen | Cek silang + tampilkan atribusi "Bimas Islam Kemenag RI via EQuran.id"; uji akurasi di checklist launch |
| 6 | Zona waktu tidak ada di respons | Peta provinsi → zona waktu milik app, dites |
| 7 | 34 provinsi saja (pemekaran Papua 2022 tidak ada) | User di wilayah itu memilih kab/kota terdekat dalam daftar atau jadwal manual; dicatat sebagai keterbatasan |
| 8 | CORS `*` memungkinkan pemanggilan dari browser | Arsitektur melarang: hanya backend yang memanggil (PRD §14.1) |

Confidence: fakta teknis di atas High (dilihat langsung). Kesesuaian klaim "sumber Kemenag" Medium (satu titik data cocok dengan kisaran umum, belum dibandingkan resmi). Tafsir syarat layanan untuk app berbayar Low: perlu konfirmasi pemilik layanan.
