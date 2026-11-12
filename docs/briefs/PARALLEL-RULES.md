# Aturan kerja paralel, ronde 3 (Agen A: T1, Agen B: T2)

Rencana induk: `docs/PLAN.md`. Arsip ronde sebelumnya: `docs/briefs/round1/`, `docs/briefs/round2/`.
Tim kerja: Sonnet. Orchestrator (Opus) yang merge ke `main` (A dulu, lalu B).

## Kepemilikan file
| Area | Agen A (T1) | Agen B (T2) |
|------|-------------|-------------|
| `src/app/(auth)/**`, `src/app/onboarding/**`, `src/app/access-status/**` | tulis | jangan sentuh |
| `src/app/(app)/quran/**`, `reports/**`, `settings/**`, `notifications/**`, `help/**`, `profile/**` | jangan sentuh | tulis |
| `src/components/auth/**`, `onboarding/**`, `providers/**`, `shell/**`, `dhikr/counter-screen.tsx`, `pwa/**` (penempatan) | tulis | jangan sentuh |
| `src/components/quran/**`, `reports/**`, `settings/**`, `notifications/**`, `help/**` | jangan sentuh | tulis |
| `src/components/dashboard/**` | hanya kartu setup (install/notifikasi) dan ikon notifikasi/pengaturan di header | jangan sentuh |
| `src/components/ui/**` | boleh tambah komponen baru, jangan ubah API yang ada | boleh tambah komponen baru, jangan ubah API yang ada |
| `src/domain/auth/**`, `src/data/**` (auth, profile, offline sender), `src/offline/**` | tulis | baca saja |
| `src/domain/content/session-status.ts` | jangan sentuh | tulis (label "Sedang berjalan") |
| `src/domain/**` lainnya | baca saja | baca saja |
| `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/app/globals.css`, `src/lib/**` | tulis | jangan sentuh (minta lewat file sesi) |
| `tests/e2e/r3a-*.spec.ts`, `tests/unit/ui/auth-*`, `tests/unit/**` untuk domain auth/offline | tulis | jangan sentuh |
| `tests/e2e/r3b-*.spec.ts`, `tests/unit/ui/r3b-*` | jangan sentuh | tulis |
| Spec e2e lama | perbaiki hanya jika rusak karena perubahanmu, catat | sama |
| `package.json`, `pnpm-lock.yaml` | boleh tambah dependency (alasan tertulis) | boleh tambah dependency (alasan tertulis) |
| `docs/sessions/T1.md` / `T2.md` | T1 | T2 |
| `docs/STATUS.md` | baris "Auth, onboarding, access status" dan "Offline" | baris "Quran Reader" dan "Reports, calendar, settings, notifications, help" |
| `CLAUDE.md`, `docs/PRD-*.md`, `docs/PLAN.md`, `docs/AGENT_BRIEF.md`, `docs/SESSION_LOG.md`, `docs/DECISIONS.md`, `content/**`, `docs/briefs/**` | jangan sentuh | jangan sentuh |

## Git dan eskalasi
- Sinkron ke `main` dulu. Push HANYA ke branch sesimu. Prettier hanya file milikmu.
- Gagal 2x di test yang sama: berhenti, tulis diagnosis di file sesi, laporkan ke orchestrator.

## Laporan
`docs/sessions/T1.md` / `T2.md`: yang dikerjakan, keputusan (tabel), output test asli, skill yang benar-benar dipanggil, sisa pekerjaan, pertanyaan owner, permintaan ke orchestrator.
