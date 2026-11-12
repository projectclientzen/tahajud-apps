# Sesi S4a (Agen B, ronde 2): offline, service worker, data auth dan profil

Branch: `claude/peaceful-thompson-lwndtd` · Basis: `origin/main` @ `05e2aa5` · Tanggal: 2026-11-12
Brief: `docs/briefs/AGENT-B-S4a.md`. Hanya data, offline, dan komponen PWA. Tidak ada layar auth atau onboarding.

## Ringkasan: REAL vs SIMULATED

| Bagian                                                                      | Status          | Catatan                                                                                         |
| --------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| Antrean mutasi offline (`src/offline/queue.ts`, `sender.ts`, `triggers.ts`) | REAL            | IndexedDB per user, diuji dengan `fake-indexeddb`. Belum dipasang ke layar (ronde 3)            |
| Service worker `public/sw.js` + `public/offline.html`                       | REAL            | Diuji di build production (Playwright, Chromium). Belum diuji di Safari iOS                     |
| Registrasi SW dan prompt update                                             | REAL            | Terdaftar di root layout. Prompt update belum ditempatkan di layar                              |
| `InstallGuide`, `UpdatePrompt`                                              | REAL (komponen) | Ada di `/dev/pwa` (hanya non-production). Teks langkah belum dicek di perangkat nyata           |
| `requestPersistentStorage()`                                                | REAL            | Belum dipanggil dari layar mana pun                                                             |
| Aturan OTP (`src/domain/auth/**`)                                           | REAL            | Pure TS, angka tetap dari PRD §24.1                                                             |
| `MockAuth` (`src/data/mock/auth.ts`)                                        | SIMULATED       | Tidak ada email terkirim. Kode OTP hanya lewat `dev.peekOtp()`                                  |
| `ProfileRepository` (mock)                                                  | SIMULATED       | Memakai engine mock S2                                                                          |
| Mode `live` untuk auth dan profil                                           | STUB            | `NOT_AVAILABLE` sampai S5                                                                       |
| Background Sync API                                                         | TIDAK DIBUAT    | PRD §21.2 menulis "jika didukung". Cukup flush saat online, app dibuka, tab terlihat, dan timer |

## Yang dikerjakan

1. **Auth mock.** `AuthRepository` (`requestOtp`, `verifyOtp`, `getSession`, `logout`, `listDevices`, `revokeDevice`), `createAuthLayer()`, 5 skenario: `logged_out`, `logged_in`, `purchase_pending`, `no_active_access`, `session_expired`. Respons `requestOtp` identik untuk email berakses dan tidak. Gagal verifikasi selalu satu pesan: "Kode tidak valid atau sudah kedaluwarsa."
2. **Profil.** `ProfileRepository` di `DataLayer`: `getProfile`, `updateProfile`, `setLocation`, `completeOnboarding`, `updatePreferences`. Skenario data baru: `onboarding_pending`, `no_active_access`. State lama (tanpa `profile`) diisi default saat dimuat.
3. **Antrean offline.** Field PRD §21.2 (+ `seq`, `next_attempt_at`, `last_error`). API: `enqueue`, `pendingCount`, `getSnapshot`/`subscribe` (siap `useSyncExternalStore`), `flushNow`, `flushDue`, `canLogoutSafely`, `listRejected`, `dismissRejected`, `nextAttemptAt`, `purgeUser`. Retry backoff 2 dtk sampai 5 menit. `accepted` dan `duplicate` jadi terkirim dan dihapus, `rejected` disimpan dengan kode alasan.
4. **Sender.** `createLayerSender(layer)` memetakan antrean ke `DataLayer` (batch counter maks 50, urutan terjaga). Konflik versi checklist: nilai server menang, aksi user diterapkan ulang hanya jika masih mengubah sesuatu.
5. **Service worker.** Manual, tanpa dependency. Cache shell dan aset statis. `/api/` tidak disentuh sama sekali.
6. **Komponen PWA.** `InstallGuide` (Android, iPhone/iPad dengan "Bagikan > Tambah ke Layar Utama", komputer; deteksi standalone), `UpdatePrompt`, `ServiceWorkerRegister`.
7. **ESLint.** `no-restricted-imports` untuk `src/domain/**` (react, react-dom, next, `@/components`, `@/app`, `@/data`, `@/offline`). Diverifikasi dengan file uji yang sengaja melanggar, lalu dihapus.

## Keputusan teknis

