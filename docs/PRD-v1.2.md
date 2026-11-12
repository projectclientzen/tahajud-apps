# PRODUCT REQUIREMENTS DOCUMENT
# Tahajud Tracker by NgajiGaes

**PRD v1.2: UI/UX, System Architecture & Technical Specification**

| Field | Nilai |
|-------|-------|
| Versi | 1.2.1 |
| Tanggal | 12 November 2026 |
| Menggantikan | PRD v1.1 (`docs/PRD-v1.1.md`, disimpan untuk riwayat) |
| Status | Implementation baseline. Item bertanda PROV belum final |
| Tipe produk | Paid Progressive Web App (PWA) |
| Bahasa | Bahasa Indonesia |
| Brand | NgajiGaes, Earth Tone |
| Target | Muslim Indonesia yang ingin membangun kebiasaan ibadah malam |
| Handoff | Claude (agen implementasi), lihat `docs/AGENT_BRIEF.md` |

### Konvensi penanda
- **PROV**: default sementara, configurable, wajib disetujui owner/pembimbing sebelum launch. Disimpan dengan flag `provisional = true`.
- **BLOCKED**: tidak bisa dikerjakan sampai owner menyediakan input/kredensial.
- **VERIFY**: klaim tentang layanan eksternal yang belum dicocokkan ke dokumentasi resmi.
- **[v1.2: ID]**: perubahan dari v1.1 berdasarkan temuan di `docs/AUDIT-PRD-v1.1.md`.

### Changelog v1.1 → v1.2 (ringkas)
1. Login utama pindah ke OTP 6 digit yang diketik di app; magic link jadi opsional [SEC-01].
2. Entitlement aktif hanya setelah order diverifikasi ulang ke API Scalev [SEC-02].
3. Satu jalur data: browser → `/api/v1` → Postgres (RLS tetap aktif). Client tidak menulis tabel langsung [SEC-03].
4. Status missed diturunkan dari kalender, bukan dari baris sesi [BUG-01].
5. Level monoton, tidak pernah terkunci kembali [BUG-02].
6. Counter dzikir memakai tap coalescing [BUG-03].
7. Jadwal manual sebagai fallback dan untuk user di luar Indonesia [BUG-04].
8. Aturan privasi untuk sesi berhalangan dan role admin [PRIV-01, SEC-09].
9. Alur support untuk email salah, transfer entitlement, dan pembelian untuk orang lain [OPS-01, OPS-03].
10. Tabel baru: user_roles, user_devices, jobs, email_outbox, rate_limits, app_settings, data_deletion_requests, admin_audit_logs.
11. 18 acceptance test baru.

### Changelog v1.2.1 (12 Nov 2026, konten owner)
- Teks Arab seluruh dzikir dari owner disimpan di `content/amalan.v1.json` (status `submitted`, menunggu tanda tangan pembimbing).
- Lafaz final "Ya Kafi" (كافي), bukan "Ya Khafi".
- Satuan rangkaian asma = putaran (konsisten dengan total 400/1.550/1.863).
- Dzikir setelah Qabliyah = tasbih malaikat 100x.
- Witir Level 2-3 dicatat sebagai dua aktivitas: 2 rakaat dan 1 rakaat.
- Panduan durasi tilawah dari owner.
- Daftar usulan koreksi harakat di `docs/CONTENT-REVIEW.md` (belum diterapkan).

---

## 1. Executive Summary

### 1.1 Deskripsi
Tahajud Tracker by NgajiGaes adalah PWA berbayar yang membantu pengguna membangun kebiasaan ibadah malam secara bertahap. Ada tiga level ibadah. Setiap level berisi salat, dzikir, doa, tilawah, dan rangkaian Subuh. Pengguna mencatat amalan, menghitung dzikir dengan counter digital, membaca surah pilihan Rasm Utsmani, dan melihat konsistensi di Dashboard Istiqomah. Akses hanya untuk pembeli yang pembayarannya terverifikasi di Scalev.

### 1.2 Visi
"Mendampingi perjalanan istiqomah dalam ibadah malam, satu malam demi satu malam."

### 1.3 Nilai inti
1. Panduan amalan tersusun per level.
2. Tantangan naik bertahap.
3. Progress terakumulasi, malam terlewat tidak mereset.
4. Waktu tahajud menyesuaikan jadwal Subuh wilayah.
5. Pengingat tidur, counter dzikir, dan pembaca Qur'an dalam satu app.
6. Laporan pribadi yang hanya bisa dilihat pengguna.
7. Pembeli Scalev mendapat akses tanpa registrasi manual.

### 1.4 Prinsip produk
- Konsistensi lebih utama daripada kesempurnaan tracking.
- Tidak mengukur kualitas iman, keikhlasan, atau diterimanya ibadah.
- Tidak ada hukuman atau reset total progress.
- Catatan ibadah bersifat privat.
- Konten agama punya rujukan dan status review yang jelas.
- Mobile-first dan aksesibel.
- Tidak menggantikan kebutuhan tidur cukup atau kewajiban salat fardu dengan target app.
- "Required" di app berarti syarat target app, bukan kewajiban fikih.

---

## 2. Product Decision Register

| ID | Komponen | Keputusan |
|----|----------|-----------|
| DEC-01 | Platform | Web App berbasis PWA |
| DEC-02 | Native app | Di luar scope |
| DEC-03 | Model akses | Paid access only |
| DEC-04 | Checkout | Scalev |
| DEC-05 | Aktivasi | Otomatis setelah pembayaran terverifikasi ke API Scalev [v1.2: SEC-02] |
| DEC-06 | Login | Passwordless. OTP 6 digit utama, magic link opsional [v1.2: SEC-01] |
| DEC-07 | Level | Tiga level progresif |
| DEC-08 | Unlock | Level 1 → 2 → 3, monoton [v1.2: BUG-02] |
| DEC-09 | Progress | Akumulasi sesi tuntas per level |
| DEC-10 | Malam terlewat | Tidak mereset progress |
| DEC-11 | Homepage | Dashboard Istiqomah |
| DEC-12 | Jadwal salat | Per wilayah dan tanggal, dengan fallback jadwal manual [v1.2: BUG-04] |
| DEC-13 | Provider jadwal | SIHAT Kemenag RI (VERIFY ketersediaan API) |
| DEC-14 | Reminder | Web Push dengan izin pengguna |
| DEC-15 | Bedtime reminder | Pesan berganti setiap hari |
| DEC-16 | Quran Reader | Rasm Utsmani, surah pilihan |
| DEC-17 | Visual | Earth Tone NgajiGaes |
| DEC-18 | Reporting | Privat, tanpa leaderboard |
| DEC-19 | Admin | Pengelolaan konten dan sistem, MFA wajib [v1.2: SEC-08] |
| DEC-20 | Bahasa | Indonesia |
| DEC-21 | Arsitektur data | Satu jalur: client → API → DB [v1.2: SEC-03] |
| DEC-22 | Lingkungan | dev, staging, production terpisah [v1.2: OPS-09] |

Keputusan yang belum ditetapkan owner memakai default PROV, bukan asumsi permanen.

---

## 3. Scope

### 3.1 In scope (MVP)
Verifikasi pembelian Scalev; provisioning akun otomatis; login passwordless; onboarding; pengaturan wilayah dan jadwal manual; sinkronisasi jadwal salat; Dashboard Istiqomah; Level 1-3; progression engine; tracking ibadah harian; counter dzikir; Quran Reader dengan bookmark dan progress; bedtime reminder dinamis; reminder tahajud dan Subuh; laporan pribadi; offline queue; manajemen push; manajemen perangkat; admin CMS; alur support (resend, transfer entitlement); hapus akun; light/dark theme; responsive mobile/tablet/desktop.

### 3.2 Out of scope (MVP)
Android/iOS native; integrasi alarm sistem; leaderboard, ranking, kompetisi grup; fatwa/hukum hasil AI; audio Qur'an penuh; chatbot ulama; pembayaran di luar Scalev; wearable; jadwal salat otomatis untuk wilayah luar Indonesia (diganti jadwal manual); self-service gifting (diganti transfer oleh admin).

---

## 4. Personas

| Persona | Deskripsi | Goals | Pain points |
|---------|-----------|-------|-------------|
| A. Pemula | Belum konsisten tahajud | Rutinitas perlahan, tahu urutan amalan | Sulit bangun, bingung urutan, motivasi turun |
| B. Bertumbuh | Sudah tahajud, ingin naik intensitas | Menambah amalan, menjaga hitungan, melihat progres | Hitungan dzikir panjang mudah lupa |
| C. Admin program | Tim NgajiGaes | Update konten, bantu pembeli, pantau sistem tanpa deploy ulang | Pembeli salah email, konten belum direview |

---

## 5. Information Architecture

### 5.1 Navigasi utama (bottom nav mobile, sidebar desktop)
| Tab | Route | Fungsi |
|-----|-------|--------|
| Beranda | `/dashboard` | Dashboard Istiqomah |
| Amalan | `/worship` | Panduan dan tracking |
| Al-Qur'an | `/quran` | Quran Reader |
| Profil | `/profile` | Pengaturan pengguna |

Laporan lengkap di `/reports`, diakses dari dashboard.

### 5.2 Route pengguna
| Route | Halaman |
|-------|---------|
| `/` | Halaman masuk ringan: info singkat, tombol Masuk, link beli ke Scalev. User yang sudah login diarahkan ke `/dashboard` [v1.2: DOC-07] |
| `/login` | Input email |
| `/auth/verify` | Input OTP 6 digit; konfirmasi magic link (tombol, bukan auto) |
| `/access-status` | Purchase pending / no active access / session expired |
| `/onboarding` | Onboarding |
| `/levels` | Perjalanan level |
| `/worship/session` | Sesi aktif |
| `/worship/dhikr/[id]` | Counter dzikir |
| `/quran/[surah]` | Reader surah |
| `/reports` | Laporan detail |
| `/reports/calendar` | Riwayat istiqomah |
| `/notifications` | Pusat notifikasi |
| `/settings` | Preferensi (theme, font, durasi, notifikasi, jadwal manual) |
| `/settings/devices` | Perangkat aktif [v1.2: SEC-15] |
| `/settings/account` | Hapus akun, unduh data [v1.2: PRIV-02] |
| `/help` | Bantuan, referensi, kontak CS WhatsApp |

