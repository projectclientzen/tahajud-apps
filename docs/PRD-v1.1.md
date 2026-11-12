PRODUCT REQUIREMENTS DOCUMENT
=============================

TAHAJUD TRACKER BY NGAJIGAES
============================

PRD v1.1 — UI/UX, System Architecture & Technical Specification
---------------------------------------------------------------

**Document Version:** 1.1**Document Date:** 12 November 2026**Status:** Approved Design Baseline / Implementation Specification**Product Type:** Paid Progressive Web Application (PWA)**Primary Language:** Bahasa Indonesia**Brand Identity:** NgajiGaes — Earth Tone**Target Market:** Muslim Indonesia, khususnya pengguna yang ingin membangun kebiasaan ibadah malam**Primary Development Handoff:** Claude

1\. EXECUTIVE SUMMARY
=====================

1.1 Product Description
-----------------------

Tahajud Tracker by NgajiGaes adalah aplikasi web berbasis Progressive Web App yang membantu pengguna membangun kebiasaan ibadah malam secara terstruktur, bertahap, dan berkelanjutan.

Aplikasi memiliki tiga level ibadah. Setiap level menyediakan aktivitas salat, dzikir, doa, tilawah, dan rangkaian ibadah Subuh.

Pengguna dapat mencatat penyelesaian amalan, menghitung dzikir menggunakan digital counter, membaca Al-Qur'an Rasm Utsmani, dan memantau konsistensi melalui Dashboard Istiqomah.

Aplikasi terintegrasi dengan Scalev sehingga akses hanya diberikan setelah pembelian terverifikasi.

1.2 Product Vision
------------------

"Mendampingi perjalanan istiqomah dalam ibadah malam, satu malam demi satu malam."

1.3 Core Value Proposition
--------------------------

1.  **Guided Worship:** pengguna mendapatkan panduan amalan yang tersusun berdasarkan level.
    
2.  **Progressive Habit Formation:** tantangan bertambah secara bertahap.
    
3.  **Consistent Progress:** keberhasilan tetap terakumulasi walaupun pengguna melewatkan malam tertentu.
    
4.  **Smart Scheduling:** waktu tahajud menyesuaikan jadwal Subuh berdasarkan wilayah.
    
5.  **Spiritual Companion:** pengingat persiapan tidur, dzikir counter, dan pembaca Al-Qur'an dalam satu aplikasi.
    
6.  **Personal Reporting:** dashboard menampilkan perkembangan yang hanya dapat diakses pengguna.
    
7.  **Frictionless Access:** pembeli Scalev memperoleh akun secara otomatis tanpa pendaftaran manual.
    

1.4 Product Principles
----------------------

*   Konsistensi lebih utama daripada kesempurnaan tracking.
    
*   Tidak mengukur kualitas iman, keikhlasan, atau diterimanya ibadah.
    
*   Tidak menggunakan hukuman atau reset total progres.
    
*   Menjaga privasi catatan ibadah.
    
*   Menyampaikan konten agama dengan rujukan yang jelas.
    
*   Mengutamakan kemampuan mobile dan aksesibilitas.
    
*   Tidak menggantikan kebutuhan tidur yang cukup atau kewajiban salat fardu dengan target aplikasi.
    

2\. PRODUCT DECISION REGISTER
=============================

Keputusan berikut merupakan acuan utama seluruh implementasi.

IDKomponenKeputusanDEC-01PlatformWeb App berbasis PWADEC-02Native AppTidak termasuk scopeDEC-03Model aksesPaid Access OnlyDEC-04CheckoutScalevDEC-05AktivasiOtomatis setelah verifikasi pembayaranDEC-06LoginPasswordless email OTP/magic linkDEC-07LevelTiga level progresifDEC-08UnlockLevel 1 → 2 → 3DEC-09ProgressAkumulasi hari berhasilDEC-10Missed nightTidak mereset progresDEC-11HomepageDashboard IstiqomahDEC-12Prayer scheduleBerdasarkan wilayah dan tanggalDEC-13Primary prayer providerSIHAT Kemenag RIDEC-14ReminderWeb Push dengan izin penggunaDEC-15Bedtime reminderPesan dinamis berganti setiap hariDEC-16Quran ReaderRasm Utsmani, lima surah pilihanDEC-17Visual styleEarth Tone NgajiGaesDEC-18ReportingPrivat, tanpa leaderboardDEC-19AdminPengelolaan konten dan sistemDEC-20BahasaIndonesia sebagai bahasa default

Keputusan yang belum ditetapkan pemilik produk menggunakan konfigurasi default, bukan asumsi permanen.

3\. PRODUCT SCOPE
=================

3.1 In Scope — MVP
------------------

*   Scalev purchase verification.
    
*   Automatic account provision.
    
*   Passwordless authentication.
    
*   User onboarding.
    
*   Location setup.
    
*   Prayer time synchronization.
    
*   Istiqomah dashboard.
    
*   Level 1, 2, dan 3.
    
*   Level progression engine.
    
*   Daily worship tracking.
    
*   Dzikir counter.
    
*   Quran Reader.
    
*   Bookmark dan reading progress.
    
*   Bedtime reminder dinamis.
    
*   Tahajud reminder.
    
*   Subuh reminder.
    
*   Personal reporting.
    
*   Offline progress queue.
    
*   Push notification management.
    
*   Admin content management.
    
*   Light dan dark theme.
    
*   Responsive mobile/tablet/desktop.
    

3.2 Out of Scope — MVP
----------------------

*   Android native.
    
*   iOS native.
    
*   Integrasi langsung dengan alarm sistem perangkat.
    
*   Community leaderboard.
    
*   Social ranking.
    
*   Group worship competition.
    
*   AI-generated religious rulings.
    
*   Full audio Quran player.
    
*   Chatbot ulama.
    
*   Pembayaran di luar Scalev.
    
*   Integrasi wearable device.
    

4\. USER PERSONAS
=================

Persona A — Beginner
--------------------

Pengguna yang belum konsisten menjalankan tahajud.

**Goals:** membangun rutinitas secara perlahan dan mengetahui urutan amalan.

**Pain points:** sulit bangun, bingung urutan ibadah, mudah kehilangan motivasi.

Persona B — Growing Worshipper
------------------------------

Pengguna yang telah menjalankan tahajud tetapi ingin meningkatkan intensitas.

**Goals:** menambah amalan, menjaga hitungan dzikir, dan memantau keberhasilan.

Persona C — Program Administrator
---------------------------------

Tim NgajiGaes yang mengelola konten amalan, akun pembeli, pesan notifikasi, dan konfigurasi level.

**Goals:** memperbarui program tanpa melakukan deployment frontend.

5\. INFORMATION ARCHITECTURE
============================

5.1 Primary User Navigation
---------------------------

Gunakan empat bottom navigation items:

TabRouteFungsiBeranda/dashboardDashboard IstiqomahAmalan/worshipPanduan dan trackingAl-Qur'an/quranQuran ReaderProfil/profilePengaturan pengguna

Laporan lengkap tersedia pada /reports dan diakses melalui dashboard.

5.2 Additional User Routes
--------------------------

RouteHalaman/Public landing/access information/loginPasswordless login/auth/verifyOTP verification/access-statusPurchase access status/onboardingFirst-time onboarding/levelsLevel journey/worship/sessionCurrent worship session/worship/dhikr/:idDzikir counter/quran/:surahSurah Reader/reportsDetailed report/reports/calendarIstiqomah history/notificationsNotification center/settingsPreferences/helpHelp and references

5.3 Admin Routes
----------------

*   /admin
    
*   /admin/users
    
*   /admin/purchases
    
*   /admin/levels
    
*   /admin/activities
    
*   /admin/dhikr
    
*   /admin/quran-content
    
*   /admin/notifications
    
*   /admin/prayer-times
    
*   /admin/audit-logs
    

Semua admin route harus dilindungi autentikasi dan otorisasi berbasis role.

6\. END-TO-END USER JOURNEY
===========================

6.1 Purchase to Activation
--------------------------

1.  Pengguna membeli produk melalui Scalev.
    
2.  Scalev memproses pembayaran.
    
3.  Backend menerima webhook pembayaran.
    
4.  Backend memverifikasi signature.
    
5.  Backend menyimpan event secara idempotent.
    
6.  Backend memastikan status pembayaran valid.
    
7.  Backend memastikan produk/varian sesuai produk Tahajud Tracker.
    
8.  Backend membuat atau memperbarui entitlement.
    
9.  Sistem menyiapkan akun berdasarkan email pembeli.
    
10.  Pembeli menerima email berisi instruksi akses.
    
11.  Pembeli melakukan login OTP/magic link.
    
12.  Identitas login diverifikasi.
    
13.  Backend menghubungkan akun dengan entitlement yang cocok.
    
