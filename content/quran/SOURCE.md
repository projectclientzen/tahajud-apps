# Sumber teks Qur'an

Teks ayat di `uthmani.json` disalin apa adanya dari file Tanzil. Jangan diedit tangan.
Perubahan hanya lewat `pnpm import:quran --refresh` dan harus disetujui owner.

- Sumber: Tanzil Project, Tanzil Quran Text (Uthmani, Version 1.1)
- Halaman unduh: https://tanzil.net/download/
- URL unduh: https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&marks=true&sajdah=true&tatweel=true&agree=true
- Halaman lisensi: https://tanzil.net/docs/Text_License
- Tanggal unduh: 2026-11-12
- File sumber utuh: `source/quran-uthmani.txt`
- SHA-256 file sumber utuh: `6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f`
- Jumlah ayat di uthmani.json: 399
- Ayat yang diambil: surah 18, 36, 55, 56, 67 (semua ayat) dan 65:2-3


## Metadata halaman dan juz (meta.json, public/quran/)

- Sumber: Tanzil Quran Metadata, `quran-data.js`
- URL unduh: https://tanzil.net/res/text/metadata/quran-data.js
- Tanggal unduh: 2026-11-13
- File sumber utuh: `source/quran-data.js`
- SHA-256 file metadata: `9e9930c592aaa34b5c7a79ff4e99ffdc782263a266090bfe2c49e4ed4bac4ca4`
- Lisensi: Creative Commons Attribution 3.0 (header file, disalin di bawah)
- Isi yang dipakai: tabel surah (nama latin, jumlah ayat), awal 30 juz, awal 604 halaman (Mushaf Madinah). Hanya angka yang dibaca, file tidak dieksekusi
- `content/quran/meta.json` dibuat oleh `pnpm import:quran`. Jangan diedit tangan
- `public/quran/surah-001.json` sampai `surah-114.json`: seluruh ayat dari file sumber utuh, satu file per surah, teks tidak diubah

```
// Quran Metadata (ver 1.0)
// Copyright (C) 2008-2009 Tanzil.info
// License: Creative Commons Attribution 3.0
```

## Atribusi

Teks Qur'an: Tanzil Project (https://tanzil.net), lisensi Creative Commons Attribution 3.0.
Tampilkan sumber dan tautan ke tanzil.net di Reader (akhir surah).

## Teks lisensi (disalin dari akhir file sumber, tanpa perubahan)

```
# PLEASE DO NOT REMOVE OR CHANGE THIS COPYRIGHT BLOCK
#====================================================================
#
#  Tanzil Quran Text (Uthmani, Version 1.1)
#  Copyright (C) 2007-2026 Tanzil Project
#  License: Creative Commons Attribution 3.0
#
#  This copy of the Quran text is carefully produced, highly 
#  verified and continuously monitored by a group of specialists 
#  at Tanzil Project.
#
#  TERMS OF USE:
#
#  - Permission is granted to copy and distribute verbatim copies 
#    of this text, but CHANGING IT IS NOT ALLOWED.
#
#  - This Quran text can be used in any website or application, 
#    provided that its source (Tanzil Project) is clearly indicated, 
#    and a link is made to tanzil.net to enable users to keep
#    track of changes.
#
#  - This copyright notice shall be included in all verbatim copies 
#    of the text, and shall be reproduced appropriately in all files 
#    derived from or containing substantial portion of this text.
#
#  Please check updates at: http://tanzil.net/updates/
#
#====================================================================
```