### 5.3 Route admin
`/admin`, `/admin/users`, `/admin/purchases`, `/admin/entitlements`, `/admin/levels`, `/admin/activities`, `/admin/dhikr`, `/admin/quran-content`, `/admin/notifications`, `/admin/prayer-times`, `/admin/jobs`, `/admin/audit-logs`.
Semua dilindungi autentikasi + MFA + role yang dicek di server.

---

## 6. End-to-End User Journey

### 6.1 Pembelian → aktivasi
1. Pengguna membeli lewat Scalev.
2. Scalev mengirim webhook ke `/api/v1/webhooks/scalev`.
3. Server memverifikasi HMAC signature, menyimpan event idempotent, membalas 200.
4. Worker memproses event: fetch order dari API Scalev, cocokkan status bayar, product/variant, email [v1.2: SEC-02].
5. Jika valid: buat/perbarui `access_entitlements` status `active` dengan email ternormalisasi, `user_id` masih null.
6. Email instruksi akses dikirim lewat `email_outbox`.
7. Pembeli membuka app, memasukkan email, menerima OTP, memasukkan kode.
8. Setelah email terverifikasi, server menghubungkan entitlement ke user.
9. Pengguna diarahkan ke onboarding.

Jika API Scalev belum tersedia (BLOCKED): entitlement dibuat `pending_verification` dan admin meng-approve manual dari `/admin/purchases`.

### 6.2 Onboarding [v1.2: OPS-05]
Jalur minimum (wajib): Welcome → pilih wilayah (provinsi → kab/kota) atau jadwal manual → konfirmasi jadwal Subuh → Dashboard.
Langkah opsional (bisa dilewati, muncul lagi sebagai kartu di dashboard): penjelasan 3 level, target tidur, aktifkan notifikasi, panduan install PWA (Android, iOS, desktop).
`program_start_date` = tanggal lokal saat onboarding selesai.

### 6.3 Alur ibadah harian
Persiapan tidur → pengingat tahajud → salat malam → dzikir malam → doa dan tilawah → Qabliyah Subuh → salat Subuh → dzikir lanjutan (Level 3) → ringkasan sesi → dashboard.

### 6.4 Alur support [v1.2: OPS-01, OPS-03]
- Layar OTP: "Tidak menerima kode?" → cek spam, cek email yang dipakai saat checkout Scalev, kirim ulang (setelah 60 detik), tombol WhatsApp CS.
- Login dengan email tanpa entitlement: pesan generik di layar login; setelah verifikasi OTP, tampilkan `/access-status` "Belum ada akses aktif untuk email ini" + link beli + CS.
- Admin support dapat memindahkan entitlement ke email lain (salah ketik, hadiah untuk orang tua) setelah verifikasi manual. Wajib alasan, tercatat di audit.

---

## 7. UI/UX Design System

### 7.1 Arah kreatif
Warm Minimalist Islamic Wellness: tenang, hangat, bersih, modern, personal, nyaman dipakai malam hari.
Hindari: neon, animasi berlebihan, gamifikasi agresif, desain kompetitif, halaman padat.

### 7.2 Color tokens
| Token | HEX | Aturan pemakaian |
|-------|-----|------------------|
| sage | #88A189 | Dekorasi, ilustrasi, background chip dengan teks forest. Tidak boleh jadi warna teks di atas cream (kontras sekitar 2.6:1) [v1.2: DOC-06] |
| forest | #354F40 | CTA, teks utama, progress fill (sekitar 8.4:1 di atas cream) |
| cream | #FAF7ED | Background light |
| sand | #D9C6A5 | Milestone, highlight |
| olive | #B7BDA1 | Aksen sekunder, border lembut |
| earth | #25372F | Background dark (cream di atasnya sekitar 11.8:1) |

Tambahkan token semantik light & dark: success, warning, error, info, disabled, surface, surface-raised, border, text, text-muted. Semua pasangan teks/background lolos WCAG AA (4.5:1 teks normal, 3:1 teks besar dan komponen UI). Hasil uji kontras didokumentasikan.

Theme: ikuti sistem (default), Light, Dark, atau "Otomatis gelap antara Maghrib dan Subuh" [v1.2: OPS-06].

### 7.3 Tipografi
- Latin: Plus Jakarta Sans (fallback Inter).
- Arab: font yang mendukung Rasm Utsmani lengkap, harakat, tanda waqaf, dan karakter khusus dataset. Kandidat: Amiri Quran (OFL), KFGQPC Uthmanic Hafs (cek lisensi). Wajib uji visual pada Yasin dan Al-Kahfi.
- Ukuran: body 16px, helper 12-14px, judul kartu 18-20px, judul halaman 24-28px, Qur'an 30px default (atur 22-44px), dzikir Arab 26-34px.

### 7.4 Komponen
Rounded card, soft border, tombol besar, progress bar/ring, bottom nav, sidebar desktop, modal/sheet aksesibel, empty state, skeleton, status chip (ikon + label), offline banner, sync indicator, demo badge (khusus mode demo), transisi halus minimal.

### 7.5 Responsive
| Device | Layout |
|--------|--------|
| Mobile < 768px | Single column |
| Tablet 768-1023px | Grid adaptif |
| Desktop ≥ 1024px | Sidebar + content grid |
Berfungsi mulai lebar 320px.

### 7.6 Aksesibilitas (target WCAG 2.2 AA)
Touch target ≥ 44×44px; navigasi keyboard; label screen reader; `prefers-reduced-motion`; status tidak hanya warna; RTL Arab benar; focus state terlihat; pengaturan ukuran font Qur'an dan dzikir; teks app ikut zoom browser 200% tanpa terpotong.

### 7.7 Copy & label status [v1.2: OPS-11]
| Status sistem | Label UI | Ikon |
|---------------|----------|------|
| completed | Tuntas | centang |
| partial | Sebagian | setengah lingkaran |
| missed | Terlewat | lingkaran kosong |
| excused | Berhalangan | jeda |
| upcoming | Akan datang | jam |

Nada: suportif, tanpa shaming, tanpa menilai iman. Tanpa em-dash di copy UI.

---

## 8. Dashboard Istiqomah

### 8.1 Pertanyaan yang dijawab
Level aktif; jumlah sesi tuntas; perkembangan istiqomah; amalan paling konsisten; Subuh berikutnya; kapan mulai tahajud.

### 8.2 Layout
| Section | Isi |
|---------|-----|
| A. Header | Wordmark/logo NgajiGaes, salam, nama, ikon notifikasi, shortcut profil. Contoh: "Assalamu'alaikum, selamat melanjutkan perjalanan istiqomahmu." |
| B. Jadwal | Wilayah, tanggal & jam Subuh berikutnya, rekomendasi mulai tahajud, countdown (tidak pernah negatif), sumber data (Kemenag / Tersimpan / Diatur manual), waktu sinkron terakhir |
| C. Level aktif | Level, judul, sesi tuntas / target, progress bar, sisa, tombol ke perjalanan level |
| D. Ringkasan | Tuntas, Sebagian, Terlewat, completion rate. Filter 7/30/90 hari |
| E. Kalender | Status per tanggal (ikon + label). Klik → detail sesi |
| F. Performa amalan | Per amalan: total penyelesaian + progress bar |
| G. Insight | Template berdasarkan data aktual (§22.4) |
| H. CTA | "Mulai Ibadah Malam Ini" / "Lanjutkan Ibadah" / "Lihat Ringkasan Sesi" |
| I. Kartu setup | Muncul jika notifikasi belum aktif atau PWA belum terpasang [v1.2: OPS-05] |

### 8.3 State
Loading skeleton; akun baru (empty); offline; data jadwal tidak tersedia; data jadwal tersimpan (stale); belum ada sesi hari ini; sesi berjalan; sesi tuntas; mode berhalangan aktif. Angka dummy tanpa label demo dilarang.

---

## 9. Level Configuration & Content

### 9.1 Metadata level
| Level | Judul | Rakaat malam | Dzikir malam (hitungan) |
|-------|-------|--------------|-------------------------|
| 1 | Fondasi | 5 | 400 (600 dengan tahlil opsional) |
| 2 | Bertumbuh | 9 | 1.550 |
| 3 | Istikamah (lihat §30.2 soal ejaan) | 11 | 1.863 |
Hitungan dzikir tidak termasuk aktivitas setelah Subuh.

### 9.2 Level 1 (phase: night)
| Urut | Key | Aktivitas | Target | Required |
|------|-----|-----------|--------|----------|
| 1 | salat_taubat | Salat Taubat | 2 rakaat | Ya (PROV) |
| 2 | salat_tahajud | Salat Tahajud | 2 rakaat | Ya (PROV) |
| 3 | salat_witir_1 | Salat Witir | 1 rakaat | Ya (PROV) |
| 4 | istighfar | Istighfar (أَسْتَغْفِرُ اللَّهَ الْعَظِيمَ وَأَتُوبُ إِلَيْهِ) | 100 | Ya (PROV) |
| 5 | dzikir_shalawat | Shalawat | 100 | Ya (PROV) |
| 6 | dzikir_tahlil | Tahlil | 100 | Ya (PROV) |
| 7 | asma_rangkaian | Rangkaian Ya Fattah, Ya Razzaq, Ya Kafi, Ya Mughni | 100 putaran [v1.2.1] | Ya (PROV) |
| 8 | tahlil_tambahan | Tahlil tambahan (total 300) | 200 | Tidak |
| 9 | doa | Doa sesuai kebutuhan | checklist | Ya (PROV) |
| 10 | tilawah | Membaca Al-Qur'an sampai Subuh (panduan: sekitar 30-40 menit sebelum Subuh) | checklist, konfirmasi user | Ya (PROV) |