14.  Pengguna diarahkan ke onboarding.
    

6.2 Onboarding to First Session
-------------------------------

1.  Welcome.
    
2.  Penjelasan perjalanan tiga level.
    
3.  Pilih wilayah.
    
4.  Konfirmasi jadwal Subuh.
    
5.  Tentukan target tidur.
    
6.  Atur notifikasi.
    
7.  Tampilkan panduan memasang PWA.
    
8.  Selesaikan onboarding.
    
9.  Dashboard Istiqomah ditampilkan.
    
10.  Pengguna memulai Level 1.
    

6.3 Daily Worship Journey
-------------------------

Persiapan tidur → Pengingat tahajud → Salat malam → Dzikir malam → Doa dan tilawah → Qabliyah Subuh → Salat Subuh → Dzikir lanjutan sesuai level → Ringkasan sesi → Dashboard reporting.

7\. UI/UX DESIGN SYSTEM
=======================

7.1 Creative Direction
----------------------

**Warm Minimalist Islamic Wellness**

Aplikasi harus terasa:

*   Tenang.
    
*   Hangat.
    
*   Bersih.
    
*   Modern.
    
*   Personal.
    
*   Nyaman digunakan pada malam hari.
    

Hindari:

*   Warna neon.
    
*   Animasi berlebihan.
    
*   Gamifikasi agresif.
    
*   Desain kompetitif.
    
*   Halaman yang terlalu padat.
    

7.2 Color Tokens
----------------

TokenHEXUsagePrimary Sage#88A189Brand accentDeep Forest#354F40CTA, primary textWarm Cream#FAF7EDLight backgroundSand Beige#D9C6A5Milestone/accentSoft Olive#B7BDA1Secondary accentDark Earth#25372FDark mode background

Tambahkan token semantik untuk success, warning, error, disabled, surface, dan border.

7.3 Typography
--------------

**Latin:** Plus Jakarta Sans atau Inter.

**Arabic:** font yang mendukung Rasm Utsmani lengkap, harakat, tanda waqaf, dan karakter Quran yang digunakan sumber.

Ukuran dasar:

*   Body: 16 px.
    
*   Helper text: 12–14 px.
    
*   Card title: 18–20 px.
    
*   Page title: 24–28 px.
    
*   Quran Arabic: default 30 px, configurable.
    
*   Dzikir Arabic: 26–34 px.
    

7.4 Components
--------------

*   Rounded cards.
    
*   Soft borders.
    
*   Large buttons.
    
*   Progress indicators.
    
*   Bottom navigation.
    
*   Accessible modals.
    
*   Clear empty states.
    
*   Skeleton loading.
    
*   Status chips.
    
*   Smooth but minimal transitions.
    

7.5 Responsive Layout
---------------------

DeviceLayoutMobile < 768 pxSingle columnTablet 768–1023 pxAdaptive gridDesktop ≥ 1024 pxSidebar + content grid

Desain harus berfungsi dengan baik pada lebar layar mulai 320 px.

7.6 Accessibility
-----------------

Target WCAG 2.2 AA sejauh relevan.

*   Touch targets minimal sekitar 44 × 44 px.
    
*   Keyboard navigation.
    
*   Screen-reader labels.
    
*   Reduced motion support.
    
*   Kontras teks yang memadai.
    
*   Status tidak hanya bergantung pada warna.
    
*   Arabic RTL yang benar.
    
*   Focus state yang terlihat.
    
*   Pengaturan font Al-Qur'an.
    

8\. MAIN DASHBOARD — ISTIQOMAH REPORTING
========================================

8.1 Objective
-------------

Halaman utama harus langsung menjawab:

*   Sedang berada di level berapa?
    
*   Sudah berapa hari berhasil?
    
*   Bagaimana perkembangan istiqomah?
    
*   Amalan apa yang paling konsisten tercatat?
    
*   Kapan waktu Subuh berikutnya?
    
*   Kapan harus mulai tahajud?
    

8.2 Dashboard Layout
--------------------

### Section A — Welcome Header

Components:

*   NgajiGaes logo.
    
*   Greeting.
    
*   User name.
    
*   Notification icon.
    
*   Profile shortcut.
    

Sample:

"Assalamu'alaikum, selamat melanjutkan perjalanan istiqomahmu."

### Section B — Prayer Time Card

Fields:

*   User location.
    
*   Next Fajr date.
    
*   Next Fajr time.
    
*   Recommended tahajud start time.
    
*   Countdown.
    
*   Prayer data source.
    
*   Last sync indicator.
    

### Section C — Active Level Card

Fields:

*   Active level.
    
*   Level title.
    
*   Completed nights.
    
*   Target successful nights.
    
*   Progress bar.
    
*   Remaining successes.
    
*   Button to level journey.
    

### Section D — Reporting Overview

Kartu statistik:

*   Hari berhasil.
    
*   Hari sebagian.
    
*   Hari terlewat.
    
*   Completion percentage.
    

Filter:

*   7 hari.
    
*   30 hari.
    
*   90 hari.
    

### Section E — Istiqomah Calendar

Calendar statuses:

*   Completed.
    
*   Partial.
    
*   Missed.
    
*   Excused.
    
*   Upcoming.
    

Klik tanggal membuka session details.

### Section F — Amalan Performance

List tiap amalan, total penyelesaian, dan progress bar.

### Section G — Personal Insight

Template motivasi berdasarkan laporan aktual.

### Section H — CTA

"Mulai Ibadah Malam Ini"

Atau:

"Lanjutkan Ibadah"

Atau:

"Lihat Ringkasan Sesi"

8.3 Dashboard Loading States
----------------------------

*   Loading skeleton.
    
*   Empty state akun baru.
    
*   Offline state.
    
*   Unavailable prayer data.
    
*   No session today.
    
*   Session in progress.
    
*   Session completed.
    

Jangan menampilkan angka dummy tanpa penanda demonstrasi.

9\. LEVEL CONFIGURATION & CONTENT
=================================

9.1 Level Metadata
------------------

LevelTitleNight prayer rakaatNight dhikr count1Fondasi54002Bertumbuh91.5503Istikamah111.863

Level 1 dapat mencapai 600 hitungan bila tambahan tahlil opsional dilakukan.

Hitungan dzikir tidak termasuk aktivitas setelah Subuh.

9.2 Level 1
-----------

**Prayer sequence:**

1.  Salat Taubat — 2 rakaat.
    
2.  Salat Tahajud — 2 rakaat.
    
3.  Salat Witir — 1 rakaat.
    

**Night dhikr:**

1.  Istighfar panjang — 100.
    
2.  Shalawat — 100.
    
3.  Tahlil — 100.
    
4.  Rangkaian Ya Fattah, Ya Razzaq, Ya Khafi, Ya Mughni — 100.
    

**Optional extension:** tahlil tambahan 200.

**Closing:**

*   Doa sesuai kebutuhan.
    
*   Tilawah menjelang Subuh.
    
*   Rangkaian Subuh bersama.
    

9.3 Level 2
-----------

**Prayer sequence:**

1.  Salat Taubat — 2.
    
2.  Salat Tahajud — 2.
    
3.  Salat Hajat — 2.
    
4.  Salat Witir — 2 + 1.
    

**Night dhikr:**

1.  Istighfar — 100.
    
2.  Rangkaian Asma — 100.
    
3.  Shalawat — 300.
    
4.  Hasbunallah wa ni'mal wakil — 450.
    
5.  La hawla wa la quwwata illa billah — 100.
    
6.  Tahlil — 500.
    

**Closing:**

*   Doa.
    
*   Tilawah.
    
*   Rangkaian Subuh bersama.
    

9.4 Level 3
-----------

**Prayer sequence:**

1.  Salat Taubat — 2.
    
2.  Salat Tahajud — 4.
    
3.  Salat Hajat — 2.
    
4.  Salat Witir — 2 + 1.
    

**Night dhikr:**

1.  Istighfar — 100.
    
2.  Rangkaian Asma — 100.
    
3.  Shalawat — 300.
    
4.  Hasbunallah wa ni'mal wakil — 450.
    
5.  La hawla wa la quwwata illa billah — 100.
    
6.  Doa Nabi Yunus — 313.
    
7.  Tahlil — 500.
    

**Closing:**

*   Doa.
    
*   Tilawah.
    
*   Rangkaian Subuh bersama.
    
*   Dzikir setelah Subuh lanjutan.
    
*   Al-Waqi'ah.
    
*   Ayat Seribu Dinar.
    
*   Doa sesuai hajat.
    

9.5 Shared Subuh Activities
---------------------------

1.  Salat Sunnah Qabliyah Subuh — 2 rakaat.
    
2.  Panduan program rakaat pertama: Al-Insyirah setelah Al-Fatihah.
    
3.  Panduan program rakaat kedua: Al-Fil setelah Al-Fatihah.
    
