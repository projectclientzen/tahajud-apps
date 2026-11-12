# Aturan kerja paralel, ronde 2 (Agen A: S3, Agen B: S4a)

Ronde 1 (S1 + S2) selesai dan sudah di-merge. Arsip: `docs/briefs/round1/`.
Dua agen bekerja bersamaan, masing-masing di sesi dan branch sendiri. Orchestrator yang merge ke `main` (A dulu, lalu B).

## Kepemilikan file
| Area | Agen A (S3 layar inti) | Agen B (S4a offline + auth/profil data) |
|------|------------------------|------------------------------------------|
| `src/app/(app)/dashboard/**`, `worship/**`, `levels/**` | tulis | jangan sentuh |
| `src/app/(auth)/**`, `src/app/onboarding/**`, `src/app/(app)/quran/**`, `profile/**`, `reports/**`, `settings/**` | jangan sentuh | jangan sentuh (ronde 3) |
| `src/components/dashboard|worship|dhikr|levels|dev-panel/**` | tulis | jangan sentuh |
| `src/components/providers/**` (DataProvider, hooks) | tulis | jangan sentuh |
| `src/components/ui/**`, `brand/**`, `shell/**` | boleh tambah komponen baru dan perbaiki bug; jangan ubah API komponen yang sudah ada tanpa mencatatnya | jangan sentuh |
| `src/components/pwa/**` (install guide, update prompt) | jangan sentuh | tulis |
| `src/app/globals.css`, `src/lib/cn.ts` | tulis (catat token baru) | jangan sentuh |
| `src/domain/**` | baca saja; minta perubahan lewat file sesi | tulis (hanya jika perlu) |
| `src/data/**` | baca saja; minta perubahan lewat file sesi | tulis |
| `src/offline/**`, service worker, `next.config.ts` | jangan sentuh | tulis |
| `eslint.config.mjs` | jangan sentuh | tulis |
| `tests/e2e/**` | tulis file baru `s3-*.spec.ts`; boleh perbaiki spec lama | tulis file baru `s4a-*.spec.ts` saja |
| `tests/unit/**` | file baru di `tests/unit/ui/**` saja | tulis (kecuali `tests/unit/ui/**`) |
| `package.json`, `pnpm-lock.yaml` | boleh tambah dependency UI (catat alasan) | boleh tambah dependency data/offline (catat alasan) |
| `docs/sessions/S3.md` | tulis | - |
| `docs/sessions/S4a.md` | - | tulis |
| `docs/STATUS.md` | hanya baris UI: Dashboard, Worship session, Dzikir counter, Level journey | hanya baris Offline |
| `CLAUDE.md`, `docs/AGENT_BRIEF.md`, `docs/PRD-*.md`, `docs/SESSION_LOG.md`, `docs/DECISIONS.md`, `content/**`, `docs/briefs/**` | jangan sentuh | jangan sentuh |

Kedua agen boleh menambah dependency. Jika sama-sama menambah, orchestrator menyelesaikan konflik lockfile saat merge.

## Git
- Push HANYA ke branch sesi milikmu. JANGAN push ke `main`.
- Jangan rebase atau force-push branch orang lain.
- Prettier hanya pada file milikmu.

## Kontrak bersama
- Agen A memakai `createDataLayer()` dari `src/data` apa adanya. Jika ada endpoint yang kurang, tulis di "Permintaan ke orchestrator", lalu buat adapter sementara di `src/components/providers/` dengan komentar `TODO(S4a)`.
- Agen B tidak mengubah signature repository yang sudah ada (`DataLayer`, `SessionRepository`, dst.). Penambahan boleh (repository baru, method baru).
- Ekspor `SESSION_STATUSES`, `SessionStatus`, `SESSION_STATUS_LABEL` di `src/domain/content/session-status.ts` tetap ada.

## Laporan akhir (keduanya)
`docs/sessions/S3.md` atau `S4a.md`: yang dikerjakan, keputusan teknis (tabel), output test apa adanya, skill yang benar-benar dipanggil, sisa pekerjaan, pertanyaan untuk owner, permintaan ke orchestrator.