Catatan DOC-01 (selesai v1.2.1): 1 hitungan = 1 putaran keempat asma. Lafaz "Ya Kafi" (كافي). Urutan Level 1 sesuai teks owner: salat → istighfar → shalawat → tahlil → asma → doa → tilawah.

Sumber teks Arab, target, dan urutan semua level: `content/amalan.v1.json`. Tabel di §9 adalah ringkasan; jika berbeda, file JSON yang berlaku.

### 9.3 Level 2 (phase: night)
| Urut | Key | Aktivitas | Target |
|------|-----|-----------|--------|
| 1 | salat_taubat | Salat Taubat | 2 rakaat |
| 2 | salat_tahajud | Salat Tahajud | 2 rakaat |
| 3 | salat_hajat | Salat Hajat | 2 rakaat |
| 4a | salat_witir_2 | Salat Witir | 2 rakaat |
| 4b | salat_witir_1 | Salat Witir | 1 rakaat |
| 5 | dzikir_istighfar | Istighfar | 100 |
| 6 | asma_rangkaian | Ya Fattah, Ya Razzaq, Ya Kafi, Ya Mughni | 100 putaran |
| 7 | dzikir_shalawat | Shalawat | 300 |
| 8 | dzikir_hasbunallah | Hasbunallah wa ni'mal wakil | 450 |
| 9 | dzikir_hauqalah | La hawla wa la quwwata illa billah | 100 |
| 10 | dzikir_tahlil | Tahlil | 500 |
| 11 | doa | Doa | checklist |
| 12 | tilawah | Membaca Al-Qur'an sampai Subuh (panduan owner: "setengah jam atau 60 menit", perlu konfirmasi) | checklist |
Semua required (PROV).

### 9.4 Level 3 (phase: night)
Sama dengan Level 2, dengan perbedaan: salat_tahajud 4 rakaat; tambahan `dzikir_doa_nabi_yunus` 313 sebelum tahlil. Semua required (PROV).

### 9.5 Rangkaian Subuh (semua level, phase: fajr)
| Urut | Key | Aktivitas | Target | Required |
|------|-----|-----------|--------|----------|
| 1 | salat_qabliyah_subuh | Qabliyah Subuh. Panduan program: rakaat 1 Al-Insyirah, rakaat 2 Al-Fil setelah Al-Fatihah | 2 rakaat | Ya (PROV) |
| 2 | tasbih_malaikat | Tasbih malaikat setelah salam (سُبْحَانَ اللَّهِ وَبِحَمْدِهِ سُبْحَانَ اللَّهِ العَظِيْمِ أَسْتَغْفِرُ اللَّهَ) | 100 | Ya (PROV) [v1.2.1] |
| 3 | salat_subuh | Salat Fardu Subuh (usahakan berjamaah walau tidak di masjid) | checklist | Ya (PROV) |
| 4 | subuh_berjamaah | Berjamaah | checklist | Tidak |

App tidak boleh membuat user menunda salat fardu demi counter/checklist. User bebas mencatat sesuai urutan aktual, termasuk setelah salat.

### 9.6 Level 3 post-Fajr (phase: post_fajr, seluruh bagian PROV)
Teks Arab dari owner ada di `content/amalan.v1.json`. Owner menulis bagian ini di bawah Level 3; apakah juga berlaku untuk Level 1-2 belum dikonfirmasi.
| Key | Amalan | Target |
|-----|--------|--------|
| pf_istighfar_panjang | Istighfar panjang | 3 |
| pf_tahlil_panjang | Tahlil panjang | 10 |
| pf_antas_salam | Allahumma antas salam | 1 |
| pf_subhanallah | Subhanallah | 33 |
| pf_alhamdulillah | Alhamdulillah | 33 |
| pf_allahu_akbar | Allahu Akbar | 33 |
| pf_allahu_akbar_kabira | Allahu Akbar kabira dan rangkaiannya | 1 |
| pf_astaghfirullahal_azhim | Astaghfirullahal 'azhim | 3 |
| pf_tahlil | Tahlil | 100 |
| pf_al_waqiah | Al-Waqi'ah (link ke Reader) | 1 surah |
| pf_at_talaq_2_3 | QS. At-Talaq 65:2-3, dikenal sebagai "Ayat Seribu Dinar" | 1 bacaan |
| pf_doa_hajat | Doa hajat | 1 |

### 9.7 Metadata konten agama
Setiap aktivitas punya: activity key, teks Arab, transliterasi (jika ada), terjemahan (jika ada), deskripsi, referensi, klasifikasi sumber, status review, versi konten.

Klasifikasi: Sunnah dengan dalil khusus; Anjuran umum; Susunan wirid program/ijtihad pembimbing; Belum diverifikasi.

Aturan:
- Klasifikasi dan teks Arab tidak boleh diisi berdasarkan tebakan AI.
- Teks Arab hanya dari `content/amalan.v1.json` (dari owner). Agen tidak boleh mengubah atau menambah teks Arab.
- Status review konten owner: `submitted`. Naik ke `published` hanya setelah owner mengonfirmasi tanda tangan pembimbing.
- `source_classification` tetap `unverified` sampai diisi owner/pembimbing.
- Konten yang belum `published` tampil dengan badge "Menunggu review pembimbing" di mode non-produksi dan disembunyikan teks Arabnya di produksi.

---

## 10. Level Progression Engine

### 10.1 Target default (seluruhnya PROV)
| Level | Sesi tuntas dibutuhkan | Periode saran | Estimasi durasi ibadah |
|-------|------------------------|---------------|------------------------|
| 1 | 7 | 14 malam | 60 menit |
| 2 | 12 | 21 malam | 120 menit |
| 3 | 20 | 30 malam | 150 menit |

### 10.2 Formula
`progress(level N) = jumlah sesi completed dengan snapshot level N / required_successful_nights(level N)`
Contoh Level 1 target 7: tuntas, tuntas, terlewat, tuntas → 3/7. Hari terlewat tidak mengurangi.

### 10.3 Sesi tuntas (completed) [v1.2: BUG-06]
Sesi completed jika semua aktivitas `required_for_completion = true` dalam snapshot sesi itu selesai:
- checklist ditandai selesai;
- counter `actual_count >= target_count`;
- tilawah berdasarkan konfirmasi user (tanpa minimum halaman/durasi).
Status dihitung otomatis oleh server dari data aktivitas. Tombol "Selesaikan sesi" hanya membuka ringkasan, tidak mengubah status. Aktivitas opsional tidak memengaruhi status.

### 10.4 Missed (terlewat) [v1.2: BUG-01, BUG-07]
Untuk setiap tanggal D dengan `program_start_date ≤ D < activeSessionKey(now)`:
- tidak ada baris sesi, atau ada baris tetapi tidak ada aktivitas dengan progres > 0, dan tidak excused → **missed**.
Missed dihitung saat dibaca (derived), tidak perlu job yang membuat baris untuk setiap user setiap malam. Progress tetap.

### 10.5 Partial (sebagian)
Minimal satu aktivitas punya progres > 0, tetapi requirement belum lengkap saat cutoff. Aktivitas tetap masuk statistik per amalan, tidak menambah sesi tuntas.

### 10.6 Berhalangan (excused) [v1.2: PRIV-01, OPS-12]
- User menandai satu sesi atau rentang tanggal (maksimal 15 hari per aksi, PROV) sebagai berhalangan, tanpa alasan dan tanpa kategori.
- Tidak menambah sesi tuntas, tidak mengurangi progress, tidak dihitung di completion rate.
- Selama berhalangan, user tetap bisa mencatat dzikir; dicatat di statistik amalan tetapi tidak memengaruhi status sesi (PROV, perlu persetujuan pembimbing).
- Bisa dibatalkan selama masih dalam jendela koreksi.
- Data excused tidak pernah tampil per user di admin (§18.2).

### 10.7 Unlock [v1.2: BUG-02]
- Level N+1 terbuka saat sesi completed ke-`required_successful_nights` di Level N tercapai.
- Berlaku mulai sesi berikutnya. Sesi yang sedang berjalan tidak berubah (snapshot).
- Level monoton: sekali terbuka, tidak pernah terkunci lagi, walau koreksi kemudian mengurangi jumlah sesi tuntas di Level N.
- `user_level_state` menyimpan `current_level`, `unlocked_at` per level, `effective_from_session_key`.

### 10.8 Level 3 selesai
Milestone "Istikamah Journey Completed". User tetap di Level 3, tracking berlanjut tanpa Level 4.

---

## 11. Night Session Lifecycle

### 11.1 Identitas sesi [v1.2: BUG-05]
- Session key = tanggal Subuh lokal (`fajr_local_date`). Contoh: malam 12 Nov menuju Subuh 13 Nov → `2026-11-13`.
- `cutoff(D)` = 12.00 waktu lokal wilayah pada tanggal D (PROV).
- `activeSessionKey(now)`: jika `now < cutoff(localDate(now))` maka `localDate(now)`, selain itu `localDate(now) + 1 hari`.
- `now` = waktu server. Tanggal lokal dihitung dengan timezone wilayah sesi (Asia/Jakarta, Asia/Makassar, Asia/Jayapura, atau timezone jadwal manual).

### 11.2 Jendela sesi
- Sesi bisa dipersiapkan sejak setelah cutoff hari sebelumnya.
- Fase malam sebelum Subuh, fase fajr dan post_fajr setelah Subuh, semua dalam session key yang sama.
- Cutoff penutupan: 12.00 lokal pada tanggal Subuh (PROV). Cutoff adalah aturan administrasi tracking, bukan batas waktu ibadah.
- Jendela koreksi: sampai 48 jam setelah cutoff (PROV).