4.  Dzikir setelah salam sesuai materi program — 100.
    
5.  Salat Fardu Subuh.
    
6.  Tracking berjamaah opsional.
    

Sistem tidak boleh menunda salat fardu demi menyelesaikan counter atau checklist. Berikan kebebasan mencatat kembali aktivitas yang dilakukan sesuai urutan aktual.

9.6 Level 3 Post-Fajr Sequence
------------------------------

AmalanTargetIstighfar panjang3Tahlil panjang10Allahumma antas salam1Subhanallah33Alhamdulillah33Allahu Akbar33Dzikir Allahu Akbar kabira dan rangkaiannya1Astaghfirullahal 'azhim3Tahlil100Al-Waqi'ah1 surahQS. At-Talaq 65:2–31 bacaanDoa hajat1 aktivitas

Default konfigurasi menganggap bagian ini khusus Level 3, menunggu pengesahan pemilik program.

9.7 Religious Content Metadata
------------------------------

Setiap amalan wajib memiliki:

*   Activity ID.
    
*   Arabic text.
    
*   Transliteration jika tersedia.
    
*   Translation jika tersedia.
    
*   Description.
    
*   Reference.
    
*   Source classification.
    
*   Reviewer status.
    
*   Content version.
    

Klasifikasi rujukan:

*   Sunnah dengan dalil khusus.
    
*   Anjuran umum.
    
*   Susunan wirid program/ijtihad pembimbing.
    
*   Belum diverifikasi.
    

Klasifikasi ini tidak boleh diisi otomatis berdasarkan tebakan AI.

10\. LEVEL PROGRESSION ENGINE
=============================

10.1 Default Level Targets
--------------------------

LevelSuccessful nightsSuggested period1714 malam21221 malam32030 malam

Angka ini menjadi default aplikasi v1.1, tetapi tetap configurable pada admin sebelum peluncuran.

10.2 Core Progression Formula
-----------------------------

Level Progress = Completed Night Sessions / Required Successful Sessions

Contoh:

Level 1 membutuhkan tujuh sesi berhasil.

*   Hari 1: berhasil.
    
*   Hari 2: berhasil.
    
*   Hari 3: terlewat.
    
*   Hari 4: berhasil.
    

Progress = 3/7.

Hari terlewat tidak mengurangi progress.

10.3 Successful Session
-----------------------

Sesi dianggap berhasil apabila seluruh aktivitas dengan required\_for\_completion = true dalam snapshot level sesi tersebut sudah ditandai selesai.

Persyaratan:

*   Salat tercatat selesai.
    
*   Dzikir inti mencapai target.
    
*   Aktivitas doa ditandai selesai.
    
*   Tilawah ditandai selesai berdasarkan konfirmasi pengguna; tidak ditentukan minimum halaman atau durasi.
    
*   Aktivitas Subuh yang ditetapkan inti tercatat selesai.
    
*   Aktivitas opsional tidak memengaruhi keberhasilan.
    

Istilah "required" berarti diperlukan untuk target aplikasi, bukan kewajiban fikih.

10.4 Missed Session
-------------------

Jika tidak ada aktivitas sampai batas penutupan sesi:

status = missed

Progress tetap sama.

10.5 Partial Session
--------------------

Jika sebagian aktivitas tercatat tetapi persyaratan lengkap belum terpenuhi:

status = partial

Aktivitas yang dilakukan tetap masuk laporan per amalan, tetapi tidak menambah successful nights.

10.6 Excused Session
--------------------

Pengguna dapat menandai sesi sebagai dikecualikan tanpa harus memberikan data medis atau alasan pribadi.

*   Tidak menambah keberhasilan.
    
*   Tidak mengurangi progress.
    
*   Tidak dihitung dalam persentase keberhasilan.
    
*   Dapat dibuka kembali melalui proses koreksi.
    

10.7 Unlock Rules
-----------------

Level baru terbuka setelah jumlah sesi berhasil memenuhi target.

Perubahan level berlaku mulai sesi malam berikutnya agar aktivitas pada sesi yang sedang berjalan tidak tiba-tiba berubah.

Historical sessions menyimpan level dan activity requirement snapshot sendiri.

10.8 Level 3 Completion
-----------------------

Setelah target Level 3 terpenuhi, tampilkan milestone "Istikamah Journey Completed".

Pengguna tetap berada di Level 3 dan dapat melanjutkan tracking tanpa target Level 4.

11\. NIGHT SESSION LIFECYCLE
============================

11.1 Session Identity
---------------------

Gunakan identitas sesi berdasarkan **tanggal Subuh lokal**.

Contoh:

Pengguna melakukan tahajud pada malam 12 November menuju Subuh 13 November.

Session key:2026-11-13

Bukan 2026-11-12.

11.2 Session Window
-------------------

Default:

*   Sesi dapat dipersiapkan pada malam sebelumnya.
    
*   Aktivitas malam dijalankan sebelum Subuh.
    
*   Fase setelah Subuh tetap berada dalam session key yang sama.
    
*   Cutoff penutupan otomatis: pukul 12.00 waktu lokal pada tanggal Subuh.
    
*   Koreksi catatan dapat diajukan hingga 48 jam setelah cutoff.
    

Cutoff merupakan aturan administratif tracking, bukan batas waktu ibadah.

11.3 Session State Machine
--------------------------

scheduled → in\_progress → completed

Alternatif:

scheduled → missed

in\_progress → partial

scheduled/in\_progress → excused

Koreksi historis dapat mengubah status melalui operasi yang tercatat di audit log.

11.4 Time-Sensitive Transitions
-------------------------------

Saat waktu Subuh masuk:

*   Tampilkan pengingat bahwa fase Subuh telah dimulai.
    
*   Pisahkan aktivitas malam dan aktivitas Subuh.
    
*   Jangan otomatis mencentang amalan.
    
*   Jangan menghapus aktivitas yang belum lengkap.
    
*   Jangan menampilkan countdown negatif.
    

11.5 Multiple Devices
---------------------

Hanya boleh ada satu session record untuk kombinasi:

user\_id + fajr\_local\_date

Perubahan dari beberapa perangkat harus tersinkron dengan mekanisme concurrency yang aman.

12\. DZIKIR COUNTER ENGINE
==========================

12.1 UI Requirements
--------------------

Counter screen terdiri dari:

*   Header.
    
*   Nama dzikir.
    
*   Arabic text.
    
*   Transliteration toggle.
    
*   Target count.
    
*   Current count.
    
*   Progress ring.
    
*   Large tap button.
    
*   Minus correction.
    
*   Reset confirmation.
    
*   Completion confirmation.
    

12.2 Counter Behavior
---------------------

*   Tap menambah satu.
    
*   Hitungan tidak boleh negatif.
    
*   Counter tidak boleh kehilangan data ketika aplikasi tertutup.
    
*   Target selesai saat count >= target.
    
*   Perubahan harus dapat dipulihkan setelah reconnect.
    
*   Counter menyimpan aktivitas berdasarkan session ID dan activity ID.
    

12.3 Counter Sync
-----------------

Gunakan operasi dengan unique client operation ID untuk mencegah duplikasi saat retry.

Setiap operasi memuat:

*   Operation ID.
    
*   Session ID.
    
*   Activity ID.
    
*   Delta count.
    
*   Client timestamp.
    
*   Server timestamp setelah diterima.
    

Server menerapkan operasi satu kali saja.

Gunakan transactional update atau metode atomik untuk mencegah lost update.

12.4 Reset
----------

Reset tidak boleh langsung menghapus riwayat tanpa konfirmasi.

Reset dicatat sebagai correction event yang dapat diaudit.

13\. QURAN READER
=================

13.1 Supported Content
----------------------

*   Yasin — 83 ayat.
    
*   Al-Waqi'ah — 96 ayat.
    
*   Al-Mulk — 30 ayat.
    
*   Ar-Rahman — 78 ayat.
    
*   Al-Kahfi — 110 ayat.
    
*   QS. At-Talaq 65:2–3.
    

13.2 Source
-----------

Gunakan Tanzil Uthmani atau sumber terverifikasi lain yang disetujui.

Persyaratan:

*   Teks original tidak diubah.
    
*   Atribusi ditampilkan.
    
*   Lisensi disimpan.
    
*   Metadata versi sumber disimpan.
    
*   Konten divalidasi sebelum publish.
    
*   Terjemahan memakai izin terpisah.
    

13.3 Quran UI
-------------

*   Surah header.
    
*   Arabic text RTL.
    
*   Ayah marker.
    
*   Translation toggle.
    
*   Font-size control.
    
*   Bookmark.
    
*   Last read ayah.
    
*   Reading progress.
    
*   Night mode.
    
*   Completion button.
    

13.4 Reading Tracking
---------------------

