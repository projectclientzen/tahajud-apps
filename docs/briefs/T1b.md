# Brief T1b (sesi T1, Sonnet, effort high): 3 e2e gagal di titik temu T1 + T2

Basis: branch integrasi orchestrator `claude/great-cerf-mfce32` = main + T1 (`e7ebbc2`, milikmu) + T2 (`a13b03c`) + T3a (`24f8923`) + T4b (`a3da3e3`). Typecheck, lint, unit 561 (+3 live skip), audit bersih. E2E: 204 passed, 10 skipped, 6 failed (3 test x 2 project):

1. `tests/e2e/r3b-help-a11y.spec.ts:5` "CS tersembunyi bila env kosong" (`toHaveCount` gagal). Cek apakah sekarang ada tombol/tautan WhatsApp dari layar T1 (shell/header/auth) yang ikut terhitung, atau env e2e T1 mengisi `NEXT_PUBLIC_CS_WHATSAPP`. Aturan yang benar: env kosong = tidak ada tombol WhatsApp di mana pun.
2. `tests/e2e/r3b-quran.spec.ts:78` surah di luar enam bacaan harus HTTP 404 (sekarang 200). Perbaiki di kode (guard/layout/`notFound()`), bukan di test.
3. `tests/e2e/r3b-settings.spec.ts:65` `/settings/devices` tanpa sesi: guard T1 mengarahkan ke `/login`. Perilaku guard T1 benar. Ubah test agar memverifikasi redirect ke `/login` (dan pesan sesi berakhir jika T1 menampilkannya). Jangan melemahkan guard.

Tambahan kecil bila sempat (tidak wajib): `src/components/settings/use-auth-repo.ts` (T2) membuat `createAuthLayer()` sendiri; ganti dengan auth provider T1 jika memang terpisah; masukkan `tt-planner-prefs` ke data yang dihapus saat logout.

Scope: `src/**`, `tests/e2e/**`, `tests/unit/**` seperlunya. Jangan sentuh `supabase/**`, `tests/db/**`, `src/server/**`, `content/**`, `scripts/**`, dokumen orchestrator.

Acceptance: gerbang penuh 0 failed (`pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e --trace off && pnpm audit --prod`). Hapus `.next` sebelum typecheck jika ada sisa build lama. Kembalikan file `docs/screenshots/**` yang berubah karena run e2e (`git checkout -- docs/screenshots`) kecuali sengaja diperbarui. Laporan `docs/sessions/T1b.md`. Push ke branch sesimu (bukan main), kirim ringkasan ke orchestrator.