### 11.3 State machine
```
scheduled ──► in_progress ──► completed
    │              │
    │              └──► partial      (saat finalisasi, requirement belum lengkap)
    ├──► missed                      (derived, §10.4)
    └──► excused ◄── in_progress
```
- Baris sesi dibuat lazy (idempotent) saat interaksi pertama: `POST /me/night-sessions` dengan session key dari server.
- Finalisasi (`completed`/`partial` → `closed_at` terisi) terjadi saat sesi dibaca setelah cutoff, ditambah job harian sebagai pengaman.
- Koreksi dalam jendela 48 jam boleh mengubah status final; tercatat di `session_audit_logs`.

### 11.4 Transisi Subuh
Saat waktu Subuh masuk: tampilkan banner fase Subuh, pisahkan aktivitas malam dan Subuh, jangan auto-centang, jangan hapus aktivitas malam yang belum lengkap (tetap bisa dicatat sampai cutoff), countdown berganti ke "Waktu Subuh telah masuk".

### 11.5 Multi-perangkat dan perjalanan [v1.2: BUG-08]
- Satu baris sesi untuk `(user_id, fajr_local_date)`.
- Timezone, region, level, dan config version dibekukan saat sesi dibuat. Perubahan wilayah berlaku mulai sesi berikutnya.
- Sinkronisasi multi-perangkat: counter memakai delta idempoten; checklist memakai `version` (optimistic concurrency, konflik → ambil nilai server lalu terapkan ulang aksi user jika masih relevan).

---

## 12. Dzikir Counter Engine

### 12.1 UI
Header; nama dzikir; teks Arab (atau badge review jika belum ada); toggle transliterasi; target; hitungan; progress ring; tombol tap besar (minimal 160×160px di mobile) [v1.2: BUG-19]; tombol minus; reset dengan konfirmasi; konfirmasi selesai; indikator sinkron ("Tersimpan di perangkat" / "Tersinkron"); toggle "Layar tetap menyala" via Screen Wake Lock API jika didukung [v1.2: BUG-18]; getar ringan saat target tercapai jika didukung.
CSS: `touch-action: manipulation`, `user-select: none`.

### 12.2 Perilaku
- Tap +1, tampil instan dari state lokal.
- Hitungan tidak pernah negatif.
- Tersimpan lokal setiap tap (IndexedDB), aman jika app ditutup.
- Target tercapai saat `count >= target`: tampilkan konfirmasi. Tap lanjutan tetap dihitung, tampil "+N lebih" [v1.2: BUG-17].
- Disimpan per `session_activity_id`.

### 12.3 Sinkronisasi [v1.2: BUG-03, BUG-09]
- Tap di-buffer. Flush menjadi satu operasi delta setiap 2 detik, saat target tercapai, saat pindah halaman, atau saat `visibilitychange` ke hidden.
- Setiap operasi: `operation_id` (UUID v4 dari client), `session_activity_id`, `delta` (bilangan bulat, -1000 sampai 1000), `client_recorded_at`.
- Server: `UNIQUE (user_id, client_operation_id)`; terapkan sekali dalam satu transaksi (`apply_counter_operation`), simpan `server_applied_at`. Operasi duplikat mengembalikan hasil yang sama tanpa menambah.
- `client_recorded_at` lebih dari 5 menit di masa depan di-clamp ke waktu server.
- Tampilan = hitungan server terakhir + delta lokal yang belum terkirim.
- Operasi ditolak jika sesi sudah di luar jendela koreksi.

### 12.4 Reset [v1.2: BUG-10]
Reset butuh konfirmasi. Dicatat sebagai operasi `set_zero` (correction event) yang bisa diaudit. Server menjadikan hitungan 0; delta yang diterima setelahnya tetap diterapkan. Riwayat operasi tidak dihapus.

---

## 13. Quran Reader

### 13.1 Konten
| Surah | No. | Ayat |
|-------|-----|------|
| Yasin | 36 | 83 |
| Al-Waqi'ah | 56 | 96 |
| Al-Mulk | 67 | 30 |
| Ar-Rahman | 55 | 78 |
| Al-Kahfi | 18 | 110 |
| At-Talaq | 65 | ayat 2-3 |

### 13.2 Sumber
Tanzil Uthmani atau sumber terverifikasi lain yang disetujui owner.
- Teks tidak diubah sama sekali; diimport dengan script, disimpan bersama checksum SHA-256 file sumber, versi, atribusi, dan teks lisensi.
- Validasi sebelum publish: jumlah ayat per surah cocok, checksum cocok.
- Terjemahan Indonesia memakai izin terpisah (BLOCKED sampai sumber berizin dipilih).

### 13.3 UI
Header surah; teks Arab RTL; penanda ayat; toggle terjemahan; kontrol ukuran font; bookmark; ayat terakhir dibaca; progress baca; mode malam; tombol tandai selesai; atribusi sumber di akhir surah.

### 13.4 Tracking
`quran_reading_progress` (per user per surah): ayat terakhir, status, waktu baca terakhir, waktu selesai. Progress berlanjut antarhari. Penyelesaian per sesi disimpan terpisah di `session_quran_completions`.

### 13.5 Al-Kahfi
Jendela: Kamis setelah Maghrib lokal sampai Jumat sebelum Maghrib lokal. Badge "Bacaan Jumat" + reminder opsional. Tanpa data Maghrib (jadwal manual), jendela memakai pendekatan Kamis 18.00 sampai Jumat 18.00 lokal dengan label "perkiraan".

### 13.6 Keamanan konten
Output AI tidak pernah dipakai sebagai teks ayat. Jika dataset gagal dimuat: tampilkan cache valid atau error state. Tidak ada fallback ayat buatan. Konten Qur'an tidak bisa diedit lewat CMS; yang dikelola hanya versi dataset dan metadata.

---

## 14. Prayer Time Engine

### 14.1 Sumber utama
SIHAT Kementerian Agama RI melalui backend adapter (VERIFY ketersediaan API, syarat izin, format). Token tidak pernah ke browser.

### 14.2 Wilayah
Pilih provinsi → kabupaten/kota. GPS hanya untuk menyarankan wilayah; izin lokasi tidak wajib; koordinat presisi tidak disimpan.

### 14.3 Model data
region_id, nama wilayah, timezone, tanggal lokal, fajr_at, maghrib_at, provider, versi/metode provider jika ada, fetched_at, valid_until.

### 14.4 Refresh
Ambil saat onboarding; cache per wilayah per bulan (sesuai izin provider); refresh otomatis 7 hari sebelum data habis; hitung ulang saat wilayah atau tanggal lokal berubah; selalu pakai timezone wilayah.

### 14.5 Kegagalan dan jadwal manual [v1.2: BUG-04]
Jika provider gagal:
1. Pakai cache yang masih berlaku untuk tanggal itu, label "Jadwal tersimpan".
2. Tombol refresh.
3. Data yang tanggalnya tidak tersedia tidak boleh ditampilkan sebagai jadwal terverifikasi.
4. Tawarkan "Atur jadwal manual".

Jadwal manual: user mengisi jam Subuh (dan opsional Maghrib) serta timezone. Label "Diatur manual" di semua tempat jadwal tampil. Dipakai juga untuk user di luar Indonesia. Fallback provider lain hanya setelah metode dan selisihnya dievaluasi.

### 14.6 Smart wake-up planner
`wake = fajr - estimasi_durasi_level - buffer_persiapan`
Default durasi 60/120/150 menit, buffer 10 menit (PROV). User bisa mengubah.
Jika `wake - target_tidur < 5 jam` (PROV): tampilkan saran netral, contoh "Jadwalmu menyisakan sekitar 4 jam tidur. Mau coba tidur lebih awal atau memakai durasi ibadah yang lebih singkat?" [v1.2: BUG-20].

---

## 15. Notification System

### 15.1 Jenis
| Type | Pemicu | Kedaluwarsa (PROV) [v1.2: BUG-15] |
|------|--------|-----------------------------------|
| bedtime | target tidur - offset | 30 menit |
| tahajud | jam bangun hasil planner | 15 menit |
| fajr | masuk waktu Subuh | 20 menit |
| alkahfi | Kamis malam/Jumat | 6 jam |
| achievement | unlock milestone | 24 jam |

### 15.2 Bedtime copy dinamis
Bank 30-90 pesan yang sudah disetujui. Kategori: persiapan tidur, refleksi malam, motivasi, istiqomah, menjaga energi, doa dan harapan.
Rotasi: maksimal 1 bedtime per malam per user; pesan berbeda setiap hari selama stok ada; hindari 14 pengiriman terakhir; jika semua sudah terpakai dalam 14 terakhir, pilih yang paling lama tidak dikirim. Variabel template hanya whitelist (`{nama}`, `{level}`).

### 15.3 Arsitektur pengiriman
- Izin notifikasi diminta hanya setelah layar penjelasan dan tap user. Di iOS, tombol aktivasi hanya muncul jika app berjalan sebagai PWA terpasang (iOS 16.4+), selain itu tampil panduan install [v1.2: OPS-07].
- Browser subscribe → server simpan per perangkat.
- Scheduler (job tiap menit, §16.2) membuat `notification_jobs` untuk 36 jam ke depan.
- Worker mengirim Web Push (VAPID). Service worker menampilkan notifikasi; klik membuka URL terkait.

### 15.4 Keandalan
Push bersifat best effort. Aturan: tidak mengirim yang sudah kedaluwarsa; `dedupe_key = user_id:type:local_date` unik; reschedule saat wilayah, jam tidur, level, atau preferensi berubah; multi-perangkat; subscription yang dibalas 404/410 dinonaktifkan; quiet hours dihormati (kecuali user memilih tahajud & fajr tetap dikirim); app tidak menjanjikan akurasi alarm. Selalu sarankan alarm perangkat sebagai cadangan.

---

## 16. Technical Architecture

