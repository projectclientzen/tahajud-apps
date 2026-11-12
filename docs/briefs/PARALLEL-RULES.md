# Aturan kerja paralel (Agen A + Agen B)

Dua agen bekerja bersamaan di repo yang sama, masing-masing di sesi dan branch sendiri. Orchestrator yang menggabungkan hasilnya.

## Kepemilikan file
| Area | Agen A (S1 lanjutan) | Agen B (S2 domain) |
|------|----------------------|--------------------|
| `src/app/**`, `src/components/**`, `src/lib/**` | tulis | baca saja |
| `src/app/globals.css` | tulis | baca saja |
| `src/domain/**`, `src/data/**` | baca saja | tulis |
| `tests/unit/**` | hanya `contrast.test.ts` | tulis (kecuali `contrast.test.ts`) |
| `tests/e2e/**`, `playwright.config.ts` | tulis | jangan sentuh |
| `vitest.config.ts` | jangan sentuh | tulis |
| `package.json`, `pnpm-lock.yaml` | JANGAN tambah dependency | boleh tambah dependency |
| `docs/SITEMAP.md`, `docs/DESIGN_SYSTEM.md`, `README.md`, `docs/screenshots/**` | tulis | jangan sentuh |
| `docs/sessions/S1.md` | tulis | - |
| `docs/sessions/S2.md` | - | tulis |
| `docs/STATUS.md` | hanya baris Foundation, Design, dan baris UI yang disebut di brief | hanya baris Domain |
| `CLAUDE.md`, `docs/AGENT_BRIEF.md`, `docs/PRD-*.md`, `docs/SESSION_LOG.md`, `docs/DECISIONS.md`, `content/**` | jangan sentuh | jangan sentuh |

File di luar kolom "tulis" milikmu: jangan diubah. Kalau perlu perubahan di sana, tulis permintaannya di file sesi (`docs/sessions/S*.md`, bagian "Permintaan ke orchestrator").

## Git
- Kerja dan push HANYA ke branch sesi milikmu. JANGAN push ke `main`. Orchestrator yang merge ke `main`.
- Jangan rebase atau force-push branch orang lain.
- Prettier: jalankan hanya pada file milikmu (`pnpm prettier --write <path milikmu>`), bukan seluruh repo.

## Kontrak bersama
- `src/domain/content/session-status.ts` dipakai `StatusChip`. Agen B boleh memindah atau memperluasnya, tetapi ekspor `SESSION_STATUSES`, `SessionStatus`, dan `SESSION_STATUS_LABEL` harus tetap ada di path yang sama.
- Agen A tidak membangun layar yang butuh data (dashboard asli, sesi, counter). Itu S3, setelah mock repository dari Agen B selesai.

## Laporan akhir (keduanya)
Tulis di `docs/sessions/S1.md` atau `S2.md`: yang dikerjakan, keputusan teknis (format tabel seperti `docs/DECISIONS.md`), output test apa adanya, sisa pekerjaan, pertanyaan untuk owner, permintaan ke orchestrator.
