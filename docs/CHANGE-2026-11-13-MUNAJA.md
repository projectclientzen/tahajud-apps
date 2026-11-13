# Perubahan mayor owner, 13 Nov 2026 (draf PRD v1.3, bagian produk)

Sumber: pesan owner 13 Nov 2026 + jawaban 4 pertanyaan orchestrator. Berlaku di atas PRD v1.2.3. Bagian auth/VPS v1.3 ada di `docs/sessions/SCALEV-AUTH-PLAN.md` §8.

## M1. Nama aplikasi: "Munaja"
- Nama tampil di manifest PWA, `<title>`, splash, header, copy. NgajiGaes tetap sebagai penerbit ("Munaja oleh NgajiGaes" di halaman tentang/login).
- Cek merek dagang belum dilakukan (owner). Logo belum final.

## M2. Al-Qur'an lengkap + target khatam (fitur terpisah dari amalan tahajud)
- Reader 114 surah dari Tanzil Uthmani 1.1 yang sudah ada (`content/quran/source/quran-uthmani.txt`, SHA-256 tercatat). Tidak ada teks dari ingatan model.
- Navigasi: daftar surah, juz, halaman. Halaman = Mushaf Madinah 604 halaman berdasarkan metadata Tanzil (`quran-data`), diunduh + checksum, dicatat di SOURCE.md. Tampilan = ayat dikelompokkan per halaman, BUKAN replika visual mushaf cetak.
- Tab Al-Qur'an fokus ke khatam. Enam bacaan malam tetap dibuka dari dalam sesi amalan; bacaan di sesi TIDAK dihitung ke khatam (default, owner bisa ubah).
- Target khatam: user memilih 1 sampai 5 kali, periode 30 hari sejak target dibuat (timezone wilayah user).
- Rencana harian mengikuti tabel owner: per waktu salat (Subuh, Dzuhur, Ashar, Maghrib, Isya) baca 2N lembar = 4N halaman (N=5 menjadi 20 halaman = 1 juz). 30 hari x 5 waktu x 4N = 600N halaman; kekurangan 4N halaman dari 604N ditambahkan ke hari terakhir (default orchestrator, PROVISIONAL).
- Checklist per waktu salat per hari: centang = target halaman waktu itu terbaca, mulai dari posisi terakhir. User juga bisa menandai "terakhir dibaca sampai halaman X" dari reader.
- Grafik lingkaran: persen halaman terbaca dari total target, khatam ke berapa, sisa halaman, sisa hari.
- Tertinggal: tampil sebagai "sisa", tanpa reset, tanpa kalimat menyalahkan. Setelah 30 hari: ringkasan, lalu buat target baru.
- Data per user di server lewat `/api/v1` + antrean offline. Tidak ada data khatam per user di admin.

## M3. Lokasi otomatis saat daftar
- Onboarding tidak lagi meminta user mengatur waktu manual. Tombol "Pakai lokasi otomatis" → Geolocation browser → kab/kota terdekat dihitung DI PERANGKAT dari `content/regions/wikidata-coordinates.json` → layar konfirmasi "Lokasimu: [kota]. Benar?" → wilayah + zona waktu terisi, jadwal salat dari provider.
- Koordinat GPS tidak dikirim dan tidak disimpan; yang dikirim hanya id wilayah.
- Fallback pilih manual bila izin ditolak, GPS gagal, atau kota tanpa koordinat (15 dari 517).
- Risiko: kota terdekat dari titik pusat bisa salah di perbatasan; layar konfirmasi wajib.

## M4. Navigasi
- Bottom nav: Beranda, Amalan, Al-Qur'an, Laporan. Profil keluar dari bottom nav, tetap di header (ikon orang).
- Ikon laporan di header dashboard dihapus.

## M5. Riwayat level
- Di tab Amalan, level yang sudah dicapai bisa dibuka hanya baca: isi amalan + rekap catatan level itu. Level yang belum dicapai tetap terkunci, tidak bisa dipratinjau.
- Tidak mengubah aturan progres: tidak ada reset, tidak mengunci ulang.

## M6. Niat salat di sesi tahajud
- Langkah salat yang punya entri di `content/niat.v1.json` (Taubat, Tahajud, Hajat, Witir 1 rakaat, Witir 2 rakaat) punya tombol "Lihat niat": sheet Arab + Latin (+ catatan). Qabliyah Subuh tanpa tombol (keputusan owner).
- Teks HANYA dari `content/niat.v1.json` yang diisi owner. Sebelum diisi: empty state "Bacaan niat belum tersedia". Badge review bila `review_status != "published"`.

## M7. Label status sesi
- Status `upcoming` tampil "Belum waktunya" (menggantikan "Akan datang"), disetujui owner 13 Nov 2026.