### 16.1 Stack (rekomendasi)
| Layer | Pilihan |
|-------|---------|
| Frontend | Next.js App Router + TypeScript strict |
| Styling | Tailwind CSS + shadcn/ui |
| Server | Next.js Route Handlers `/api/v1` |
| DB | PostgreSQL (Supabase) |
| Auth | Supabase Auth (email OTP, MFA untuk admin) |
| Otorisasi | Guard di API + RLS sebagai lapis kedua |
| Job | Tabel `jobs` + worker Edge Function dipicu `pg_cron` tiap menit (atau Supabase Queues/pgmq) [v1.2: OPS-04] |
| Email | Provider transaksional (mis. Resend/SES) dengan domain sendiri, SPF/DKIM/DMARC [v1.2: OPS-02] |
| Rate limit | Tabel Postgres atau Redis terkelola |
| PWA | Web manifest + service worker |
| Offline | IndexedDB |
| Push | Web Push + VAPID |
| Deploy | Vercel + Supabase |
| Monitoring | Error tracking (mis. Sentry) + structured logs |
Stack boleh diganti jika kemampuannya setara.

### 16.2 Arsitektur tingkat tinggi
```
Scalev ──webhook──► /api/v1/webhooks/scalev ──► webhook_events + jobs
                                                    │
                     pg_cron (tiap menit) ──► worker ├─► Scalev API (verifikasi order)
                                                    ├─► access_entitlements
                                                    ├─► email_outbox ──► email provider
                                                    ├─► prayer_times ◄── SIHAT
                                                    └─► notification_jobs ──► Web Push
PWA (browser) ──► /api/v1/* (JWT user, RLS) ──► PostgreSQL
PWA ──► Supabase Auth (OTP saja)
```

### 16.3 Tanggung jawab frontend
Render UI; state lokal; antrean offline; service worker; countdown; input counter; navigasi; state loading/error. Frontend bukan sumber kebenaran untuk status beli, status sesi, atau kelulusan level.

### 16.4 Tanggung jawab backend [v1.2: SEC-03]
Verifikasi transaksi; entitlement; autentikasi; otorisasi (auth + entitlement aktif + role); status sesi dan progression; operasi counter; jadwal salat; penjadwalan notifikasi; laporan; audit.
Aturan akses data:
- Browser hanya memakai Supabase untuk Auth.
- `/api/v1` memakai Supabase client dengan JWT user, sehingga RLS tetap berlaku.
- Service role hanya di webhook, worker, dan server action admin.

### 16.5 Lingkungan [v1.2: OPS-09]
| Env | DB | Scalev | Data mode |
|-----|----|--------|-----------|
| development | Supabase lokal / project dev | fixture | mock atau live |
| staging | project staging | webhook staging (jika Scalev mendukung, VERIFY) | live |
| production | project production | webhook production | live, mock dinonaktifkan saat build |

---

## 17. Database Schema v1.2

UUID untuk primary key kecuali disebut lain. Semua timestamp `TIMESTAMPTZ` (UTC). Tabel punya `created_at`, `updated_at` jika relevan.

### 17.1 User & akses
**profiles**: user_id PK → auth.users; display_name; email_normalized UNIQUE; region_id nullable; manual_schedule JSONB nullable (fajr, maghrib, timezone); program_start_date DATE nullable; onboarding_completed BOOL; theme_pref; quran_font_size; dhikr_font_size; created_at; updated_at.
Timezone efektif diturunkan dari region atau manual_schedule [v1.2: BUG-14].

Normalisasi email: trim, lowercase, Unicode NFC. Tidak menghapus titik atau `+tag`.

**user_roles**: user_id; role (`super_admin`, `content_admin`, `support_admin`, `reporting_admin`); granted_by; granted_at. PK (user_id, role).

**user_devices** [v1.2: SEC-15]: id; user_id; label; user_agent_summary; last_seen_at; revoked_at. Batas perangkat aktif 3 (PROV).

**purchase_orders**: id; scalev_order_id UNIQUE; customer_email_normalized; buyer_name; payment_status; amount; currency; verified_via (`scalev_api` / `admin_manual`); payment_verified_at; created_at; updated_at.

**purchase_order_items**: id; purchase_order_id; product_id; variant_id; quantity.

**access_entitlements**: id; user_id nullable; email_normalized; purchase_order_id; entitlement_type (`lifetime` PROV); status (`pending_verification`, `active`, `suspended`, `revoked`, `expired`); starts_at; expires_at nullable; revoked_at; revoke_reason; transferred_from_email nullable. UNIQUE (purchase_order_id, entitlement_type) untuk dedupe fulfillment.

**webhook_events**: id; provider; external_event_id (atau SHA-256 raw body jika ID tidak ada) [v1.2: BUG-16]; event_type; payload_minimal JSONB (field yang dibutuhkan saja); payload_encrypted BYTEA nullable (dihapus otomatis setelah 90 hari, PROV) [v1.2: SEC-07]; payload_sha256; received_at; processed_at; process_status (`received`, `processing`, `awaiting_order_verification`, `done`, `failed`, `ignored`); attempt_count; error_message. UNIQUE (provider, external_event_id). Hanya disimpan setelah signature valid.

### 17.2 Level & aktivitas
**levels**: id; level_number UNIQUE; title; description; required_successful_nights; suggested_period_nights; estimated_duration_minutes; provisional BOOL; is_active.

**activity_definitions**: id; activity_key UNIQUE; activity_type (`prayer`, `dhikr`, `checklist`, `quran`); title; arabic_text nullable; transliteration; meaning; description; counter_unit (mis. "putaran"); source_reference; source_classification; review_status (`draft`, `in_review`, `approved`, `published`); published_version.

**level_activity_config**: id; level_id; activity_definition_id; sequence_order; phase (`night`, `fajr`, `post_fajr`); required_for_completion; target_count; config_version; provisional BOOL; is_active.

**content_versions**: id; content_type; content_id; version_number; snapshot_json; status; submitted_by; reviewer_id; approved_at; published_at.

**user_level_state** [v1.2: BUG-02]: user_id PK; current_level; level_1_unlocked_at; level_2_unlocked_at; level_3_unlocked_at; journey_completed_at; effective_from_session_key.

**app_settings**: key PK; value JSONB; provisional BOOL; updated_by; updated_at. Berisi cutoff, jendela koreksi, batas perangkat, kedaluwarsa notifikasi, ambang tidur, dll.

### 17.3 Tracking ibadah
**night_sessions**: id; user_id; fajr_local_date DATE; timezone; region_id nullable; schedule_source (`provider`, `cached`, `manual`); level_number; level_config_version; status; started_at; completed_at; closed_at; excused_at; version INT. UNIQUE (user_id, fajr_local_date).

**session_activities**: id; session_id; activity_definition_id; activity_config_snapshot JSONB; phase; target_count; actual_count; required_for_completion; status; completed_at; version INT.

**counter_operations**: id; user_id; client_operation_id; session_activity_id; op_type (`delta`, `set_zero`); delta; resulting_count; client_recorded_at; server_applied_at. UNIQUE (user_id, client_operation_id) [v1.2: SEC-13].

**session_audit_logs**: id; session_id; actor_id; operation_type; previous_value JSONB; new_value JSONB; occurred_at.

### 17.4 Qur'an
**quran_sources**: id; name; version; file_sha256; license_text; attribution; imported_at.
**quran_surahs**: surah_number; arabic_name; latin_name; verse_count; source_id.
**quran_verses**: surah_number; verse_number; arabic_uthmani; source_id. UNIQUE (surah_number, verse_number, source_id).
**quran_translations**: surah_number; verse_number; text; translation_source_id (terpisah, BLOCKED sampai izin ada).
**quran_reading_progress**: PK (user_id, surah_number); last_verse; status; updated_at; completed_at.
**session_quran_completions**: user_id; session_id; surah_number; completion_type; completed_at.

### 17.5 Notifikasi
**notification_preferences**: user_id PK; bedtime_enabled; bedtime_local_time; bedtime_offset_minutes; tahajud_enabled; fajr_enabled; alkahfi_enabled; quiet_hours_start; quiet_hours_end; quiet_hours_allow_worship BOOL. (Kolom timezone dihapus) [v1.2: BUG-14].
**push_subscriptions**: id; user_id; device_id; endpoint UNIQUE; p256dh; auth (kolom tidak pernah dikembalikan ke client); is_active; created_at; last_success_at; failure_count.
**notification_templates**: id; category; title; body; is_active; version; review_status; approved_at.
**notification_jobs**: id; user_id; notification_type; scheduled_at; expires_at; local_schedule_date; template_id; status; dedupe_key UNIQUE; attempt_count.
**notification_deliveries**: id; job_id; subscription_id; delivery_status; attempted_at; provider_status_code.

### 17.6 Jadwal salat
**regions**: id; province_name; city_name; provider_region_code; timezone; is_supported.
**prayer_times**: id; region_id; local_date; fajr_at; maghrib_at; provider; fetched_at; valid_until; source_revision. UNIQUE (region_id, local_date, provider).

### 17.7 Sistem [v1.2: DOC-05]
**jobs**: id; job_type; payload JSONB; status (`queued`, `running`, `done`, `failed`, `dead`); run_after; attempt_count; max_attempts; last_error; locked_at; locked_by. Worker mengambil job dengan `FOR UPDATE SKIP LOCKED`; retry dengan exponential backoff; status `dead` tampil di admin.
**email_outbox**: id; to_email; template_key; payload; status; attempt_count; sent_at; provider_message_id.
**rate_limits**: key; window_start; count. PK (key, window_start).
**data_deletion_requests**: id; user_id; requested_at; processed_at; status.
**admin_audit_logs**: id; actor_id; entity_type; entity_id; action; before JSONB; after JSONB; reason; approval_reference; occurred_at.

---

## 18. Database Security & Access Rules

### 18.1 Data pengguna
User hanya bisa membaca miliknya sendiri: profile, sesi, aktivitas, progress Qur'an, preferensi notifikasi, perangkat. Semua penulisan lewat `/api/v1` atau RPC `SECURITY DEFINER` yang memvalidasi kepemilikan dan entitlement [v1.2: SEC-03]. Role `authenticated` tidak punya hak INSERT/UPDATE/DELETE langsung pada tabel tracking.