| #      | Keputusan                                                                                                                                                    | Alasan                                                                                                       | Alternatif ditolak                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| S4a-1  | Service worker ditulis manual (`public/sw.js`), bukan Serwist                                                                                                | Kebutuhan kecil (4 aturan), nol dependency, nol perubahan `next.config.ts`, mudah diuji lewat `vm`           | Serwist: plugin webpack dan manifest precache untuk hal yang tidak kita butuhkan |
| S4a-2  | Aset `/_next/static/` di-cache saat pertama dipakai (cache-first), tidak di-precache                                                                         | Nama file ber-hash, jadi tidak pernah basi. Halaman yang belum pernah dibuka offline jatuh ke `offline.html` | Precache semua chunk: butuh manifest build                                       |
| S4a-3  | Halaman HTML hanya disimpan jika `Cache-Control` tidak memuat `private` atau `no-store`                                                                      | Halaman yang berisi data satu orang tidak boleh tersalin di perangkat bersama                                | Menyimpan semua navigasi                                                         |
| S4a-4  | Update SW menunggu `SKIP_WAITING` dari halaman                                                                                                               | Update tidak mengganti kode di tengah counter yang sedang dipakai                                            | `skipWaiting()` otomatis                                                         |
| S4a-5  | Satu database `tahajud-<userId>` versi 2 berisi store `state` (mock) dan `queue`. Koneksi dibagi dan ditutup saat tab lain upgrade atau hapus                | PRD §21.2: satu database per user. `purgeUser` jadi satu `deleteDB`. Upgrade dari v1 diuji                   | Database terpisah untuk antrean                                                  |
| S4a-6  | Item terkirim dihapus dari antrean. `rejected` disimpan sampai `dismissRejected`                                                                             | "Tidak ada yang dibuang diam-diam" (PRD §21.3) tanpa antrean yang membengkak                                 | Menyimpan semua riwayat                                                          |
| S4a-7  | `canLogoutSafely()` juga false jika ada catatan `rejected` yang belum dilihat                                                                                | Catatan yang ditolak server akan hilang bersama database saat logout                                         | Hanya hitung `pending`                                                           |
| S4a-8  | Error transien (`OFFLINE`, `NOT_AVAILABLE`, `RATE_LIMITED`, `UNAUTHENTICATED`, `ENTITLEMENT_INACTIVE`, jaringan) tetap `pending`. Error lain jadi `rejected` | Sesi habis atau akses ditangguhkan tidak boleh membuang catatan                                              | Semua error jadi `rejected`                                                      |
| S4a-9  | `navigator.onLine !== false` dianggap online                                                                                                                 | Di Node 22 `navigator` ada tetapi `onLine` undefined, dan test menangkapnya sebagai "offline"                | `navigator.onLine` saja                                                          |
| S4a-10 | Login ke-4 mengeluarkan perangkat dengan `last_seen_at` paling lama                                                                                          | PRD hanya menyebut "batas 3 (PROV)". Menolak login membuat user terkunci                                     | Menolak login baru                                                               |
| S4a-11 | OTP: batas per email saja, belum 10 per IP per jam                                                                                                           | Mock berjalan di browser, tidak ada IP                                                                       | Mengarang IP                                                                     |
| S4a-12 | Semua email bisa meminta kode. Status akses baru terlihat setelah OTP benar                                                                                  | PRD §6.4 dan anti enumeration (AUTH-06)                                                                      | Menolak email tanpa akses di langkah request                                     |
| S4a-13 | `registerServiceWorker` dipanggil dari komponen yang saya pasang di `src/app/layout.tsx` (1 import + 1 baris)                                                | Syarat e2e "SW terpasang di build production"                                                                | Mendaftar dari e2e saja                                                          |
| S4a-14 | Backoff tanpa jitter                                                                                                                                         | Satu perangkat per user. Tambah jitter saat banyak klien menembak satu server                                | -                                                                                |
| S4a-15 | `/dev/pwa` baru (gallery komponen PWA), mati di production kecuali flag                                                                                      | Komponen perlu diuji axe dan dilihat tanpa menyentuh gallery milik Agen A                                    | Menambah ke `/dev/components`                                                    |

## Hasil test (apa adanya)

Dijalankan di akhir sesi pada branch ini:

```
pnpm typecheck            -> lolos (0 error)
pnpm lint                 -> lolos (tanpa warning)
pnpm test --coverage      -> Test Files 17 passed (17), Tests 326 passed (326)
                             All files: Lines 99,28% · Branches 96,96% · Functions 98,75%
                             src/offline/**: Lines 98,06%  (ambang 90%)
                             src/data/mock/auth.ts: Lines 98,15%  (ambang 90%)
                             src/domain/**: tetap 100% lines
pnpm test:e2e --trace off -> 62 passed, 6 skipped (skip = 4 screenshot S1 + 2 screenshot S4a, hanya jalan dengan flag)
```