Simpan:

*   Surah ID.
    
*   Ayat terakhir dibaca.
    
*   Reading status.
    
*   Last read timestamp.
    
*   Completion timestamp.
    

Progress per surah dapat berlanjut antarhari.

Riwayat penyelesaian surah untuk sesi tertentu tetap disimpan secara terpisah.

13.5 Al-Kahfi Schedule
----------------------

Window khusus:

*   Kamis setelah Maghrib lokal.
    
*   Hingga Jumat sebelum Maghrib lokal.
    

Munculkan badge "Bacaan Jumat" dan reminder opsional.

13.6 Quran Content Safety
-------------------------

Jangan menggunakan output AI sebagai teks ayat produksi.

Bila sumber gagal dimuat, tampilkan error state atau data valid dari cache.

Tidak boleh ada fallback ayat buatan.

14\. REAL-TIME PRAYER TIME ENGINE
=================================

14.1 Primary Source
-------------------

SIHAT Kementerian Agama RI.

Integrasi melalui backend adapter.

Jangan memanggil API menggunakan token privat langsung dari browser.

14.2 Region Management
----------------------

Pengguna memilih:

*   Provinsi.
    
*   Kabupaten/kota.
    

GPS dapat dipakai untuk menyarankan wilayah, tetapi izin lokasi tidak wajib.

14.3 Prayer Time Data Model
---------------------------

Fields:

*   Region ID.
    
*   Region name.
    
*   Timezone.
    
*   Local date.
    
*   Fajr.
    
*   Maghrib.
    
*   Provider.
    
*   Provider version/method jika tersedia.
    
*   Fetched at.
    
*   Cache validity.
    

14.4 Refresh Rules
------------------

*   Ambil jadwal saat onboarding.
    
*   Cache jadwal beberapa hari atau satu bulan sesuai izin provider.
    
*   Perbarui saat data mendekati habis.
    
*   Recalculate bila wilayah berubah.
    
*   Recalculate bila tanggal lokal berubah.
    
*   Gunakan timezone wilayah tujuan, bukan timezone server.
    

14.5 Failure Handling
---------------------

Jika provider tidak tersedia:

1.  Gunakan cache yang masih relevan.
    
2.  Tampilkan label "Jadwal tersimpan".
    
3.  Berikan opsi refresh.
    
4.  Jangan menampilkan jadwal kadaluwarsa sebagai jadwal terverifikasi.
    
5.  Sediakan fallback provider hanya jika perbedaannya dan metode perhitungannya telah dievaluasi.
    

14.6 Smart Wake-up Planner
--------------------------

Formula:

Wake-up Time = Fajr Time - Estimated Worship Duration - Preparation Buffer

Default estimasi:

*   Level 1: 60 menit.
    
*   Level 2: 120 menit.
    
*   Level 3: 150 menit.
    

Preparation buffer default: 10 menit.

Durasi dapat diatur pengguna.

Apabila jadwal terlalu berat terhadap waktu istirahat, aplikasi menyarankan penyesuaian tanpa menghakimi.

15\. NOTIFICATION SYSTEM
========================

15.1 Notification Types
-----------------------

TypeTriggerbedtimeSebelum target tidurtahajudJadwal bangun yang dihitungfajrMasuk waktu SubuhalkahfiKamis malam/JumatachievementSaat unlock milestone

15.2 Dynamic Bedtime Copy
-------------------------

Gunakan bank 30–90 pesan yang telah disetujui.

Kategori:

*   Persiapan tidur.
    
*   Refleksi malam.
    
*   Motivasi.
    
*   Istiqomah.
    
*   Menjaga energi.
    
*   Doa dan harapan.
    

Aturan rotasi:

*   Maksimal satu bedtime reminder per malam per pengguna.
    
*   Pesan berbeda setiap hari selama stok variasi tersedia.
    
*   Hindari mengulang pesan dari 14 pengiriman terakhir bila memungkinkan.
    
*   Pengguna dapat mematikan notifikasi.
    
*   Admin mengelola konten melalui dashboard.
    

15.3 Delivery Architecture
--------------------------

*   Browser melakukan push subscription melalui izin pengguna.
    
*   Backend menyimpan subscription.
    
*   Scheduler menghitung waktu pengiriman.
    
*   Worker mengirim Web Push menggunakan VAPID.
    
*   Service worker menampilkan notifikasi.
    
*   Notification URL membuka halaman terkait.
    

15.4 Notification Reliability
-----------------------------

Push delivery bersifat best effort.

Persyaratan:

*   Tidak mengirim pengingat yang sudah terlalu terlambat.
    
*   Tidak membuat duplicate notification jobs.
    
*   Reschedule bila user timezone, waktu tidur, atau wilayah berubah.
    
*   Mendukung beberapa perangkat.
    
*   Menghapus atau menonaktifkan subscription yang tidak valid.
    
*   Menghormati preferensi quiet hours.
    
*   Tidak menjanjikan akurasi alarm perangkat.
    

16\. TECHNICAL ARCHITECTURE
===========================

16.1 Recommended Stack
----------------------

LayerRecommendationFrontendNext.js + TypeScriptUI stylingTailwind CSSComponentsshadcn/ui atau komponen setaraBackendNext.js Route Handlers / server-side servicesDatabasePostgreSQLManaged backendSupabaseAuthenticationSupabase AuthAuthorizationRow Level Security + backend guardsPWAWeb Manifest + Service WorkerOffline storageIndexedDBPushWeb Push + VAPIDJob processingPersistent job queue + schedulerDeploymentVercel atau infrastruktur kompatibelMonitoringStructured logs + error monitoring

Stack ini adalah rekomendasi implementasi, bukan ketergantungan yang wajib apabila Claude memiliki alternatif dengan kemampuan setara.

16.2 High-Level Architecture
----------------------------

**Scalev Checkout**↓**Verified Webhook Endpoint**↓**Order Processing & Entitlement Service**↓**Authentication & User Profile**↓**PostgreSQL / Supabase**↓**Tahajud Tracker PWA**

Services tambahan:

*   Prayer Time Adapter.
    
*   Notification Scheduler.
    
*   Worship Session Service.
    
*   Level Progression Engine.
    
*   Quran Content Service.
    
*   Reporting Service.
    
*   Admin CMS.
    

16.3 Frontend Responsibilities
------------------------------

*   Rendering UI.
    
*   Mengelola local state.
    
*   Menyimpan offline operations.
    
*   Mengelola service worker.
    
*   Menampilkan prayer countdown.
    
*   Menjalankan input counter.
    
*   Mengelola navigation.
    
*   Menampilkan loading/error states.
    

16.4 Backend Responsibilities
-----------------------------

*   Memverifikasi transaksi.
    
*   Mengelola entitlement.
    
*   Memverifikasi session authentication.
    
*   Menegakkan authorization.
    
*   Menentukan progress level.
    
*   Mengelola session status.
    
*   Memproses operasi counter.
    
*   Mengambil jadwal salat.
    
*   Menjadwalkan notifikasi.
    
*   Menyediakan reporting.
    
*   Mengelola audit trail.
    

Frontend tidak boleh menjadi sumber kebenaran untuk kelulusan level atau status pembelian.

17\. DATABASE SCHEMA v1.1
=========================

Seluruh primary key disarankan menggunakan UUID, kecuali tabel yang memerlukan ID eksternal atau composite key.

Gunakan created\_at, updated\_at, dan timestamp UTC pada tabel yang relevan.

17.1 Users & Access
-------------------

### profiles

FieldTypeuser\_idUUID PK, references auth.usersdisplay\_nameTEXTemail\_normalizedTEXT UNIQUEregion\_idUUID nullabletimezoneTEXTonboarding\_completedBOOLEANcreated\_atTIMESTAMPTZupdated\_atTIMESTAMPTZ

### purchase\_orders

FieldTypeidUUID PKscalev\_order\_idTEXT UNIQUEcustomer\_email\_normalizedTEXTbuyer\_nameTEXTproduct\_variant\_idTEXTpayment\_statusTEXTpayment\_verified\_atTIMESTAMPTZ nullableraw\_referenceTEXTcreated\_atTIMESTAMPTZ

Order item sebaiknya dinormalisasi dalam tabel purchase\_order\_items agar multi-item order didukung.

### access\_entitlements

FieldTypeidUUID PKuser\_idUUID nullablepurchase\_order\_idUUID FKentitlement\_typeTEXTstatusTEXTstarts\_atTIMESTAMPTZexpires\_atTIMESTAMPTZ nullablerevoked\_atTIMESTAMPTZ nullable

Status:

*   pending.
    
*   active.
    
*   suspended.
    
*   revoked.
    
*   expired.
    

Untuk pembelian lifetime, expires\_at = null.

### webhook\_events

