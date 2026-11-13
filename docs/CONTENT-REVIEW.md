# Content Review: Teks Dzikir

Sumber: `content/amalan.v1.json` (dikirim owner 12 Nov 2026). Status: `published` (disetujui owner 12 Nov 2026, v1.1.0).
Teks owner TIDAK diubah. Daftar di bawah hanya usulan untuk diputuskan pembimbing. Agen tidak boleh menerapkannya tanpa persetujuan owner.

## Sudah diputuskan
| Item | Keputusan |
|------|-----------|
| Lafaz asma | Ya Kafi (كافي), bukan Ya Khafi |
| Satuan rangkaian asma | 1 hitungan = 1 putaran keempat asma |
| Dzikir setelah Qabliyah | Tasbih malaikat 100x |
| Karakter Ya Fattah... | Teks owner memakai Arabic Presentation Forms (U+FExx). Disimpan versi normal (NFKC) agar font, pencarian, dan screen reader bekerja benar. Huruf dan harakat tidak berubah |

## Usulan koreksi (perlu keputusan pembimbing)
| # | Dzikir | Teks sekarang | Usulan | Alasan | Confidence |
|---|--------|---------------|--------|--------|------------|
| 1 | Shalawat | عَلَى مُحَمَّدِ | عَلَى مُحَمَّدٍ | Isim munsharif, umumnya bertanwin kasrah. Saat waqaf bacaan sama | Medium |
| 2 | Tahlil panjang (post-Fajr) | لَاَ إِلَهَ | لَا إِلَهَ | Dua fathah pada lam dan alif, kemungkinan salah ketik | High |
| 3 | Allahu Akbar kabira | لَاَ إِلَهَ | لَا إِلَهَ | Sama dengan #2 | High |
| 4 | Allahu Akbar kabira | campuran , dan ، | seragam ، | Konsistensi tanda baca | High |
| 5 | Allahumma antas salam | وَاَدْخِلْنَا | وَأَدْخِلْنَا | Fi'il bab af'ala, hamzah qath' | High |
| 6 | Allahumma antas salam | ذَاالْـجَلَالِ | ذَا الْجَلَالِ | Spasi hilang | High |
| 7 | Allahumma antas salam | وَاْلإِكْرَامِ | وَالْإِكْرَامِ | Sukun di atas alif tidak lazim | Medium |
| 8 | Allahumma antas salam | الْـجَنَّةَ / الْـجَلَالِ | الْجَنَّةَ / الْجَلَالِ | Tatweel hanya hiasan, mengganggu pencarian dan screen reader | Medium |

Confidence berdasarkan kaidah nahwu/imla umum, bukan rujukan kitab tertentu. Keputusan akhir di tangan pembimbing.

## Pertanyaan terjawab (12 Nov 2026)
1. Post-Fajr: semua level.
2. Tilawah malam: opsional. Al-Waqi'ah: wajib.
3. Allahu Akbar kabira: 1x.
4. Konten: dipublish atas persetujuan owner.

## Masih terbuka
- Keputusan 8 usulan koreksi di atas. Sampai diputuskan, teks owner tampil apa adanya di produksi.
- Transliterasi Latin dan terjemahan Indonesia (opsional).

## Niat salat (`content/niat.v1.json` v1.0.0, dari owner 13 Nov 2026), status `in_review`
Teks disalin apa adanya. Temuan di bawah TIDAK diterapkan sampai owner memutuskan.
| # | Item | Temuan | Usulan |
|---|------|--------|--------|
| N1 | Hajat | Arab memuat أَدَاءً (adā'an), Latin tidak | Samakan Arab dan Latin |
| N2 | Witir 1 | Arab سُنَّةً مِنَ الْوِتْرِ (sunnatan minal witri), Latin "sunnatal witri" | Samakan |
| N3 | Witir 1 | Latin "lillaahhi" (h ganda) | Kemungkinan salah ketik |
| N4 | Witir 2 | Sama dengan N2 | Samakan |
| N5 | Semua | Gaya transliterasi beda (â, aa, oo/o) | Pilih satu gaya |
| N6 | Qabliyah Subuh | Belum ada teks | Owner kirim, atau tombol niat disembunyikan di langkah ini |
Keputusan owner 13 Nov 2026: N1 sampai N5 dipakai apa adanya (Witir memang 2 niat: 1 rakaat dan 2 rakaat). N6: Qabliyah Subuh tanpa tombol niat (entri dihapus). Status `published`.