### 18.2 Data admin [v1.2: SEC-09, PRIV-01]
| Role | Boleh | Tidak boleh |
|------|-------|-------------|
| super_admin | Semua, termasuk kelola role | Melihat detail ibadah user tanpa alasan tercatat di audit |
| content_admin | Level, aktivitas, template notifikasi, metadata Qur'an | Data user, order |
| support_admin | Akun, email, entitlement, order, resend email, transfer entitlement dengan alasan | Detail sesi ibadah, pola excused |
| reporting_admin | Agregat (minimal 20 user per grup) | Data per user |
Semua admin wajib MFA. Role dicek di server di setiap request.

### 18.3 Tabel backend-only
webhook_events, purchase_orders, purchase_order_items, access_entitlements (tulis), notification_jobs, notification_deliveries, jobs, email_outbox, rate_limits, admin_audit_logs, session_audit_logs (tulis), user_roles. Tidak ada akses tulis dari browser.

### 18.4 RLS
RLS aktif di semua tabel di schema yang terekspos. Policy baca user: `user_id = auth.uid()`. API tetap memeriksa entitlement aktif. Route guard frontend bukan satu-satunya perlindungan. Test RLS otomatis wajib.

---

## 19. API Contracts v1.2

Prefix `/api/v1`. Endpoint internal Tahajud Tracker, bukan endpoint Scalev/SIHAT. Semua endpoint privat butuh sesi login + entitlement aktif, kecuali auth, `/me/access`, dan webhook.

Aturan umum:
- Validasi request dengan schema (Zod) yang dibagi dengan frontend.
- Error format: `{ error: { code, message, details? } }`, kode stabil (mis. `ENTITLEMENT_INACTIVE`, `SESSION_LOCKED`, `RATE_LIMITED`).
- Respons: `Cache-Control: private, no-store` [v1.2: SEC-05].
- Mutasi: cek header `Origin` [v1.2: SEC-11].

### 19.1 Auth & akses
| Method | Endpoint | Fungsi |
|--------|----------|--------|
| POST | /auth/request-otp | Minta kode. Respons selalu generik |
| POST | /auth/verify-otp | Verifikasi kode, buat sesi, link entitlement |
| GET | /me | Profil login |
| GET | /me/access | authenticated, access_status, entitlement_type, expires_at, onboarding_completed |
| POST | /auth/logout | Logout perangkat ini |
| GET | /me/devices | Daftar perangkat |
| DELETE | /me/devices/:id | Logout perangkat lain |

### 19.2 Profil & onboarding
GET/PATCH `/me/profile`; PUT `/me/location` (region atau jadwal manual); PUT `/me/preferences`; POST `/me/onboarding/complete`; POST `/me/data-export`; POST `/me/delete-account`.

### 19.3 Jadwal salat
GET `/regions`; GET `/prayer-times?region_id&from&to`; GET `/me/next-fajr`; GET `/me/wake-plan`.
Respons memuat: region, local_date, timezone, fajr_at, maghrib_at (jika diminta), source (`provider`/`cached`/`manual`), cache_status, fetched_at.

### 19.4 Ibadah
| Method | Endpoint | Fungsi |
|--------|----------|--------|
| GET | /me/current-level | Level aktif |
| GET | /me/level-progress | Progress per level |
| GET | /me/night-session | Sesi aktif (key dihitung server) |
| POST | /me/night-sessions | Buat/ambil sesi aktif (idempoten) |
| GET | /night-sessions/:id | Detail (cek kepemilikan) |
| PUT | /session-activities/:id/status | Update checklist, wajib kirim `version` |
| POST | /session-activities/:id/counter-operations | Batch operasi counter (maks 50 per request) |
| GET | /night-sessions/:id/summary | Ringkasan sesi |
| POST | /me/excuse | Tandai berhalangan: satu tanggal atau rentang |
| DELETE | /me/excuse/:date | Batalkan (dalam jendela koreksi) |

Respons counter: per operasi `operation_id`, `accepted` / `duplicate`, `authoritative_count`, `target`, `completed`, `updated_at`.
Respons ringkasan/completion: session_id, session_status, successful_nights_at_level, required_successful_nights, current_level, next_level_unlocked, next_level_effective_session_key. Semua dihitung server.

### 19.5 Laporan
GET `/me/dashboard`, `/me/reports?period=7|30|90`, `/me/calendar?from&to`, `/me/activity-stats`, `/me/session-history`.
Dashboard minimal: level, level_progress, prayer_time, status_counts, completion_rate (null jika penyebut 0), calendar_days, activity_statistics, insight, current_session, setup_cards.

### 19.6 Qur'an
GET `/quran/surahs`; GET `/quran/surahs/:id` (termasuk atribusi dan source version); GET `/me/quran-progress`; PUT `/me/quran-progress/:surah`; POST `/me/quran-completions`.

### 19.7 Notifikasi
GET/PUT `/me/notification-preferences`; POST `/me/push-subscriptions`; DELETE `/me/push-subscriptions/:id` (cek user_id) [v1.2: SEC-14]; GET `/me/notifications`.

### 19.8 Webhook Scalev
`POST /api/v1/webhooks/scalev`
1. Tolak body > 256 KB.
2. Baca raw body.
3. Verifikasi header signature (PRD v1.1 menyebut `X-Scalev-Hmac-Sha256`, VERIFY ke dokumentasi Scalev) dengan HMAC-SHA256 secret aktif atau secret sebelumnya (rotasi), constant-time compare [v1.2: SEC-06].
4. Signature tidak valid → 401, catat metadata saja (tanpa body).
5. Parse, simpan event (idempoten), enqueue job.
6. Balas 200 setelah tersimpan durable. Tanpa email atau panggilan API panjang di request ini.

---

## 20. Scalev Payment Integration

### 20.1 Event (VERIFY nama event)
order.created, order.updated, order.payment_status_changed, payment.received, payment.failed. `payment.received` jadi pemicu utama, tetapi tidak cukup sendiri (§20.3).

### 20.2 Idempotensi
- Level event: UNIQUE (provider, external_event_id), fallback hash body.
- Level fulfillment: UNIQUE (purchase_order_id, entitlement_type). Paid → settled tidak membuat akses kedua.
- Event datang tidak berurutan: status order ditentukan dari data terbaru hasil fetch API, bukan urutan event.

### 20.3 Verifikasi order [v1.2: SEC-02]
Worker untuk event pembayaran:
1. Fetch order dari API Scalev memakai API key server.
2. Cocokkan: status bayar lunas, product/variant ada di allowlist env `SCALEV_ALLOWED_VARIANT_IDS`, email, nominal.
3. Valid → entitlement `active`, enqueue email akses.
4. Detail order belum tersedia → `awaiting_order_verification`, retry backoff (1, 5, 15, 60 menit, lalu tiap 6 jam sampai 3 hari), lalu `dead` dan muncul di admin.
5. API Scalev tidak tersedia (BLOCKED) → entitlement `pending_verification`, admin approve manual dengan audit.

### 20.4 Provisioning akun
Entitlement dihubungkan lewat email ternormalisasi, tetapi hanya setelah pemilik email lolos OTP. Pembelian untuk orang lain atau email salah ketik ditangani admin dengan fitur transfer entitlement (alasan wajib, audit, email notifikasi ke alamat lama dan baru) [v1.2: OPS-03].

### 20.5 Refund & suspensi
Status refund/reversal hanya dari data resmi Scalev (fetch API) atau proses admin teraudit. Tidak menonaktifkan akses dari informasi yang tidak terverifikasi. Data historis user tidak dihapus saat akses dicabut. Kebijakan detail mengikuti keputusan bisnis (PROV).

---

## 21. Offline-First Sync

### 21.1 Fitur offline
Lihat data sesi yang sudah ada; centang checklist; counter dzikir; baca surah yang sudah dicache; lihat jadwal tersimpan yang masih berlaku.
App memanggil `navigator.storage.persist()` saat onboarding [v1.2: BUG-12]. Server tetap sumber final.

### 21.2 Antrean
IndexedDB, database terpisah per user (`tahajud-<user_id>`). Setiap mutasi: operation_id, user_id, entity_id, operation_type, payload, client_timestamp, sync_status, attempt_count. Sinkron saat online, saat app dibuka, dan via Background Sync jika didukung.

### 21.3 Konflik
Server sumber final. Counter: delta idempoten. Checklist: versioning; konflik diselesaikan dengan nilai server lalu aksi user diterapkan ulang jika masih valid; user diberi tahu jika aksinya tidak bisa diterapkan (mis. sesi sudah lewat jendela koreksi). Tidak ada data yang dibuang diam-diam. Operasi dari akun berbeda tidak tercampur.

### 21.4 Logout [v1.2: BUG-11, SEC-05]
- Jika ada operasi belum tersinkron: dialog "Ada X catatan belum tersinkron". Pilihan: Sinkronkan dulu / Keluar dan buang catatan (konfirmasi kedua).
- Hapus token sesi, hapus database IndexedDB user, hapus cache Qur'an tidak perlu (teks Qur'an boleh tetap karena publik).
- Service worker tidak pernah menyimpan respons `/api/`.

---

## 22. Reporting Engine

### 22.1 Metrik
Total sesi; tuntas; sebagian; terlewat; berhalangan; completion rate; frekuensi penyelesaian per amalan; progress level aktif.

### 22.2 Formula [v1.2: BUG-13]
`completion_rate = completed / (completed + partial + missed) × 100%`
- Periode dihitung mulai `max(program_start_date, awal filter)` sampai sesi terakhir yang sudah lewat cutoff.
- Excused dan upcoming tidak dihitung.
- Penyebut 0 → tampil "Belum ada data", bukan 0%.
- Contoh: 4 tuntas, 2 sebagian, 1 terlewat → 4/7 = 57,14%.