FieldTypeidUUID PKproviderTEXTexternal\_event\_idTEXTevent\_typeTEXTpayloadJSONBreceived\_atTIMESTAMPTZprocessed\_atTIMESTAMPTZ nullableprocess\_statusTEXTerror\_messageTEXT nullable

Unique constraint:provider + external\_event\_id

Event disimpan hanya setelah signature valid.

17.2 Level & Activities
-----------------------

### levels

Fields:

*   id.
    
*   level\_number.
    
*   title.
    
*   description.
    
*   required\_successful\_nights.
    
*   suggested\_period\_nights.
    
*   is\_active.
    

### level\_activity\_config

Fields:

*   id.
    
*   level\_id.
    
*   activity\_definition\_id.
    
*   sequence\_order.
    
*   phase.
    
*   required\_for\_completion.
    
*   target\_count.
    
*   content\_version.
    
*   is\_active.
    

### activity\_definitions

Fields:

*   id.
    
*   activity\_type.
    
*   title.
    
*   arabic\_text.
    
*   transliteration.
    
*   meaning.
    
*   description.
    
*   source\_reference.
    
*   source\_classification.
    
*   review\_status.
    
*   published\_version.
    

### content\_versions

Fields:

*   id.
    
*   content\_type.
    
*   content\_id.
    
*   version\_number.
    
*   snapshot\_json.
    
*   reviewer\_id.
    
*   published\_at.
    

Konten Quran verbatim tidak boleh diedit dengan CMS biasa. Sistem hanya mengelola versi dataset dan metadata terkait.

17.3 Worship Tracking
---------------------

### night\_sessions

FieldTypeidUUID PKuser\_idUUID FKfajr\_local\_dateDATEtimezoneTEXTregion\_idUUIDlevel\_idUUIDlevel\_config\_versionTEXTstatusTEXTstarted\_atTIMESTAMPTZ nullablecompleted\_atTIMESTAMPTZ nullableclosed\_atTIMESTAMPTZ nullable

Unique constraint:user\_id + fajr\_local\_date

### session\_activities

Fields:

*   id.
    
*   session\_id.
    
*   activity\_definition\_id.
    
*   activity\_config\_snapshot.
    
*   phase.
    
*   target\_count.
    
*   actual\_count.
    
*   required\_for\_completion.
    
*   status.
    
*   completed\_at.
    
*   reported\_at.
    
*   version.
    

### counter\_operations

Fields:

*   id.
    
*   client\_operation\_id UNIQUE.
    
*   user\_id.
    
*   session\_activity\_id.
    
*   delta.
    
*   server\_applied\_at.
    
*   client\_recorded\_at.
    

Gunakan transaksi database saat menerapkan operasi.

### session\_audit\_logs

Fields:

*   id.
    
*   session\_id.
    
*   actor\_id.
    
*   operation\_type.
    
*   previous\_value.
    
*   new\_value.
    
*   occurred\_at.
    

17.4 Quran
----------

### quran\_surahs

Fields:

*   surah\_number.
    
*   arabic\_name.
    
*   latin\_name.
    
*   verse\_count.
    
*   source\_version.
    

### quran\_verses

Fields:

*   surah\_number.
    
*   verse\_number.
    
*   arabic\_uthmani.
    
*   translation\_id nullable.
    
*   source\_version.
    

Unique:surah\_number + verse\_number + source\_version

### quran\_reading\_progress

Fields:

*   user\_id.
    
*   surah\_number.
    
*   last\_verse.
    
*   status.
    
*   updated\_at.
    
*   completed\_at.
    

### session\_quran\_completions

Fields:

*   user\_id.
    
*   session\_id.
    
*   surah\_number.
    
*   completion\_type.
    
*   completed\_at.
    

17.5 Notifications
------------------

### notification\_preferences

Fields:

*   user\_id.
    
*   bedtime\_enabled.
    
*   bedtime\_local\_time.
    
*   bedtime\_offset\_minutes.
    
*   tahajud\_enabled.
    
*   fajr\_enabled.
    
*   alkahfi\_enabled.
    
*   quiet\_hours\_start.
    
*   quiet\_hours\_end.
    
*   timezone.
    

### push\_subscriptions

Fields:

*   id.
    
*   user\_id.
    
*   endpoint.
    
*   public\_key.
    
*   auth\_key.
    
*   device\_label.
    
*   is\_active.
    
*   created\_at.
    
*   last\_success\_at.
    

Subscription secrets harus disimpan dengan perlindungan yang sesuai.

### notification\_templates

Fields:

*   id.
    
*   category.
    
*   title.
    
*   body.
    
*   is\_active.
    
*   version.
    
*   approved\_at.
    

### notification\_jobs

Fields:

*   id.
    
*   user\_id.
    
*   notification\_type.
    
*   scheduled\_at.
    
*   local\_schedule\_date.
    
*   template\_id.
    
*   status.
    
*   dedupe\_key.
    
*   attempt\_count.
    

### notification\_deliveries

Fields:

*   id.
    
*   job\_id.
    
*   subscription\_id.
    
*   delivery\_status.
    
*   attempted\_at.
    
*   provider\_response.
    

17.6 Prayer Times
-----------------

### regions

Fields:

*   id.
    
*   province\_name.
    
*   city\_name.
    
*   provider\_region\_code.
    
*   timezone.
    
*   is\_supported.
    

### prayer\_times

Fields:

*   id.
    
*   region\_id.
    
*   local\_date.
    
*   fajr\_at.
    
*   maghrib\_at.
    
*   provider.
    
*   fetched\_at.
    
*   source\_revision.
    

Unique:region\_id + local\_date + provider

18\. DATABASE SECURITY & ACCESS RULES
=====================================

18.1 User Data
--------------

Pengguna hanya boleh membaca dan mengubah:

*   Profile sendiri.
    
*   Night sessions sendiri.
    
*   Session activities sendiri.
    
*   Quran reading progress sendiri.
    
*   Notification preferences sendiri.
    

18.2 Admin Data
---------------

Admin hanya boleh mengakses data sesuai role.

Role yang direkomendasikan:

*   super\_admin.
    
*   content\_admin.
    
*   support\_admin.
    
*   reporting\_admin.
    

Gunakan prinsip least privilege.

18.3 Backend-Only Tables
------------------------

*   webhook\_events.
    
*   purchase\_orders.
    
*   access\_entitlements write operations.
    
*   notification\_jobs.
    
*   notification\_deliveries.
    
*   audit\_logs.
    

Tabel ini tidak boleh memiliki akses tulis langsung dari browser.

18.4 RLS
--------

Aktifkan Row Level Security pada tabel privat yang terekspos melalui API database.

Backend wajib melakukan authorization tambahan terhadap entitlement aktif.

Jangan mengandalkan frontend route guard sebagai satu-satunya perlindungan.

19\. API CONTRACTS v1.1
=======================

Semua endpoint berikut merupakan API internal Tahajud Tracker, bukan endpoint asli Scalev atau SIHAT.

Prefix:

/api/v1

Semua endpoint privat membutuhkan session authentication dan entitlement valid, kecuali endpoint login, status akses terbatas, dan webhook resmi.

19.1 Authentication & Access
----------------------------

MethodEndpointPurposePOST/auth/request-otpMeminta kode loginPOST/auth/verify-otpVerifikasi OTPGET/meProfil loginGET/me/accessStatus entitlementPOST/auth/logoutLogout

### Access Response

Minimum fields:

*   authenticated.
    
*   access\_status.
    
*   entitlement\_type.
    
*   expires\_at.
    
*   onboarding\_completed.
    

Jangan membocorkan status pembelian email lain melalui endpoint publik.

19.2 Profile & Onboarding
-------------------------

MethodEndpointPurposeGET/me/profileGet profilePATCH/me/profileUpdate profilePUT/me/locationSet wilayahPUT/me/preferencesSet preferencesPOST/me/onboarding/completeComplete onboarding

19.3 Prayer Times
-----------------

MethodEndpointPurposeGET/regionsList wilayahGET/prayer-timesPrayer data per wilayah/tanggalGET/me/next-fajrJadwal Subuh berikutnyaGET/me/wake-planRecommended wake-up

Response harus memuat:

*   region.
    
*   local date.
    
*   timezone.
    
*   Fajr time.
    
*   Maghrib time jika diminta.
    
*   source.
    
*   cache status.
    

19.4 Worship
------------

MethodEndpointPurposeGET/me/current-levelLevel aktifGET/me/level-progressProgressGET/me/night-sessionSesi aktifPOST/me/night-sessionsCreate/get sessionGET/night-sessions/:idDetail sessionPOST/night-sessions/:id/startStart sessionPUT/session-activities/:id/statusUpdate checklistPOST/session-activities/:id/counter-operationsCounter syncPOST/night-sessions/:id/completeRequest completionPOST/night-sessions/:id/excuseExcuse session

