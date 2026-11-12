# Brief Agen A: S1 lanjutan (UI foundation, QA, dokumentasi desain)

Baca dulu: `CLAUDE.md`, `docs/briefs/PARALLEL-RULES.md`, `docs/PRD-v1.2.md` §5, §7, §26, entri "S1 WIP" di `docs/SESSION_LOG.md`, dan `docs/DECISIONS.md`.

## Kondisi awal (sudah ada di main)
Next.js 15.5.29 + TS strict + Tailwind v4. Token light/dark di `src/app/globals.css` (lolos AA, 49 unit test). Komponen di `src/components/ui|brand|shell`. Route `/`, `/dashboard`, `/worship`, `/quran`, `/profile` (placeholder), `/dev/components` (gallery). Unit test 60/60 dan build lolos. E2E di `tests/e2e/` sudah ditulis tetapi BELUM pernah dijalankan.

## Tugas
1. Jalankan `pnpm test:e2e --trace off` (project mobile 320px + desktop 1280px). Perbaiki semua kegagalan, termasuk temuan axe serious/critical. Jangan skip atau hapus test untuk membuatnya hijau. Jika ada test yang memang salah, perbaiki test-nya dan tulis alasannya.
2. Screenshot: `pnpm test:e2e --trace off --grep @screens`, lalu buka dan lihat sendiri setiap file di `docs/screenshots/s1/`. Perbaiki masalah visual (jarak, hierarki, kontras, teks terpotong, RTL Arab).
3. Lengkapi state UI dasar yang belum ada sebagai komponen (tanpa data): `SessionExpiredState`, `AccessDeniedState`, `PermissionDeniedState` (pakai pola `feedback-state.tsx`), lalu tampilkan di gallery.
4. Tulis `docs/SITEMAP.md`: semua route PRD v1.2 §5.2 dan §5.3, plus 4 user flow dalam Mermaid: pembelian sampai aktivasi (termasuk cabang `pending_verification`), onboarding jalur minimum, alur ibadah harian, transisi Subuh.
5. Tulis `docs/DESIGN_SYSTEM.md`: tabel token light/dark dengan rasio kontras (hitung dari fungsi di `tests/unit/contrast.test.ts`), tipografi, aturan pemakaian sage, daftar komponen + state yang didukung, aturan copy (PRD §7.7, tanpa em-dash, tanpa shaming).
6. `README.md` singkat: prasyarat, cara run, daftar script, `NEXT_PUBLIC_DATA_MODE`, cara regenerasi ikon.
7. Periksa Hallmark Floor 16 item secara manual. Tulis PASS/FAIL per item di `docs/sessions/S1.md`; perbaiki yang FAIL.

## Skill
ui-ux-pro-max, hallmark, ponytail (perubahan sekecil mungkin), stop-slop / avoid-ai-writing / skill anti-slop lain yang tersedia untuk semua copy UI dan dokumen.

## Definition of done
- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e --trace off` lolos. Tempel ringkasan output asli di `docs/sessions/S1.md`.
- Screenshot terbaru ada di `docs/screenshots/s1/`.
- STATUS baris Foundation dan Design diperbarui.
- Commit + push ke branch sesi (bukan main).
