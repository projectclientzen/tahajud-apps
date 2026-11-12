# Sesi U1b (Sonnet): Al-Qur'an, laporan, pengaturan, UI/UX

Branch: `claude/u1b-quran-reports-settings` | Basis: `main` @ `0e5cfd2` | Tanggal: 2026-11-12. Paralel dengan U1a, T3b, T4c.

Mode antislop: diminta owner jalan otomatis tanpa konfirmasi, jadi dipakai mode "setelah" (audit lalu perbaiki) tanpa menanyakan mode.

## Skill yang dipanggil lewat tool Skill
`ui-ux-pro-max`, `antislop`, `antislop-ui`, `antislop-human`, `antislop-layoutmobile`, `antislop-copywriting`. Semua berhasil dimuat. `hallmark` tidak dipanggil: brief task ini tidak memintanya (hanya U1.md umum yang menyebut) dan layar yang dikerjakan sudah ada, bukan halaman baru. Salinan `ui-ux-pro-max` di sini hanya berisi aturan prioritas, bukan database pencarian, jadi tidak ada klaim "match database".

Design Read: layar pendamping ibadah malam untuk pengguna Indonesia, bahasa visual tenang dan hangat (sistem desain yang sudah ada), dial ENERGY 1 / RHYTHM 2 / MOTION 1. Tidak ada token atau komponen `ui/**` yang diubah.

## REAL vs SIMULATED (bagian U1b)

| Bagian | Status | Catatan |
|---|---|---|
| Teks ayat di Reader | REAL | Dari `content/quran/uthmani.json` (Tanzil, checksum diverifikasi) lewat repository `src/data/quran`. Tanpa terjemahan |
| Basmalah baris pembuka | REAL (PROV) | Dari `content/quran/basmalah.json` (baris 1:1 sumber). Dilepas dari ayat 1 hanya jika awalan = 1:1 + spasi |
| Label verifikasi jadwal | REAL di UI, SIMULATED di data | UI membaca `PrayerTime.verification`. Mock tidak mengirim field itu, jadi selalu "Belum diverifikasi". Jalur "Terverifikasi" teruji unit, belum terlihat di browser sampai T3b mengisi field di API |
| Atribusi "Bimas Islam Kemenag RI via EQuran.id" | REAL di UI | Tampil hanya untuk jadwal provider/cached yang bukan data demo |
| Laporan, kalender, pengaturan, notifikasi, bantuan, profil | SIMULATED | Data mock, badge "Data demo" tetap tampil |

## Hasil pemeriksaan font (Amiri Quran)
- Cakupan glyph: 59 codepoint unik di seluruh teks (399 ayat + basmalah) dibandingkan dengan tabel cmap dua file woff2 Amiri Quran yang dimuat build. Hasil: 0 codepoint hilang (dicek dengan fontTools terhadap `.next/static/media`).
- Visual: screenshot Yasin dan Al-Kahfi 390 dan 1280, light dan dark, tanpa kotak tofu, tanda waqaf dan harakat tersusun. Ukuran 44 px di 320 px: tidak ada luapan horizontal dan tidak ada teks terpotong (e2e).
- Catatan: pemeriksaan visual dilakukan oleh agen, bukan pembaca bahasa Arab. Owner perlu membaca satu atau dua surah di perangkat nyata sebelum rilis.

## Audit per layar (sebelum dan sesudah)

Screenshot: `docs/screenshots/u1/u1b-before-*` (sebelum) dan `u1b-*` (sesudah). Penamaan: `<layar>-<isi|kosong|offline>-<390|1280>-<light|dark>`. State loading dan error dicek lewat e2e dan LoadGate (state offline ditangkap untuk /quran, /reports, /notifications). Tidak ada state loading yang bisa ditangkap stabil di screenshot, jadi itu diverifikasi lewat kode dan role `status` di e2e.

| Layar | Temuan sebelum | Perbaikan |
|---|---|---|
| `/quran` | Daftar satu kolom panjang di desktop | Grid 2 kolom mulai md |
| `/quran/[surah]` | Tanpa teks (state "dataset belum diimport"); tombol "Ayat N" memakan satu baris per ayat; titik tengah sebagai pemisah; tidak ada skeleton; tidak ada jalan pintas ke ayat terakhir | Teks asli, basmalah terpisah, nomor ayat jadi penanda bulat 44 px di sisi ayat, label "Terakhir dibaca" berupa teks (bukan hanya warna), tombol "Ke ayat N", skeleton memuat, ErrorState dengan "Coba lagi" bila dataset gagal, atribusi Tanzil di akhir surah dengan tautan |
| `/reports` | Daftar 26 bar identik panjang (2300 px di 390) menutupi hasil penting; kartu kecil bertumpuk di desktop | Daftar dilipat 8 baris dengan tombol "Tampilkan semua N amalan" (`aria-expanded`), 2 kolom di desktop, kartu tingkat dan status berdampingan, tombol header 44 px |
| `/reports/calendar` | Tombol header setinggi 48 px terlalu dominan | Tombol header 44 px. Grid dan legenda sudah jelas, tidak diubah |
| `/settings` | Satu halaman 2900 px tanpa navigasi; label wilayah ganda "(WIB) (WIB)"; teks jadwal tanpa status verifikasi | Navigasi bagian (4 tautan anchor, target 44 px), label wilayah diperbaiki, `ScheduleNote` dengan label verifikasi dan atribusi |
| `/settings/devices`, `/settings/account` | Tidak ada masalah berarti | Tidak diubah |
| `/notifications` | Jam bangun disarankan tanpa sumber jadwal | `ScheduleNote` di kartu alarm manual; tombol header 44 px |
| `/help` | 10.500 px di 390, semua level terbuka; titik tengah sebagai pemisah | Level dilipat (`details`, Level 1 terbuka, 4.400 px), pemisah titik tengah diganti kalimat pendek |
| `/profile` | Rapi | Tidak diubah |