### Counter Operation Request

Fields:

*   operation\_id: UUID.
    
*   delta: integer.
    
*   client\_recorded\_at: ISO timestamp.
    

Server returns:

*   accepted operation ID.
    
*   authoritative count.
    
*   target.
    
*   completed status.
    
*   updated\_at.
    

### Completion Response

Fields:

*   session\_id.
    
*   session\_status.
    
*   successful\_nights.
    
*   required\_successful\_nights.
    
*   current\_level.
    
*   next\_level\_unlocked.
    
*   next\_level\_effective\_date.
    

Server computes these fields and must not trust a completion flag from the client.

19.5 Reporting
--------------

MethodEndpointPurposeGET/me/dashboardDashboard summaryGET/me/reportsReports by periodGET/me/calendarCalendar statusesGET/me/activity-statsPer-activity reportingGET/me/session-historyHistory

Dashboard response minimum:

*   level.
    
*   level\_progress.
    
*   prayer\_time.
    
*   status\_counts.
    
*   completion\_rate.
    
*   calendar\_days.
    
*   activity\_statistics.
    
*   insight\_template.
    
*   current\_session.
    

19.6 Quran
----------

MethodEndpointPurposeGET/quran/surahsSurah listGET/quran/surahs/:idFull surahGET/me/quran-progressReading progressPUT/me/quran-progress/:surahSave reading positionPOST/me/quran-completionsRecord completion

19.7 Notifications
------------------

MethodEndpointPurposeGET/me/notification-preferencesGet preferencesPUT/me/notification-preferencesUpdate preferencesPOST/me/push-subscriptionsRegister deviceDELETE/me/push-subscriptions/:idRemove deviceGET/me/notificationsNotification history

19.8 Scalev Webhook
-------------------

**Endpoint:**

POST /api/v1/webhooks/scalev

Handler:

1.  Read raw request body.
    
2.  Verify X-Scalev-Hmac-Sha256 using webhook signing secret.
    
3.  Reject invalid signatures.
    
4.  Parse payload.
    
5.  Store event with unique ID.
    
6.  Acknowledge after durable storage.
    
7.  Process asynchronously.
    
8.  Reconcile payment state and purchased variants.
    
9.  Update entitlement.
    
10.  Trigger onboarding email when appropriate.
    

Do not perform long-running email sending directly in the webhook request.

20\. SCALEV PAYMENT INTEGRATION LOGIC
=====================================

20.1 Relevant Events
--------------------

*   order.created.
    
*   order.updated.
    
*   order.payment\_status\_changed.
    
*   payment.received.
    
*   payment.failed.
    

payment.received menjadi event utama pemberian akses, setelah validasi produk dan status.

20.2 Idempotency
----------------

Dua jenis deduplication diperlukan:

**Event-level:** Scalev event unique ID.

**Fulfillment-level:** kombinasi order valid dan entitlement product.

Pembayaran yang berubah dari paid ke settled tidak boleh menciptakan akses kedua.

20.3 Order Reconciliation
-------------------------

Jika webhook pembayaran tiba sebelum detail order tersedia:

*   Simpan event.
    
*   Tandai awaiting order verification.
    
*   Fetch/reconcile data order melalui API yang tersedia.
    
*   Retry dengan backoff.
    
*   Aktifkan akses hanya setelah verifikasi lengkap.
    

20.4 Account Provisioning
-------------------------

Identitas pembeli dihubungkan melalui email yang telah dinormalisasi.

Namun, email yang diterima dari transaksi bukan bukti bahwa orang yang membuka aplikasi adalah pemiliknya.

Verifikasi OTP/magic link wajib dilakukan sebelum menghubungkan entitlement ke akun.

20.5 Refund & Suspension
------------------------

Status refund/reversal harus diverifikasi terhadap data resmi Scalev atau melalui proses admin yang diaudit.

Jangan menonaktifkan akses hanya berdasarkan informasi tidak terverifikasi.

Kebijakan pencabutan akses mengikuti keputusan bisnis.

21\. OFFLINE-FIRST SYNCHRONIZATION
==================================

21.1 Offline Features
---------------------

Saat offline pengguna tetap dapat:

*   Melihat data sesi yang sudah tersedia.
    
*   Menandai checklist.
    
*   Menggunakan dzikir counter.
    
*   Membaca surah yang sudah dicache.
    
*   Melihat jadwal salat tersimpan jika masih relevan.
    

21.2 Sync Queue
---------------

Gunakan IndexedDB untuk menyimpan pending mutations.

Setiap mutation harus memiliki:

*   Operation ID.
    
*   User ID scope.
    
*   Entity ID.
    
*   Operation type.
    
*   Payload.
    
*   Client timestamp.
    
*   Sync status.
    

21.3 Conflict Rules
-------------------

*   Server menjadi sumber data final.
    
*   Counter menggunakan idempotent delta operations.
    
*   Checklist menggunakan versioning atau aturan deterministic update.
    
*   Perubahan yang konflik harus dapat direkonsiliasi tanpa menghapus data diam-diam.
    
*   Operasi dari akun berbeda tidak boleh tercampur pada perangkat bersama.
    

21.4 Sign-out
-------------

Saat logout:

*   Hapus token sesi.
    
*   Hapus data privat offline sesuai kebijakan keamanan.
    
*   Pisahkan seluruh cache yang terkait identitas pengguna.
    

22\. REPORTING ENGINE
=====================

22.1 Core Metrics
-----------------

*   Total sessions.
    
*   Completed sessions.
    
*   Partial sessions.
    
*   Missed sessions.
    
*   Excused sessions.
    
*   Completion rate.
    
*   Activity completion frequency.
    
*   Active level progress.
    

22.2 Formula
------------

Completion Rate = Completed / (Completed + Partial + Missed) × 100%

Sesi excused dan upcoming tidak dihitung.

Jika penyebut nol, tampilkan empty state atau "Belum ada data", bukan 0% yang terkesan sebagai kegagalan.

22.3 Historical Integrity
-------------------------

Laporan historis menggunakan snapshot level dan requirement pada waktu sesi berlangsung.

Perubahan target admin hari ini tidak mengubah laporan masa lalu.

22.4 Insight Rules
------------------

Gunakan template:

*   First completed session.
    
*   Progress milestone.
    
*   Improvement.
    
*   Stable consistency.
    
*   Return after inactivity.
    

Hindari:

*   Spiritual scoring.
    
*   Public ranking.
    
*   Shame-based notifications.
    
*   Kesimpulan mengenai kualitas iman pengguna.
    

23\. ADMIN CONTENT MANAGEMENT
=============================

23.1 Admin Dashboard
--------------------

Menampilkan:

*   Active entitlements.
    
*   Completed onboardings.
    
*   User engagement aggregate.
    
*   Level distribution.
    
*   Integration health.
    
*   Notification delivery health.
    
*   Failed webhook jobs.
    
*   Prayer time sync status.
    

23.2 Amalan Manager
-------------------

Admin dapat:

*   Mengubah judul.
    
*   Mengubah urutan.
    
*   Mengubah target.
    
*   Mengatur fase.
    
*   Mengatur required/optional.
    
*   Mengedit penjelasan.
    
*   Menambah referensi.
    
*   Membuat draft.
    
*   Submit review.
    
*   Publish versi baru.
    

23.3 Review Workflow
--------------------

Draft → In Review → Approved → Published

Konten agama membutuhkan persetujuan reviewer yang ditunjuk.

23.4 Notification CMS
---------------------

Admin dapat:

*   Menambahkan template.
    
*   Mengedit template.
    
*   Preview mobile.
    
*   Mengatur kategori.
    
*   Menonaktifkan template.
    
*   Melihat riwayat pengiriman agregat.
    

23.5 Admin Audit
----------------

Setiap perubahan penting menyimpan:

*   Actor.
    
*   Entity.
    
*   Action.
    
*   Before/after snapshot.
    
*   Timestamp.
    
*   Approval reference jika diperlukan.
    

24\. SECURITY & PRIVACY REQUIREMENTS
====================================

24.1 Authentication
-------------------

*   Email OTP/magic link.
    
*   Secure session cookie.
    
*   HTTPS.
    
*   Rate limiting.
    
*   Session expiration.
    
*   Proteksi brute force.
    
*   Account enumeration prevention.
    

24.2 Authorization
------------------

*   Active entitlement wajib untuk mengakses fitur berbayar.
    
*   Admin role diverifikasi pada server.
    
*   Database RLS.
    
*   Backend service keys tidak pernah tersedia di frontend.
    

24.3 External Secrets
---------------------

Simpan secara aman:

*   Scalev API key.
    
*   Scalev signing secret.
    
*   SIHAT API token.
    
*   Supabase service credentials.
    
*   Web Push private key.
    