### 22.3 Integritas historis
Laporan memakai snapshot level dan requirement saat sesi berlangsung. Perubahan admin hari ini tidak mengubah laporan masa lalu.

### 22.4 Insight
Template: sesi tuntas pertama; milestone progress; peningkatan; konsistensi stabil; kembali setelah jeda. Hindari: skor spiritual, ranking, notifikasi yang membuat malu, kesimpulan tentang iman.

### 22.5 Agregat admin [v1.2: PRIV-01]
Hanya agregat dengan minimal 20 user per grup. Statistik excused tidak dipecah per user atau per tanggal per user.

---

## 23. Admin

### 23.1 Dashboard admin
Entitlement aktif; onboarding selesai; engagement agregat; distribusi level; kesehatan integrasi (Scalev, SIHAT, email, push); job gagal/dead; status sinkron jadwal salat.

### 23.2 Amalan manager
Ubah judul, urutan, target, fase, required/optional, deskripsi, referensi, satuan counter. Semua perubahan lewat draft → review → publish. Perubahan target hanya berlaku untuk sesi baru.

### 23.3 Workflow review
Draft → In Review → Approved → Published. Konten agama butuh persetujuan reviewer yang ditunjuk (bukan pembuat draft yang sama).

### 23.4 Notification CMS [v1.2: SEC-10]
Tambah/edit template (plain text, variabel whitelist), preview mobile, kategori, nonaktifkan, riwayat pengiriman agregat.

### 23.5 Support tools
Cari user/order by email atau order ID; kirim ulang email akses; approve manual entitlement `pending_verification`; transfer entitlement; suspend/revoke dengan alasan.

### 23.6 Audit
Setiap perubahan penting menyimpan actor, entity, action, before/after, alasan, approval reference, timestamp. Audit log tidak bisa diedit atau dihapus dari UI.

---

## 24. Security & Privacy

### 24.1 Autentikasi [v1.2: SEC-01, SEC-04, SEC-11, SEC-12]
- OTP 6 digit, berlaku 10 menit, maksimal 5 percobaan per kode.
- Rate limit: 5 permintaan OTP per email per jam, 10 per IP per jam; jeda kirim ulang 60 detik.
- Respons request OTP selalu sama, apa pun status email (anti enumeration).
- Magic link opsional: membuka halaman konfirmasi dengan tombol "Masuk", bukan login otomatis saat link dibuka.
- Cookie sesi: Secure, HttpOnly, SameSite=Lax. Validasi Origin untuk mutasi.
- Parameter redirect hanya path internal dari allowlist.
- Sesi user 30 hari dengan refresh (PROV); admin 8 jam.
- Email via custom SMTP domain sendiri dengan SPF, DKIM, DMARC.

### 24.2 Otorisasi
Entitlement aktif wajib untuk fitur berbayar. Role admin dicek di server. RLS aktif. Service key tidak pernah ada di bundle frontend.

### 24.3 Secret [v1.2: SEC-16]
Disimpan di secret manager platform: Scalev API key, Scalev webhook secret (+ previous), SIHAT token, Supabase service role, VAPID private key, email API key. CI menjalankan secret scan dan dependency audit; lint melarang env `NEXT_PUBLIC_` yang mengandung SECRET/KEY privat/SERVICE_ROLE.

### 24.4 Privasi [v1.2: PRIV-02, PRIV-04, SEC-07]
- Tanpa leaderboard publik.
- Tidak menyimpan isi doa pribadi.
- Tidak menyimpan alasan excused.
- Tidak menyimpan GPS presisi.
- Payload webhook mentah dihapus setelah 90 hari (PROV).
- Hapus akun: data ibadah, profil, push, progress Qur'an dihapus dalam 30 hari; order dan entitlement dianonimkan (email diganti hash) dan disimpan sesuai retensi bisnis.
- User bisa mengunduh datanya (JSON).
- Tidak ada pixel iklan pihak ketiga di area login.
- Kebijakan privasi dan S&K tersedia sebelum launch.

---

## 25. Performance & Reliability

| Kategori | Target |
|----------|--------|
| Lighthouse mobile performance | ≥ 85 di perangkat uji yang disepakati |
| JS awal per route user | ≤ 200 KB gzip [v1.2: OPS-08] |
| Uji jaringan | Slow 4G + CPU throttling 4x |
| Aksesibilitas | WCAG 2.2 AA |
| API inti | P95 < 800 ms (di luar provider eksternal) |
| Dashboard | < 3 detik di jaringan uji |
| Counter | Tidak ada operasi tersimpan yang hilang |
| Webhook | Idempoten, ack < 2 detik |
| Backup | Harian otomatis (butuh paket berbayar Supabase, VERIFY harga) [v1.2: OPS-10] |
| Job | Retry + dedupe + dead letter |
| Monitoring | Wajib |
| HTTPS | Wajib |

Monitoring wajib mencakup: event Scalev gagal, email gagal, sinkron jadwal gagal, push gagal, sinkron offline gagal, error progression, job dead.

---

## 26. Core UI States

Setiap halaman inti: loading, empty, success, error, offline (jika relevan), izin ditolak (jika relevan), sesi login kedaluwarsa, akses ditolak (jika relevan).

State khusus:
| State | Kondisi |
|-------|---------|
| Purchase pending | Pembayaran belum terverifikasi |
| No active access | Entitlement tidak aktif |
| Prayer data stale | Data jadwal tidak berhasil diperbarui |
| Manual schedule | Jadwal diatur manual |
| Push unavailable | Perangkat/browser tidak mendukung, atau iOS belum install |
| Level locked | Level belum terbuka |
| Missed night | Pesan suportif tanpa reset |
| Excused mode | Mode berhalangan aktif |
| Counter syncing | Operasi tersimpan lokal, menunggu sinkron |
| Unsynced on logout | Ada catatan belum tersinkron saat logout |
| Content not reviewed | Konten belum bisa dipublikasikan |
| Demo data | Badge "DATA DEMO" saat mode mock |

---

## 27. Acceptance Test Cases (Given / When / Then)

### Auth & pembelian
| ID | Given | When | Then |
|----|-------|------|------|
| AUTH-01 | Pembeli membayar produk yang benar | Webhook valid diproses dan order terverifikasi ke API Scalev | Entitlement aktif, pembeli bisa login setelah OTP |
| AUTH-02 | Webhook dengan signature tidak valid | Request diterima | 401, tidak ada event tersimpan |
| AUTH-03 | Event pembayaran sudah diproses | Event dikirim ulang | Tidak ada duplikasi akun/entitlement |
| AUTH-04 | Pembayaran sukses untuk produk lain | Webhook diproses | Akses Tahajud Tracker tidak aktif |
| AUTH-05 | Order valid, email belum diverifikasi | Seseorang membuka dashboard | Diblokir sampai OTP berhasil |
| AUTH-06 [v1.2] | Email terdaftar dan tidak terdaftar | Request OTP | Respons identik; permintaan ke-6 dalam 1 jam ditolak RATE_LIMITED |
| AUTH-07 [v1.2] | PWA terpasang di iPhone | User login | Login selesai di dalam PWA dengan OTP tanpa berpindah ke Safari |
| AUTH-08 [v1.2] | Webhook valid tetapi API Scalev menyatakan order belum lunas | Worker memproses | Entitlement tidak aktif, status awaiting_order_verification |

### Level & sesi
| ID | Given | When | Then |
|----|-------|------|------|
| LEVEL-01 | Akun baru | Onboarding selesai | Level 1 aktif, Level 2-3 terkunci |
| LEVEL-02 | 5 sesi tuntas | 1 malam terlewat | Progress tetap 5 |
| LEVEL-03 | Level 1 butuh 7 | Sesi tuntas ke-7 | Level 2 terbuka untuk sesi berikutnya |
| LEVEL-04 | Syarat unlock tercapai di sesi ini | Level baru terbuka | Daftar aktivitas sesi ini tidak berubah |
| LEVEL-05 | Admin mengubah target dzikir | Laporan lama dibuka | Hasil sesi lama memakai target saat itu |
| SESSION-01 | Mulai 23.50, selesai 00.20 | Sesi disimpan | Semua aktivitas di session key yang sama |
| SESSION-02 | Sesi berhalangan | Laporan dihitung | Tidak mengurangi tuntas, tidak masuk completion rate |
| SESSION-03 [v1.2] | Wilayah WIB | Waktu server 11.59 lalu 12.01 WIB tanggal D | Session key aktif D, lalu D+1 |
| SESSION-04 [v1.2] | Sesi dibuat di WIB | User ganti wilayah ke WITA di tengah sesi | Sesi tetap WIB; sesi berikutnya WITA |
| SESSION-05 [v1.2] | Level 2 sudah terbuka | Koreksi mengubah sesi tuntas ke-7 Level 1 menjadi sebagian | Level 2 tetap terbuka |
| SESSION-06 [v1.2] | User tidak membuka app 3 malam | Kalender dibuka | 3 tanggal tampil Terlewat dan masuk completion rate |

### Dzikir
| ID | Given | When | Then |
|----|-------|------|------|
| DZIKIR-01 | Counter 20/100 | Tap | 21/100, tersimpan |
| DZIKIR-02 | Offline | Tap beberapa kali, lalu online | Tersinkron tanpa hitung ganda |
| DZIKIR-03 | Operation ID sudah diproses | Dikirim lagi | Hitungan tidak bertambah |
| DZIKIR-04 [v1.2] | Online | 100 tap dalam 20 detik | Maksimal 15 request, hitungan server 100 |
| DZIKIR-05 [v1.2] | 2 perangkat pada aktivitas yang sama | Masing-masing tap 30 kali | Hitungan server 60 di kedua perangkat setelah sinkron |
| DZIKIR-06 [v1.2] | Ada operasi belum tersinkron | User logout | Dialog peringatan muncul, data tidak hilang tanpa konfirmasi |

