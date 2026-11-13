# Brief X2-B (Sonnet, effort high): selesaikan admin T7 + X8 (staff, tautan reset, blokir aktivasi)

Basis: `main` setelah merge X2-A (orchestrator memberi tahu commit-nya). Branch `claude/x2b-admin`. Lanjutkan WIP `origin/claude/t7-admin` (baca `docs/sessions/T7.md` di branch itu). Rencana: `docs/sessions/SCALEV-AUTH-PLAN.md` §3.9, §8.6 (X8). PRD admin di `docs/PRD-v1.2.md`. Aturan: `CLAUDE.md`.

## Tugas
1. Ganti nama migration T7 `20261115c0100..0400` jadi `20261117100000`, `20261117110000`, `20261117120000`, `20261117130000` (urutan sama). Sesuaikan dengan skema auth baru (`auth_credentials`, `auth_tokens`, `auth_events`, entitlement `staff_comp`). Tambah tabel/RPC ke `tests/db/schema.test.ts`.
2. Sisa T7 (lihat T7.md "Belum"): test workflow review, PRIV-01, audit immutable, k-anon, vektor TOTP RFC 6238, support tools; script `scripts/admin-grant-role.ts` (super_admin pertama, email dari argumen, tanpa password bawaan).
3. X8, migration `20261117140000_admin_staff.sql`:
   - Buat akun staff tanpa pembelian: user + profil + entitlement `staff_comp` (`granted_by`). Admin TIDAK menentukan password; keluarkan tautan reset sekali pakai lewat `issueAdminResetToken` + `buildResetLink` (sudah ada di `src/server/auth/tokens.ts`), ditampilkan sekali.
   - Cabut `staff_comp`.
   - Tautan reset untuk pembeli: alasan wajib, tampil sekali, token mentah tidak disimpan.
   - Approve manual order, blokir/buka aktivasi order (`purchase_orders.activation_blocked`).
   - Staff bypass syarat level (fungsi level server-side), dan dikecualikan dari semua laporan/agregat pembeli.
   - HP disembunyikan kecuali dua peran (super_admin, cs) dan setiap tampil tercatat di audit log.
   - Semua aksi di atas masuk audit log.
4. UI `/admin/**` mobile-first + desktop, Bahasa Indonesia, pakai komponen yang ada. Panggil skill `anthropic-skills:ui-ux-pro-max` dan `anthropic-skills:antislop-ui` sebelum menulis UI. Halaman: login admin + MFA, cari pembeli/order, detail order (approve, blokir aktivasi, tautan reset), staff (buat, cabut), review konten, template notifikasi, kesehatan job, agregat.
5. E2E `tests/e2e/admin-*.live.ts` + config playwright admin.

## Aturan keras
Jangan pernah tampilkan data excused/berhalangan per user ke admin mana pun. Tanpa leaderboard. Teks Arab tidak bisa diedit dari admin (whitelist field). Tidak ada password default. Server sumber kebenaran entitlement.

## Kepemilikan file
Boleh: `supabase/migrations/2026111710*..14*`, `src/server/admin/**`, `src/app/admin/**`, `src/app/api/v1/admin/**`, `src/components/admin/**`, `scripts/admin-grant-role.ts`, `tests/unit/server/admin-*`, `tests/db/admin-*`, `tests/e2e/admin-*`, `playwright.admin.config.ts`, `tests/db/schema.test.ts` (baris milikmu), `package.json` (script saja).
Jangan sentuh: `src/server/scalev/**`, `src/server/jobs/**`, `src/server/auth/**` (kecuali import), `src/app/(auth)/**`, `content/**`, dokumen orchestrator selain `docs/sessions/X2-B.md`, baris STATUS milikmu, entri SESSION_LOG-mu.

## Selesai
`pnpm typecheck && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e --trace off && pnpm audit --prod` hijau. Laporan `docs/sessions/X2-B.md` dengan output asli. Push WIP berkala ke branch-mu (bukan main). Kirim ringkasan ke sesi orchestrator `session_01HkFB32yhrjHP63xkJdKYto`.