24.4 Data Privacy
-----------------

*   Jangan membuat leaderboard publik.
    
*   Jangan menyimpan isi doa pribadi.
    
*   Jangan menyimpan alasan medis untuk excused session.
    
*   Hindari penyimpanan GPS presisi bila kode wilayah mencukupi.
    
*   Sediakan kebijakan privasi.
    
*   Sediakan mekanisme permintaan penghapusan data.
    
*   Tetapkan retensi log serta data transaksi sesuai kewajiban bisnis dan hukum yang berlaku.
    

25\. PERFORMANCE & RELIABILITY REQUIREMENTS
===========================================

Target awal yang direkomendasikan:

CategoryTargetMobile Lighthouse Performance≥ 85 pada perangkat uji yang disepakatiAccessibilityWCAG AACore API latencyP95 < 800 ms, di luar provider eksternalDashboard loadTarget < 3 detik pada jaringan pengujianCounter persistenceTidak kehilangan operasi yang sudah tersimpanWebhook handlingIdempotentDatabase backupAutomated daily backupNotification jobsRetry + dedupeError monitoringRequiredProduction HTTPSRequired

Lighthouse dan latency merupakan target engineering, bukan jaminan pada semua perangkat dan koneksi.

Monitoring wajib mencakup:

*   Failed Scalev event processing.
    
*   Failed email delivery.
    
*   Failed prayer time sync.
    
*   Failed push delivery.
    
*   Offline synchronization failures.
    
*   Unexpected session progression errors.
    

26\. CORE UI STATES
===================

Setiap halaman inti harus memiliki:

1.  Loading.
    
2.  Empty.
    
3.  Success.
    
4.  Error.
    
5.  Offline jika relevan.
    
6.  Permission denied jika relevan.
    
7.  Session expired.
    
8.  Access denied jika relevan.
    

Required Special States
-----------------------

**Purchase Pending:** pembayaran belum terverifikasi.

**No Active Access:** entitlement tidak aktif.

**Prayer Data Stale:** data salat tidak berhasil diperbarui.

**Push Unavailable:** perangkat tidak mendukung.

**Level Locked:** level belum terbuka.

**Missed Night:** tampilkan komunikasi suportif tanpa reset.

**Counter Syncing:** operasi tersimpan lokal dan menunggu sinkronisasi.

**Content Not Reviewed:** konten tidak dapat dipublikasikan.

27\. ACCEPTANCE TEST CASES
==========================

Gunakan format Given / When / Then.

AUTH-01 — Valid Purchase
------------------------

**Given** pembeli telah membayar produk yang sesuai.

**When** Scalev payment webhook terverifikasi diproses.

**Then** entitlement dibuat aktif dan pembeli dapat login setelah verifikasi email.

AUTH-02 — Invalid Signature
---------------------------

**Given** webhook dengan signature tidak valid.

**When** request diterima.

**Then** server menolak tanpa memproses transaksi.

AUTH-03 — Duplicate Payment
---------------------------

**Given** event pembayaran yang sudah diproses.

**When** event dikirim ulang.

**Then** tidak ada duplikasi akun atau entitlement.

AUTH-04 — Wrong Product
-----------------------

**Given** pembayaran sukses untuk produk Scalev yang bukan Tahajud Tracker.

**When** webhook diproses.

**Then** akses Tahajud Tracker tidak diaktifkan.

AUTH-05 — Unverified Email
--------------------------

**Given** order valid tetapi email belum diverifikasi pemilik akun.

**When** seseorang mencoba mengakses dashboard.

**Then** akses diblokir sampai verifikasi berhasil.

LEVEL-01 — New User
-------------------

**Given** akun baru.

**When** onboarding selesai.

**Then** Level 1 aktif dan Level 2–3 terkunci.

LEVEL-02 — Missed Night
-----------------------

**Given** pengguna memiliki lima sesi berhasil.

**When** satu malam terlewat.

**Then** progress tetap lima sesi berhasil.

LEVEL-03 — Level Unlock
-----------------------

**Given** Level 1 membutuhkan tujuh hari berhasil.

**When** keberhasilan ketujuh selesai.

**Then** Level 2 terbuka untuk sesi berikutnya.

LEVEL-04 — No Mid-Session Switch
--------------------------------

**Given** pengguna memenuhi syarat unlock pada sesi saat ini.

**When** level baru terbuka.

**Then** daftar aktivitas sesi saat ini tidak berubah.

LEVEL-05 — Historical Accuracy
------------------------------

**Given** admin mengubah target dzikir.

**When** laporan lama dibuka.

**Then** hasil sesi lama tetap sesuai target yang berlaku saat itu.

SESSION-01 — Date Boundary
--------------------------

**Given** pengguna mulai ibadah sebelum tengah malam dan selesai setelahnya.

**When** sesi disimpan.

**Then** seluruh aktivitas dikaitkan pada tanggal Subuh yang sama.

SESSION-02 — Excused
--------------------

**Given** sesi dikecualikan oleh pengguna.

**When** laporan dihitung.

**Then** sesi tidak mengurangi jumlah keberhasilan atau completion rate.

DZIKIR-01 — Normal Counter
--------------------------

**Given** counter pada 20/100.

**When** tombol tambah ditekan.

**Then** nilai menjadi 21/100 dan tersimpan.

DZIKIR-02 — Offline Counter
---------------------------

**Given** pengguna offline.

**When** counter ditambah beberapa kali.

**Then** nilai disimpan lokal dan tersinkron saat online tanpa hitungan ganda.

DZIKIR-03 — Duplicate Sync
--------------------------

**Given** satu operation ID telah diproses.

**When** operasi dikirim lagi.

**Then** count tidak bertambah dua kali.

PRAYER-01 — Region Change
-------------------------

**Given** lokasi pengguna berubah.

**When** wilayah diperbarui.

**Then** jadwal Subuh dan rekomendasi tahajud dihitung ulang.

PRAYER-02 — Missing Provider
----------------------------

**Given** provider jadwal gagal.

**When** dashboard dibuka.

**Then** cache valid digunakan dengan label yang jelas atau error state ditampilkan.

NOTIF-01 — Daily Rotation
-------------------------

**Given** bedtime reminder aktif.

**When** dua malam berturut-turut diproses.

**Then** template pesan berbeda selama pilihan yang memenuhi aturan rotasi tersedia.

NOTIF-02 — Disabled
-------------------

**Given** user menonaktifkan pengingat tidur.

**When** scheduler berjalan.

**Then** tidak ada reminder tidur yang dikirim.

NOTIF-03 — Push Unsupported
---------------------------

**Given** browser tidak mendukung Web Push.

**When** pengaturan dibuka.

**Then** aplikasi menampilkan penjelasan dan panduan alarm manual.

QURAN-01 — Text Integrity
-------------------------

**Given** Quran Reader membuka sebuah surah.

**When** teks ditampilkan.

**Then** seluruh ayat cocok dengan dataset tervalidasi pada versi yang dipilih.

QURAN-02 — Bookmark
-------------------

**Given** pengguna berhenti pada ayat tertentu.

**When** kembali ke Reader.

**Then** posisi terakhir dipulihkan.

REPORT-01 — Accuracy
--------------------

**Given** terdapat empat completed, dua partial, dan satu missed.

**When** filter tujuh hari dipilih.

**Then** completion rate adalah 4/7 atau sekitar 57,14%.

REPORT-02 — No Data
-------------------

**Given** pengguna baru tanpa sesi.

**When** dashboard dibuka.

**Then** tampil empty state yang ramah, bukan statistik menyesatkan.

SECURITY-01 — Cross-User Access
-------------------------------

**Given** User A mencoba membaca session ID User B.

**When** endpoint dipanggil.

**Then** server menolak akses.

SECURITY-02 — Expired Entitlement
---------------------------------

**Given** entitlement pengguna tidak lagi aktif.

**When** API premium dipanggil.

**Then** akses diblokir sesuai aturan entitlement tanpa menghapus data historis.

28\. QA & PRE-LAUNCH VALIDATION
===============================

28.1 UI QA
----------

*   Mobile 320 px.
    
*   Android Chrome.
    
*   iPhone Safari.
    
*   Installed PWA.
    
*   Desktop Chrome.
    
*   Tablet landscape.
    
*   Dark mode.
    
*   Large font.
    
*   Screen reader.
    
*   Reduced motion.
    

28.2 Arabic QA
--------------

Periksa:

*   Rasm Utsmani.
    
*   Harakat.
    
*   Waqaf.
    
*   Ayat marker.
    
*   RTL direction.
    
*   Font clipping.
    
*   Arabic line breaking.
    
*   Quran source attribution.
    

28.3 Payment QA
---------------

*   Paid.
    
*   Settled.
    
*   Pending.
    
*   Failed.
    
*   Duplicate webhook.
    
