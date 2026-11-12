# Tahajud Tracker by NgajiGaes

PWA pendamping tahajud: panduan amalan, counter dzikir, dan pelacak istiqomah. Spesifikasi: `docs/PRD-v1.2.md`. Status fitur: `docs/STATUS.md`.

## Prasyarat

- Node.js 20 atau lebih baru
- pnpm 10 (`packageManager` di `package.json`)
- Untuk e2e: Chromium (Playwright 1.63.0 dipin)

## Menjalankan

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Buka http://localhost:3000. Galeri komponen ada di `/dev/components`.

## Script

| Script                                      | Fungsi                                                            |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                                  | Server pengembangan                                               |
| `pnpm build` / `pnpm start`                 | Build dan jalankan production                                     |
| `pnpm typecheck`                            | `tsc --noEmit` (TS strict)                                        |
| `pnpm lint`                                 | ESLint                                                            |
| `pnpm test`                                 | Unit test (Vitest)                                                |
| `pnpm test:e2e --trace off`                 | Playwright, project mobile 320px dan desktop 1280px, termasuk axe |
| `pnpm test:e2e --trace off --grep @screens` | Ambil ulang screenshot ke `docs/screenshots/s1/`                  |

Sebelum klaim selesai: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e --trace off`.

## Environment

| Variabel                        | Nilai                        | Arti                                                                                            |
| ------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_DATA_MODE`         | `mock` (default) atau `live` | `mock` memakai data demo dan menampilkan badge "Data demo". `live` memakai `/api/v1` (mulai S5) |
| `NEXT_PUBLIC_ENABLE_DEV_ROUTES` | `true` atau `false`          | Membuka `/dev/components` di build production. Di `pnpm dev` selalu terbuka                     |

Jangan commit `.env.local`. Kredensial Scalev, SIHAT, Supabase, VAPID, dan email belum dipakai di S1.

## Regenerasi ikon PWA

Ikon sekarang placeholder (bulan sabit di atas Deep Forest). Jalankan lagi setelah mengubah `scripts/generate-icons.mjs` atau mengganti logo:

```bash
node scripts/generate-icons.mjs
```

Hasilnya di `public/icons/`.

## Struktur

- `src/app`: route Next.js App Router
- `src/components`: `ui`, `brand`, `shell`
- `src/domain`: logika murni TS (tanpa React/Next)
- `src/data`: repository (mock dan live)
- `content/amalan.v1.json`: teks dzikir dari owner, jangan diedit
- `docs/`: PRD, brief, status, log sesi, sitemap, design system