- Test baru: 116 unit (326 total, sebelumnya 210) dan 13 test e2e S4a (5 offline/SW + 8 komponen PWA, dijalankan di mobile 320px dan desktop 1280px, jadi 26 eksekusi; 24 lolos, 2 screenshot dilewati tanpa flag).
- ID PRD yang dicakup: AUTH-06 (versi mock: respons identik, permintaan ke-6 dalam 1 jam `RATE_LIMITED`), DZIKIR-02 (antrean + mock, termasuk respons hilang lalu kirim ulang, hitungan server 12 bukan 24), DZIKIR-06 (`canLogoutSafely`), SECURITY-06 (`purgeUser` menghapus database user dan tidak menyentuh user lain).
- E2E: SW terpasang dan mengontrol halaman, `/api/` tidak ada di Cache Storage, halaman tersimpan terbuka saat `setOffline(true)`, halaman baru menampilkan fallback, axe tanpa pelanggaran serious/critical (terang dan gelap).
- Satu temuan nyata dari test: bug `navigator.onLine` (S4a-9), sudah diperbaiki.
- Urutan TDD tidak murni red-green. Test ditulis per modul setelah kodenya, lalu dijalankan. Skill `superpowers` pendukung (brainstorm, rencana, TDD) tidak terpasang di sesi ini.
- Screenshot komponen PWA (terang, 320px dan 1280px): `docs/screenshots/s4a/`. Saya melihatnya dan memperbaiki satu masalah (prompt update menyempit di 320px). Mode gelap hanya lewat axe, belum dilihat.

## Skill yang dipanggil lewat tool Skill

`using-superpowers`, `ponytail`, `antislop-code`, `antislop-copywriting`, `antislop-human`. Tidak dipanggil: `hallmark`, `ui-ux-pro-max`, `stop-slop` (tidak ada di daftar brief ini; komponen kecil mengikuti token S1). `using-superpowers` merujuk skill pendukung yang tidak terpasang, jadi alurnya tidak dijalankan penuh.

## Belum diuji / risiko

- Safari iOS dan Firefox: SW, `storage.persist()`, dan pemasangan Layar Utama tidak diuji. Hanya Chromium.
- Teks langkah pasang (Android, iOS, Safari Mac "Tambah ke Dock", Firefox tidak bisa memasang) berdasarkan pengetahuan umum, bukan perangkat nyata. Perlu verifikasi. Klaim iOS 16.4 untuk notifikasi berasal dari brief §2 R5.
- Navigasi klien Next.js saat offline (klik tautan) tidak diuji. Hanya `page.goto`. Muatan RSC sengaja ke jaringan, jadi Next jatuh ke navigasi penuh yang ditangani SW. Perilaku ini belum dibuktikan.
- Dua tab pada user yang sama bisa mengirim item yang sama. Aman karena server dedupe per `operation_id`, tetapi belum diuji dengan dua tab.
- `VERSION` cache di `sw.js` dinaikkan manual.
- Antrean belum terhubung ke counter di UI. Hanya diuji lewat reducer S2 dan mock.

## Sisa pekerjaan (ronde 3)

- `DataProvider` membuat `OfflineQueue` per user dengan `createLayerSender(layer)`, memanggil `bindQueueTriggers(queue, browserTriggerEnv())`, dan menghapus data user lewat `purgeUser(userId)` setelah dialog logout.
- Dialog logout membaca `queue.getSnapshot()` / `canLogoutSafely()`, menampilkan `listRejected()`, lalu `dismissRejected()`.
- Layar login memakai `createAuthLayer()`. `onboardingCompleted` diisi dari `profile.getProfile()`.
- Tempatkan `InstallGuide` (onboarding opsional dan kartu dashboard), `UpdatePrompt` (shell), panggil `requestPersistentStorage()` saat onboarding.
- Onboarding memanggil `profile.setLocation` lalu `profile.completeOnboarding`.

## Pertanyaan untuk owner

1. Login ke-4: keluarkan perangkat terlama (S4a-10) atau tolak dan minta user mencabut perangkat sendiri?
2. Sesi user 30 hari dan batas 3 perangkat masih PROV. Setuju?
3. Pertanyaan S2 yang masih terbuka (`program_start_date`, ambang insight, salat per centang, bank pesan bedtime) memakai default usulan S2 dan tetap PROV.

## Permintaan ke orchestrator

- `src/app/layout.tsx` saya ubah 2 baris (import dan `<ServiceWorkerRegister />`). Kemungkinan bentrok dengan Agen A jika mereka juga menyentuh layout. Penyelesaiannya trivial.
- `src/app/dev/pwa/page.tsx` dan `docs/screenshots/s4a/` adalah path baru di luar tabel kepemilikan. Mohon dikonfirmasi boleh, atau pindahkan.
- `DataLayer` mendapat properti wajib `profile`. Jika kode Agen A membuat objek `DataLayer` manual (bukan lewat `createDataLayer`), typecheck akan gagal dan perlu `profile`.
- Isi `.env.example` bertambah `NEXT_PUBLIC_ENABLE_SW=false`.