*   Out-of-order webhook.
    
*   Wrong product.
    
*   Missing order details.
    
*   Email verification.
    
*   Reconciliation retry.
    

28.4 Notification QA
--------------------

*   Android installed PWA.
    
*   iPhone Home Screen PWA.
    
*   Permission allowed.
    
*   Permission denied.
    
*   No subscription.
    
*   Changed timezone.
    
*   Changed sleep time.
    
*   Late notification.
    
*   Duplicate jobs.
    

29\. DEVELOPMENT PHASES
=======================

Phase 1 — Foundation & UI
-------------------------

Deliverables:

*   Project setup.
    
*   Design tokens.
    
*   Component library.
    
*   Navigation.
    
*   Auth screens.
    
*   Onboarding screens.
    
*   Dashboard UI.
    
*   Amalan UI.
    
*   Counter UI.
    
*   Quran Reader UI.
    
*   Reporting UI.
    
*   Responsive layouts.
    

Gunakan mock data berlabel demo dan kontrak API terstruktur.

Phase 2 — Data & Business Logic
-------------------------------

Deliverables:

*   Database migrations.
    
*   Authentication.
    
*   Row Level Security.
    
*   User profiles.
    
*   Session engine.
    
*   Level progression.
    
*   Counter persistence.
    
*   Reporting calculations.
    
*   Offline mutation queue.
    

Phase 3 — External Integrations
-------------------------------

Deliverables:

*   Scalev webhooks.
    
*   Entitlement reconciliation.
    
*   SIHAT prayer time adapter.
    
*   Web Push subscriptions.
    
*   Notification scheduler.
    
*   Email delivery.
    
*   Quran source import.
    

Phase 4 — Admin & Content
-------------------------

Deliverables:

*   Admin login.
    
*   Amalan management.
    
*   Level config.
    
*   Content versioning.
    
*   Notification CMS.
    
*   Integration monitoring.
    
*   Audit logs.
    

Phase 5 — Production QA
-----------------------

Deliverables:

*   End-to-end tests.
    
*   Security review.
    
*   Arabic QA.
    
*   Religious content review.
    
*   Accessibility review.
    
*   Cross-browser validation.
    
*   Performance tuning.
    
*   Deployment.
    
*   Monitoring.
    
*   Backup and recovery check.
    

30\. ACCEPTED DEFAULTS & PENDING APPROVALS
==========================================

Bagian ini membedakan keputusan produk yang sudah disepakati dan konfigurasi yang masih membutuhkan persetujuan.

30.1 Confirmed
--------------

*   PWA only.
    
*   Scalev paid access.
    
*   Passwordless authentication.
    
*   Three levels.
    
*   Non-reset cumulative progress.
    
*   Dashboard Istiqomah homepage.
    
*   Location-based Fajr.
    
*   Dynamic bedtime reminder.
    
*   Earth Tone visual.
    
*   Quran Reader dengan surah pilihan.
    
*   Personal reporting.
    

30.2 Provisional Defaults
-------------------------

*   Level 1: 7 successful nights.
    
*   Level 2: 12 successful nights.
    
*   Level 3: 20 successful nights.
    
*   Suggested periods: 14/21/30 nights.
    
*   Level 1 tahlil 100 inti + 200 tambahan.
    
*   Advanced post-Fajr sequence khusus Level 3.
    
*   Lifetime entitlement tanpa expiry.
    
*   Waktu penutupan sesi pukul 12.00 lokal.
    
*   Backfill window 48 jam.
    
*   Smart wake-up allocation 60/120/150 menit.
    
*   Bedtime bank minimal 30 pesan.
    

30.3 Mandatory Review Before Launch
-----------------------------------

1.  Verifikasi lafaz "Ya Khafi".
    
2.  Verifikasi teks dzikir Arab secara keseluruhan.
    
3.  Persetujuan pembimbing untuk susunan salat dan bacaan.
    
4.  Pengelompokan amalan sunnah umum versus wirid program.
    
5.  Konfirmasi aktivitas yang wajib untuk completion aplikasi.
    
6.  Konfirmasi target kelulusan level.
    
7.  Konfirmasi post-Fajr Level 3.
    
8.  Persetujuan kebijakan lifetime access.
    
9.  Izin API resmi prayer data.
    
10.  Lisensi Quran dan terjemahan.
    
11.  Kebijakan privasi serta retensi data.
    
12.  Pemeriksaan akurasi jadwal dan notifikasi.
    

31\. DEFINITION OF DONE
=======================

MVP dinyatakan selesai apabila:

*   Seluruh flow utama dapat dijalankan.
    
*   Pembeli Scalev mendapatkan akses otomatis setelah validasi.
    
*   User login menggunakan email terverifikasi.
    
*   Lokasi dan jadwal Subuh berfungsi.
    
*   Dashboard reporting menggunakan data aktual.
    
*   Ketiga level berfungsi.
    
*   Progress tidak di-reset saat malam terlewat.
    
*   Counter menyimpan hitungan dengan benar.
    
*   Quran Reader menggunakan data terverifikasi.
    
*   Notifikasi memiliki konfigurasi dan rotasi pesan.
    
*   Offline mutations disinkronkan dengan aman.
    
*   Admin dapat mengatur konten dan level.
    
*   RLS dan akses premium lulus pengujian.
    
*   Seluruh test case kritis lulus.
    
*   Konten agama mendapat persetujuan reviewer.
    
*   Tidak ada placeholder data atau secret hardcoded di production.
    
*   Monitoring dan backup aktif.
    

32\. EXECUTION BRIEF FOR CLAUDE
===============================

Role
----

Act as a senior product designer, UX architect, and full-stack engineer specializing in mobile-first Progressive Web Applications.

Mission
-------

Build Tahajud Tracker by NgajiGaes according to PRD v1.1.

Implementation Priorities
-------------------------

1.  Deliver polished mobile-first UI.
    
2.  Preserve NgajiGaes Earth Tone brand.
    
3.  Make the Istiqomah Dashboard the main experience.
    
4.  Build reusable components.
    
5.  Implement configuration-driven worship activities.
    
6.  Implement server-authoritative level progression.
    
7.  Prepare secure paid-access integration with Scalev.
    
8.  Design precise location-based prayer scheduling.
    
9.  Implement persistent dzikir counter.
    
10.  Use verified Quran text only.
    
11.  Respect PWA push-notification limitations.
    
12.  Preserve privacy and accessibility.
    

Mandatory Engineering Standards
-------------------------------

*   TypeScript strict mode.
    
*   Reusable components.
    
*   Explicit API contracts.
    
*   Database migrations.
    
*   Server-side validation.
    
*   Row Level Security.
    
*   Idempotent external events.
    
*   Versioned religious content.
    
*   Safe offline synchronization.
    
*   Structured errors.
    
*   Automated tests.
    
*   No secrets in client code.
    

Required Output Order
---------------------

**Step 1:** Create complete sitemap and user flow.

**Step 2:** Implement design system and responsive UI components.

**Step 3:** Build a navigable interactive prototype with clearly marked mock data.

**Step 4:** Define database migrations and application services.

**Step 5:** Implement authentication, entitlement, sessions, and progression.

**Step 6:** Implement Quran Reader, counter, reporting, and offline support.

**Step 7:** Integrate verified external providers when credentials are available.

**Step 8:** Build admin tools.

**Step 9:** Run automated and manual QA.

**Step 10:** Deliver deployment documentation, configuration checklist, and known limitations.

Non-Negotiable Constraints
--------------------------

*   Do not build native mobile apps.
    
*   Do not promise guaranteed system alarms from a PWA.
    
*   Do not fabricate Quran text.
    
*   Do not fabricate external API responses in production.
    
*   Do not grant access based only on a client-side payment claim.
    
*   Do not reset level progress after a missed night.
    
*   Do not make public worship rankings.
    
*   Do not treat all prescribed program practices as obligatory religious requirements.
    
*   Do not silently invent approval for provisional religious content.
    
*   Do not expose private webhook secrets, API keys, or user worship details.
    

Final Expected Deliverable
--------------------------

A secure, mobile-first, responsive Tahajud Tracker PWA with:

*   NgajiGaes branding.
    
*   Scalev-based paid access.
    
*   Passwordless login.
    
*   Onboarding.
    
*   Location-based prayer times.
    
*   Dashboard Istiqomah.
    
*   Three-level worship tracking.
    
*   Persistent dzikir counter.
    
*   Quran Reader.
    
*   Reporting and calendar.
    
*   Dynamic bedtime reminders.
    
*   Notification settings.
    
*   Admin content management.
    
*   Database and API architecture.
    
*   Automated testing.
    
*   Deployment readiness documentation.
    

**END OF PRD v1.1**

**Tahajud Tracker by NgajiGaes****Product Design & Technical Implementation Baseline**