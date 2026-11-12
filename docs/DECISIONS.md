# DECISIONS

Keputusan teknis yang diambil agen. Format: tanggal, keputusan, alasan, alternatif.

## 2026-11-12 (S1 WIP, sesi orchestrator)
| # | Keputusan | Alasan | Alternatif ditolak |
|---|-----------|--------|--------------------|
| D1 | Next.js 15.5.29 (bukan 16.x) | Pola App Router 15 sudah stabil dan dikenal; 15.5.4 bawaan create-next-app rentan CVE RSC Des 2025, jadi dipakai patch 15.5 terbaru | Next 16: breaking changes (middleware → proxy, dll.) tanpa manfaat untuk S1 |
| D2 | React 19.1.10 dipin eksak | Patch keamanan RSC | Range `^19` |
| D3 | `pnpm.overrides` postcss ^8.5.23, sharp ^0.35.5 | `pnpm audit --prod` bersih (sebelumnya 5 high, 2 moderate dari dependency transitif next) | Menunggu next merilis patch |
| D4 | Tailwind v4 CSS-first, token di `:root` + `[data-theme]`, dipetakan via `@theme inline` | Satu sumber token; dark mode via atribut agar bisa "gelap saat malam" | `prefers-color-scheme` saja (tidak bisa override manual) |
| D5 | Komponen ditulis tangan gaya shadcn (cva + Radix Dialog/Slot) | Registry shadcn tidak dibutuhkan; dependency minimal | `shadcn init` (butuh akses registry, tambah file tak terpakai) |
| D6 | Font: Plus Jakarta Sans + Amiri Quran via `next/font/google` | Amiri Quran berlisensi OFL dan mendukung Rasm Utsmani; self-hosted otomatis saat build | KFGQPC (lisensi perlu dicek) |
| D7 | Script tema pre-paint di `<head>` dibangun dari `resolveTheme.toString()` | Logika tema tidak terduplikasi; mencegah flash terang jam 3 pagi | Script ditulis manual (rawan beda dengan logika TS) |
| D8 | "Gelap saat malam" sementara jendela 18.00-05.00 | Engine jadwal salat belum ada; ganti ke Maghrib-Subuh setelah S2/S7 | - |
| D9 | Theme toggle pakai radio native | Keyboard panah + screen reader jalan tanpa kode tambahan | `role=radio` custom |
| D10 | ProgressBar animasi `transform: scaleX`, bukan width | Aturan Hallmark Floor + performa | - |
| D11 | Uji kontras otomatis membaca `globals.css` | Token tidak bisa diam-diam turun di bawah AA | Daftar warna terpisah di TS (bisa drift) |
| D12 | `@playwright/test` 1.63.0 dipin | Cocok dengan Chromium terpasang di `/opt/pw-browsers` | Versi terbaru (browser tidak cocok) |
| D13 | Ikon PWA placeholder: bulan sabit krem di atas Deep Forest (`scripts/generate-icons.mjs`) | Bukan logo NgajiGaes palsu; diganti saat owner kirim logo | - |