### Jadwal & notifikasi
| ID | Given | When | Then |
|----|-------|------|------|
| PRAYER-01 | Lokasi berubah | Wilayah diperbarui | Subuh dan rekomendasi tahajud dihitung ulang |
| PRAYER-02 | Provider gagal | Dashboard dibuka | Cache valid dengan label "Jadwal tersimpan" atau error state |
| PRAYER-03 [v1.2] | User memakai jadwal manual | Dashboard dibuka | Jadwal tampil dengan label "Diatur manual", planner bekerja |
| NOTIF-01 | Bedtime aktif | 2 malam berturut diproses | Template berbeda |
| NOTIF-02 | Bedtime dimatikan | Scheduler jalan | Tidak ada bedtime terkirim |
| NOTIF-03 | Browser tidak mendukung push | Pengaturan dibuka | Penjelasan + panduan alarm manual |
| NOTIF-04 [v1.2] | Job tahajud dijadwalkan 03.00 | Worker baru jalan 03.20 | Job kedaluwarsa, tidak terkirim |
| NOTIF-05 [v1.2] | Quiet hours 22.00-04.00, worship tidak diizinkan | Bedtime 22.30 | Tidak terkirim |

### Qur'an & laporan
| ID | Given | When | Then |
|----|-------|------|------|
| QURAN-01 | Reader membuka surah | Teks ditampilkan | Semua ayat cocok dengan dataset tervalidasi dan checksum |
| QURAN-02 | Berhenti di ayat tertentu | Kembali ke Reader | Posisi dipulihkan |
| REPORT-01 | 4 tuntas, 2 sebagian, 1 terlewat | Filter 7 hari | 57,14% |
| REPORT-02 | User baru | Dashboard dibuka | Empty state ramah |

### Security & privasi
| ID | Given | When | Then |
|----|-------|------|------|
| SECURITY-01 | User A | Membaca sesi milik User B | Ditolak |
| SECURITY-02 | Entitlement tidak aktif | API premium dipanggil | Diblokir, data historis tetap ada |
| SECURITY-03 [v1.2] | User login dengan JWT valid | Update `night_sessions.status` langsung via Supabase REST | Ditolak (tidak ada privilege) |
| SECURITY-04 [v1.2] | User A | DELETE push subscription milik User B | 404, subscription B tetap |
| SECURITY-05 [v1.2] | User non-admin atau admin tanpa MFA | Membuka /admin atau API admin | Ditolak |
| SECURITY-06 [v1.2] | User logout | Membuka DevTools storage | Tidak ada data privat user tersisa di IndexedDB/Cache Storage |
| PRIV-01 [v1.2] | reporting_admin | Membuka laporan | Tidak ada data excused per user |

---

## 28. QA & Pre-launch

**UI QA**: 320px; Android Chrome; iPhone Safari; PWA terpasang (Android & iOS); desktop Chrome; tablet landscape; dark mode; font besar; screen reader (TalkBack, VoiceOver); reduced motion; perangkat Android kelas bawah.
**Arabic QA**: Rasm Utsmani, harakat, waqaf, penanda ayat, RTL, clipping font, pemenggalan baris, atribusi sumber.
**Payment QA**: paid, settled, pending, failed, duplikat, tidak berurutan, produk salah, detail order belum ada, verifikasi email, retry reconciliation, transfer entitlement, refund.
**Notification QA**: Android PWA, iPhone Home Screen PWA, izin diberikan/ditolak, tanpa subscription, ganti timezone/wilayah, ganti jam tidur, notifikasi terlambat, job duplikat, quiet hours.
**Security QA**: RLS test otomatis, rate limit, CSRF/Origin, open redirect, XSS di konten admin, secret scan, MFA admin.

---

## 29. Development Phases

| Fase | Isi |
|------|-----|
| 1. Foundation & UI | Setup, tokens, komponen, navigasi, semua layar dengan mock berlabel, kontrak API |
| 2. Data & logic | Domain engine (pure), migrations, RLS, auth OTP, sesi, progression, counter, laporan, offline queue |
| 3. Integrasi | Scalev + verifikasi order, SIHAT, Qur'an import, Web Push + scheduler, email |
| 4. Admin | Login MFA, amalan manager, level config, versioning, notification CMS, support tools, monitoring, audit |
| 5. Production QA | E2E, security review, Arabic QA, review konten agama, aksesibilitas, cross-browser, performa, deploy, monitoring, uji backup |

Pembagian sesi kerja agen ada di `docs/AGENT_BRIEF.md` §8.

---

## 30. Accepted Defaults & Pending Approvals

### 30.1 Confirmed
PWA only; akses berbayar Scalev; passwordless; tiga level; progress kumulatif tanpa reset; Dashboard Istiqomah sebagai homepage; Subuh berbasis lokasi; bedtime reminder dinamis; Earth Tone; Quran Reader surah pilihan; laporan pribadi.

### 30.2 Provisional defaults
- Target level 7 / 12 / 20; periode 14 / 21 / 30.
- Tahlil Level 1: 100 inti + 200 opsional.
- Post-Fajr khusus Level 3.
- Lifetime entitlement tanpa expiry.
- Cutoff 12.00 lokal; koreksi 48 jam.
- Durasi 60 / 120 / 150 menit; buffer 10 menit; ambang tidur 5 jam.
- Bank bedtime minimal 30 pesan.
- Daftar aktivitas required.
- Mode berhalangan rentang (maks 15 hari) dan dzikir tetap tercatat saat berhalangan.
- Batas 3 perangkat aktif.
- Retensi payload webhook 90 hari.
- Kedaluwarsa notifikasi per tipe.
- Ejaan: usulan "Istiqomah" konsisten di semua UI (termasuk judul Level 3), atau "Istikamah" sesuai KBBI di semua tempat. Owner memilih satu [v1.2: DOC-03].

### 30.3 Wajib review sebelum launch
1. ~~Verifikasi lafaz "Ya Khafi"~~ Selesai: "Ya Kafi" (v1.2.1).
2. Tanda tangan pembimbing atas teks dzikir di `content/amalan.v1.json` + keputusan usulan koreksi di `docs/CONTENT-REVIEW.md`.
3. Persetujuan pembimbing untuk susunan salat dan bacaan.
4. Klasifikasi amalan sunnah umum vs wirid program.
5. Konfirmasi aktivitas required.
6. Konfirmasi target level.
7. Konfirmasi post-Fajr Level 3.
8. Persetujuan kebijakan lifetime access + estimasi biaya infrastruktur per user [v1.2: OPS-13].
9. Izin API resmi jadwal salat.
10. Lisensi Qur'an dan terjemahan.
11. Kebijakan privasi, S&K, kebijakan refund, retensi data; cek kewajiban UU PDP dan pendaftaran PSE Lingkup Privat (VERIFY dengan konsultan hukum) [v1.2: PRIV-03].
12. Uji akurasi jadwal dan notifikasi.
13. ~~Satuan counter rangkaian asma~~ Selesai: putaran (v1.2.1).
14. ~~Teks dzikir setelah Qabliyah~~ Selesai: tasbih malaikat 100 (v1.2.1).
17. Cakupan dzikir setelah Subuh: Level 3 saja atau semua level.
18. Panduan durasi tilawah Level 2 ("setengah jam atau 60 menit") dan Level 3.
19. Jumlah bacaan "Allahu Akbar kabira dan rangkaiannya" (default 1).
15. Aturan mode berhalangan [v1.2: OPS-12].
16. Format webhook & API Scalev dicocokkan dengan dokumentasi resmi dan payload asli.

---

## 31. Definition of Done

MVP selesai jika:
- Semua alur utama berjalan.
- Pembeli Scalev mendapat akses otomatis setelah verifikasi order.
- Login dengan email terverifikasi, termasuk di PWA iOS.
- Lokasi, jadwal Subuh, dan jadwal manual berfungsi.
- Dashboard memakai data aktual.
- Tiga level berfungsi, progress tidak reset, level monoton.
- Counter tidak kehilangan hitungan, termasuk offline dan multi-perangkat.
- Quran Reader memakai data terverifikasi dengan checksum.
- Notifikasi punya konfigurasi, rotasi, dedupe, dan kedaluwarsa.
- Mutasi offline tersinkron aman.
- Admin mengatur konten dan level lewat workflow review.
- RLS, otorisasi API, dan akses premium lulus test.
- Semua acceptance test di §27 lulus.
- Konten agama disetujui reviewer.
- Tidak ada placeholder data, mode mock, atau secret hardcoded di production.
- Monitoring, backup, dan alur support aktif.

---

## 32. Execution Brief untuk Claude

**Peran:** senior product designer, UX architect, full-stack engineer untuk PWA mobile-first.

**Prioritas:** UI mobile-first yang rapi; brand Earth Tone; Dashboard Istiqomah sebagai pengalaman utama; komponen reusable; aktivitas berbasis konfigurasi; progression di server; akses berbayar aman; jadwal berbasis lokasi; counter persisten; teks Qur'an terverifikasi saja; batasan push PWA dihormati; privasi dan aksesibilitas.

**Standar wajib:** TypeScript strict; komponen reusable; kontrak API eksplisit; migrations; validasi server; RLS; event eksternal idempoten; konten agama berversi; sinkron offline aman; error terstruktur; test otomatis; tanpa secret di client.

**Larangan:**
- Membuat app native.
- Menjanjikan alarm sistem dari PWA.
- Mengarang teks Qur'an atau teks Arab dzikir.
- Memalsukan respons API eksternal di production.
- Memberi akses dari klaim pembayaran sisi client atau dari payload webhook tanpa verifikasi.
- Mereset progress karena malam terlewat, atau mengunci ulang level yang sudah terbuka.
- Ranking ibadah publik.
- Memperlakukan semua amalan program sebagai kewajiban agama.
- Menganggap konten provisional sudah disetujui.
- Mengekspos secret, API key, atau detail ibadah user.

**Urutan kerja dan prompt per sesi:** `docs/AGENT_BRIEF.md`.

---
**END OF PRD v1.2**