Temuan di luar scope (minta U1a / orchestrator):
1. `PageHeader` (shell): tombol aksi dan tombol Keluar berbagi baris dengan lencana "Data demo", di 390 px baris ini padat. Saran: aksi sekunder pindah ke bawah judul. Tidak diubah.
2. `ScheduleNote` bisa dipakai juga di `src/components/dashboard/schedule-card.tsx` (milik U1a) supaya label verifikasi dan atribusi konsisten di dashboard. Impor dari `@/components/settings/schedule-note`.
3. Input `type="time"` menampilkan "10:00 PM" di Chromium locale non-Indonesia. Perilaku browser, dicatat saja.
4. Mock data layer belum punya skenario jadwal terverifikasi. Usulan untuk T3b/mock: field `verification` dan `attribution` di `PrayerTime` (opsional, sudah ditambahkan di kontrak).
5. Gate "Delivery Gate" antislop: hasil per butir di bagian bawah.

## Keputusan

| # | Keputusan | Alasan | Alternatif ditolak |
|---|---|---|---|
| U1b-1 | Repository teks `src/data/quran` memuat dataset lewat `import()` di chunk terpisah | Dataset 86 KB tidak ikut halaman lain; tetap bisa dicache service worker untuk offline | Impor statis (membengkakkan bundle semua layar) |
| U1b-2 | `content/quran/basmalah.json` dibuat dari baris `1|1|` sumber dan dijaga test byte-per-byte | Reader butuh teks 1:1 untuk aturan pemisahan, tetapi `uthmani.json` hanya berisi 6 bacaan. Teks tidak boleh dari ingatan model dan guard unit melarang aksara Arab di `src/` | Menulis konstanta di kode (melanggar aturan teks), mengubah `uthmani.json` (di luar scope, perlu persetujuan owner) |
| U1b-3 | Hook `__TT_QURAN_FIXTURE__` dihapus | Teks asli sudah ada; teks uji palsu tidak diperlukan lagi dan menambah permukaan risiko | Dipertahankan "untuk e2e" |
| U1b-4 | Bila awalan ayat 1 tidak sama persis, ayat tampil utuh tanpa baris basmalah | Aturan brief: pemisahan hanya jika identik. Lebih baik tidak memisah daripada mengubah teks | Menebak potongan |
| U1b-5 | `PrayerTime.verification` dan `attribution` ditambahkan opsional di kontrak `src/data/contracts.ts` | Tambahan saja, tidak mematahkan T3b; UI aman bila field kosong ("Belum diverifikasi") | Hardcode "Kemenag" di UI |
| U1b-6 | Label "Terverifikasi" hanya bila `verification === "verified"`; `needs_review` tampil "Perlu dicek ulang"; selainnya "Belum diverifikasi"; atribusi tidak tampil untuk data demo dan jadwal manual | Aturan brief dan CLAUDE.md (jangan memalsukan sumber di mock) | Menampilkan atribusi Kemenag pada data demo (menyesatkan) |
| U1b-7 | Test e2e lama `r3b-quran` diganti ke teks asli; test "tanpa dataset" mensimulasikan gagal muat dengan mengabort chunk (service worker diblokir untuk test itu) | Fixture dihapus | Hook produksi untuk mematikan teks |
| U1b-8 | `r3b-settings` "jam tenang" kini menunggu konfirmasi simpan sebelum reload | Test lama balapan di mobile: reload membatalkan simpan | Menaikkan timeout |

## Delivery Gate antislop (ringkas, berbasis bukti)
- R-02 (em dash): PASS, `grep` pada `src/components/{quran,reports,settings,notifications,help}` dan file baru: 0 em dash.
- R-03 (mobile): PASS, e2e overflow 0 di 320 px semua rute dan Reader 44 px, screenshot 390 dilihat.
- R-17/R-36/R-38 (data tak berdasar): PASS, tidak ada angka baru; label verifikasi bergantung field nyata; data demo tidak mengklaim Kemenag.
- R-25/R-32/R-39 (kontras, keyboard, semantik): PASS lewat axe 0 serious/critical (rute T2 dan reader semua surah, light dan dark, termasuk help dan reports dibuka penuh); accordion bisa dibuka dengan Enter.
- R-26/R-35 (kontrol berfungsi, dijalankan): PASS untuk kontrol yang diubah: nav bagian pengaturan, accordion bantuan, "Tampilkan semua", "Ke ayat N", tanda ayat, ukuran huruf, mode malam, "Coba lagi" (jalur gagal muat). Catatan: jalur "Coba lagi" dilihat di e2e sampai state gagal, kliknya sendiri tidak diuji.
- R-27 (state): PASS untuk Reader (memuat, gagal, isi); rute lain memakai LoadGate yang sudah ada.
- R-04 (ikon): ikon lucide dipertahankan dari sistem yang ada (relevan: panah, centang, peringatan), tidak ada ikon baru yang generik.
- Block 3 (liveliness): tidak diubah; identitas visual berasal dari sistem desain yang disetujui, bukan dari sesi ini.
