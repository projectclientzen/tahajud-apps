# Sesi T1b (sesi T1 baru, ronde 3): integrasi T1+T2, batas 3 perangkat, sisa T1

Branch: `t1b` di atas `origin/claude/great-cerf-mfce32` @ `7254178` (branch integrasi orchestrator). Tanggal: 2026-11-12.
Brief: `docs/briefs/T1b.md`. T1 milik Agen A lama yang dipakai. Dari pekerjaan T1 sesiku sebelumnya hanya logika batas perangkat, panel batas perangkat, label perangkat, dan `listPending` yang dipakai ulang.

## Yang dikerjakan

1. **3 e2e gagal di titik temu T1-T2**
   - `/settings/devices` (dan `profile-summary`, `account-view`): sekarang memakai `useAuth()` dari `AuthProvider` T1. `src/components/settings/use-auth-repo.ts` dihapus. Teks penjelasan di halaman diubah (tidak ada lagi "yang paling lama dikeluarkan").
   - `r3b-settings` "tanpa sesi login": guard T1 tidak dilemahkan. Test sekarang berjalan tanpa sesi tersimpan dan memeriksa redirect ke `/login` serta tidak ada data perangkat di layar. Kasus sesi berakhir sudah punya test di `r3a-session.spec.ts`.
   - `r3b-quran` surah di luar enam bacaan: akar masalah ditemukan. `SignedInProviders` (komponen klien) tidak merender `children` di server selama sesi belum dimuat, jadi `notFound()` dari halaman baru sampai setelah status respons dikirim sebagai 200. Perbaikan di kode: `dynamicParams = false` + `generateStaticParams` (enam surah) di `src/app/(app)/quran/[surah]/page.tsx`. Next memberi 404 sungguhan sebelum render. Test tidak diubah.
2. **Batas 3 perangkat (PRD §24.1).** `devicesToRevoke` dan aturan S4a-10 dihapus. `checkDeviceLimit` (domain), `verifyOtp` mengembalikan `status: "device_limit"` + daftar perangkat + `pending_token` (10 menit, sekali pakai), `completePendingLogin(token, perangkatYangDikeluarkan)`. Kode error baru `PENDING_LOGIN_INVALID`. Layar "Akunmu sudah aktif di 3 perangkat (maksimal)" (`DeviceLimitPanel`) di `/auth/verify`: pilih satu perangkat lalu lanjut, atau Batal. Perangkat dikirim dengan label dari browser (mis. "Chrome di Android"). Skenario mock baru `device_limit` di alat demo masuk.
3. **Sisa T1**
   - Pesan untuk sesi `revoked` di `/login`: "Perangkat ini dikeluarkan dari akunmu lewat perangkat lain...".
   - Checklist lewat antrean offline: `activity-row.tsx` mengirim `checklist_set` ke `OfflineQueue`. Centang tampil seketika, dibangun ulang dari antrean setelah reload, antrean menyelesaikan konflik versi lewat sender yang sudah ada, dan catatan yang ditolak server tampil sebagai pesan error lalu dihapus dari antrean. `OfflineQueue.listPending(entityId?)` ditambahkan.
   - `tt-planner-prefs` dihapus saat logout (`use-sign-out.ts`). Tema (`tt-theme`) sengaja tetap: milik perangkat, bukan akun.
   - Header dashboard: ikon Notifikasi, Laporan (`/reports`), Pengaturan (`/settings`), Profil.

## Keputusan

