# Content Review: Teks Dzikir

Sumber: `content/amalan.v1.json` (dikirim owner 12 Nov 2026). Status: `submitted`.
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

## Pertanyaan terbuka
1. Dzikir setelah Subuh (istighfar panjang s.d. doa hajat): khusus Level 3, atau semua level?
2. Panduan tilawah Level 2 tertulis "setengah jam atau 60 menit". Mana yang dipakai? Level 3 berapa menit?
3. "Allahu Akbar kabira dan rangkaiannya": dibaca berapa kali? (default 1)
4. Apakah semua teks sudah ditandatangani pembimbing? Jika ya, status bisa dinaikkan ke `published`.
5. Transliterasi Latin dan terjemahan Indonesia: mau disediakan? (opsional, jika tidak ada app hanya menampilkan teks Arab + nama dzikir)
