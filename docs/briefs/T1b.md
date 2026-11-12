# Brief T1b (sesi T1 baru, Sonnet, effort high): integrasi T1+T2, batas 3 perangkat, sisa auth

Basis: branch integrasi orchestrator `claude/great-cerf-mfce32` (BUKAN main). Branch ini sudah berisi merge T1 (Agen A lama, `f6c029c`), T2 (`a13b03c`), T3a (`24f8923`), T4. Unit 503/503 lolos, tetapi e2e gagal 5 (2 project x 3 test) di titik temu T1-T2. Hasil T1 dari Agen A lama yang dipakai; pekerjaan T1 di sesimu sebelumnya tidak dipakai, tetapi boleh kamu ambil bagian yang berguna (terutama batas perangkat) jika ada.

## Tugas
1. Perbaiki 3 e2e gagal:
   - `tests/e2e/r3b-settings.spec.ts:53` `/settings/devices`: `src/components/settings/use-auth-repo.ts` membuat `createAuthLayer()` sendiri sehingga sesi demo T1 tidak terlihat. Ganti dengan auth provider T1 (`src/components/providers/auth-provider.tsx`), hapus `use-auth-repo.ts` jika tidak dipakai lagi.
   - `r3b-settings.spec.ts:65` "tanpa sesi login menampilkan sesi berakhir": guard T1 mengarahkan ke `/login` lebih dulu. Perilaku guard T1 benar; ubah test agar memverifikasi redirect ke `/login` (atau pesan sesi berakhir di `/login` jika T1 punya parameter alasan). Jangan melemahkan guard.
   - `r3b-quran.spec.ts:78` surah di luar enam bacaan harus 404. Temukan kenapa sekarang 200 setelah layout/guard T1, perbaiki di kode (bukan di test).
2. Batas 3 perangkat (keputusan owner, PRD v1.2.3 §24.1, brief `docs/briefs/T1.md` tugas 2): login ke-4 setelah OTP benar → status `device_limit` + daftar perangkat + token login tertunda (10 menit, sekali pakai) → layar "Akunmu sudah aktif di 3 perangkat (maksimal)" → keluarkan satu lalu lanjut, atau batal. Hapus pengeluaran otomatis (`devicesToRevoke` / aturan S4a-10) di `src/domain/auth/devices.ts` dan `src/data/mock/auth.ts`. Unit + e2e.
3. Sisa T1 dari `docs/sessions/T1.md`: pesan untuk sesi `revoked` di `/login`; checklist (centang salat) lewat antrean offline (`checklist_set`) supaya siap saat T3b mengganti layer ke HTTP; tambahkan `tt-planner-prefs` ke data yang dihapus saat logout; link `/reports` dan `/settings` dari header dashboard.

## Kepemilikan file
Kamu boleh menyentuh semua `src/**`, `tests/e2e/**`, `tests/unit/**` yang dibutuhkan tugas di atas. Jangan sentuh `supabase/**`, `tests/db/**`, `src/server/**`, `content/**`, `scripts/**`, dokumen orchestrator. Agen C sedang mengerjakan `src/server/prayer/**` (T4b).

## Acceptance criteria
`pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e --trace off && pnpm audit --prod` lolos penuh (0 failed). Test batas perangkat lulus. Laporan `docs/sessions/T1b.md` dengan output asli. Push ke branch sesimu (bukan main), kirim ringkasan ke orchestrator.