| # | Keputusan | Alasan | Alternatif ditolak |
|---|-----------|--------|--------------------|
| T1b-1 | 404 surah lewat `dynamicParams=false` | Memperbaiki penyebab (status respons), bukan menambah cek di klien. Berlaku juga bagi route dinamis lain di bawah gate | Middleware dengan daftar surah kedua |
| T1b-2 | Keluarkan perangkat = pilihan user, token tertunda tersimpan di state komponen, hilang saat reload | Reload berarti OTP baru. Token tidak pernah di URL atau storage | Menyimpan token di `sessionStorage` |
| T1b-3 | Checklist: `local` (tampilan) tetap ada sampai nilai server sama, dibangun ulang dari antrean pada reload | Tidak ada kedipan, dan centang offline tidak hilang | Menghapus `local` dan membaca antrean saja |
| T1b-4 | Baris checklist hanya memuat ulang sesi jika baris itu punya perubahan sendiri atau ditolak | Satu peristiwa antrean tidak boleh memicu 30 pemuatan ulang | Memuat ulang di setiap peristiwa antrean |
| T1b-5 | `seedSignedIn` (T2) memakai `/manifest.webmanifest` sebagai halaman pengisian | Halaman tanpa kode app, jadi tidak ada instance auth di memori yang menimpa seed | `/levels` (balapan) |
| T1b-6 | Flag `provisional` pada 30 hari / 3 perangkat tidak diubah | `src/domain/config/**` bukan milik T1b. Owner sudah menyetujui di PRD v1.2.3 | - |

## Output test (apa adanya)

```
pnpm typecheck            -> lolos
pnpm lint                 -> lolos, tanpa warning
pnpm test                 -> Test Files 29 passed (29), Tests 514 passed (514)   (sebelumnya 508)
pnpm test:e2e --trace off -> 210 passed, 14 skipped (3.2m), 0 gagal
pnpm audit --prod         -> No known vulnerabilities found
grep -r "TODO(S4a)" src   -> kosong
```
- Baseline sebelum perubahan di branch ini: e2e 188 passed, 14 skipped, 4 gagal (2 test x 2 project): `r3b-quran` 404 dan `r3b-settings` sesi berakhir. Test devices lulus di baseline tetapi bergantung pada instance auth kedua (rapuh), diganti `useAuth()`.
- Skip = 14 test screenshot lama (hanya jalan dengan flag).
- Test baru: `tests/e2e/r3a-devices.spec.ts` (9 per project): perangkat ke-4 ditolak tanpa pengeluaran otomatis, pilih satu perangkat lalu login lanjut (dan daftar di `/settings/devices` benar), batal, axe light + dark layar batas perangkat, sesi `revoked` kembali ke `/login` dengan pesan, centang offline bertahan setelah reload dan terkirim sekali, centang-lepas-centang offline, `tt-planner-prefs` dihapus saat logout dan tema tetap, tautan header. Unit: batas perangkat + token tertunda (domain dan mock auth), `listPending`, label perangkat.
- Iterasi: dua putaran e2e terarah. Kegagalan putaran pertama semuanya di test: seed T2 yang berlomba, cooldown OTP 60 detik dari sign-in global-setup, dan lanjutan login perangkat yang masih harus onboarding.

## Skill yang benar-benar dipanggil lewat tool Skill

Tidak ada.

## Belum diuji / risiko

- Safari iOS dan Firefox tidak diuji.
- `dynamicParams=false` membuat enam halaman surah dirender statis saat build. Isi tetap gate klien. Jika T4 mengganti sumber daftar surah, `generateStaticParams` harus mengikuti `SURAHS`.
- Checklist: konflik versi antar perangkat diselesaikan oleh sender (nilai server menang, aksi user diterapkan ulang jika masih mengubah sesuatu). Diuji di unit (S4a), belum di e2e dua perangkat.
- `OfflineQueue` tidak punya `close()` seperti di versi T1 sesiku sebelumnya. Logout di branch ini memakai `shutdown()` milik `DataProvider`. Tidak saya ubah.

## Sisa pekerjaan

- T3b: `AuthRepository` HTTP harus mengikuti union `verifyOtp` (`device_limit`) dan `completePendingLogin`. Kontrak Zod ada di `src/data/contracts.ts`.

## Pertanyaan untuk owner

1. Nomor WhatsApp CS dan link beli Scalev (masih kosong di env).
2. Di header dashboard sekarang ada 4 ikon + tombol keluar (mobile). Cukup, atau Laporan dan Pengaturan cukup lewat Profil?

## Permintaan ke orchestrator

- Branch ini berdasarkan `great-cerf-mfce32`, aman di-merge ke sana. `src/offline/queue.ts` hanya mendapat `listPending`. `src/data/**` dan `src/domain/auth/devices.ts` berubah sesuai brief.
