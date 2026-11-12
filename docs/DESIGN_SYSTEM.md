# DESIGN SYSTEM: Tahajud Tracker

Arah: tenang, hangat, bersih, nyaman dipakai malam hari (PRD v1.2 §7.1). Sumber token: `src/app/globals.css`. Rasio kontras di bawah dihitung dengan fungsi `contrast()` yang sama dengan `tests/unit/contrast.test.ts` (rumus WCAG 2.x), dari nilai hex di `globals.css` per 12 Nov 2026.

## 1. Warna brand (PRD §7.2)
| Token | Hex | Pakai untuk |
|-------|-----|-------------|
| `--brand-forest` | #354f40 | CTA, teks utama (light), progress fill (light) |
| `--brand-cream` | #faf7ed | Background light, teks di atas forest |
| `--brand-earth` | #25372f | Background dark |
| `--brand-sage` | #88a189 | Dekorasi saja (lihat §4) |
| `--brand-sand` | #d9c6a5 | Milestone, highlight |
| `--brand-olive` | #b7bda1 | Aksen sekunder, border lembut |

## 2. Token semantik
| Token | Light | Dark |
|-------|-------|------|
| bg | #faf7ed | #25372f |
| surface | #fffdf7 | #2d4237 |
| surface-2 | #f2eddf | #354c40 |
| border | #e4dccb | #42594c |
| border-strong | #7d8577 | #8ba190 |
| text | #354f40 | #faf7ed |
| text-muted | #566459 | #c8c9b8 |
| primary | #354f40 | #a9c0a9 |
| on-primary | #faf7ed | #25372f |
| primary-soft | #dce5da | #3b5446 |
| success / soft | #2e6a45 / #dcebdf | #9ed0ac / #33503f |
| warning / soft | #835710 / #f4e6c8 | #e8be74 / #4d4430 |
| error / soft | #a13c2b / #f6dcd5 | #f2a493 / #533a33 |
| info / soft | #2d5b70 / #d9e7ee | #a2c9db / #33495a |
| disabled-bg / text | #ebe6d8 / #7a7f73 | #34463c / #9aa597 |
| focus | #354f40 | #faf7ed |

## 3. Kontras (WCAG 2.2 AA: 4.5:1 teks, 3:1 komponen UI)
| Pasangan | Light | Dark | Ambang |
|----------|-------|------|--------|
| text di bg | 8.36 | 11.76 | 4.5 |
| text di surface | 8.81 | 10.07 | 4.5 |
| text di surface-2 | 7.66 | 8.67 | 4.5 |
| text-muted di bg | 5.83 | 7.50 | 4.5 |
| text-muted di surface | 6.14 | 6.42 | 4.5 |
| text-muted di surface-2 | 5.34 | 5.53 | 4.5 |
| on-primary di primary (label tombol) | 8.36 | 6.48 | 4.5 |
| success di surface | 6.33 | 6.20 | 4.5 |
| warning di surface | 6.19 | 6.19 | 4.5 |
| error di surface | 6.46 | 5.40 | 4.5 |
| info di surface | 7.26 | 6.12 | 4.5 |
| success di success-soft (chip) | 5.21 | 5.12 | 4.5 |
| warning di warning-soft (chip) | 5.10 | 5.51 | 4.5 |
| error di error-soft | 5.04 | 5.20 | 4.5 |
| info di info-soft | 5.85 | 5.32 | 4.5 |
| text di primary-soft (item aktif nav) | 6.94 | 7.71 | 4.5 |
| border-strong di bg | 3.57 | 4.56 | 3 |
| border-strong di surface | 3.76 | 3.90 | 3 |
| focus ring di bg | 8.36 | 11.76 | 3 |
| disabled-text di disabled-bg | 3.30 | 3.93 | dikecualikan WCAG (kontrol nonaktif) |

Semua baris selain "disabled" dijaga unit test (49 kasus). Pasangan disabled sengaja tidak diuji karena WCAG 1.4.3 mengecualikan komponen nonaktif. Brand sage di atas cream hanya sekitar 2.6:1 dan diuji tetap di bawah 3.

## 4. Aturan pakai sage
- Boleh: ilustrasi, dekorasi, latar chip dengan teks forest, swatch.
- Dilarang: warna teks di atas cream (sekitar 2.6:1) atau ikon yang membawa makna sendirian.
- Dark mode memakai `primary` #a9c0a9 (sage terang) untuk CTA dengan teks earth. Itu pasangan lain, sudah lolos 6.48:1.

## 5. Tipografi
| Peran | Token Tailwind | Ukuran | Line height |
|-------|----------------|--------|-------------|
| Judul halaman | `text-page-title` | 26px (1.625rem) | 1.2 |
| Judul kartu | `text-card-title` | 18px | 1.35 |
| Isi | `text-body` | 16px | 1.55 |
| Bantu | `text-helper` | 13px | 1.35 |
| Angka statistik | `text-stat` | 32px | 1.1 |
| Dzikir Arab | `text-dhikr` | 30px (default; pengguna atur 26-34px) | 2.1 |
| Qur'an | `text-quran` | 30px (default; pengguna atur 22-44px) | 2.3 |

- Latin: Plus Jakarta Sans (`--font-sans`).
- Arab: Amiri Quran, OFL (`--font-arabic`), kelas `.arabic` (`direction: rtl`) dan `lang="ar"`. Uji visual Yasin dan Al-Kahfi belum dilakukan (butuh dataset S7).
- Hanya dua keluarga font. Tanpa huruf kapital semua, tanpa letter-spacing pada label.
- Tabular nums untuk angka yang berubah (counter, progress).

## 6. Bentuk, jarak, gerak
- Radius: kontrol 14px, kartu 20px, pill penuh.
- Tap target minimal 44x44px (tombol `min-h-12`, nav `h-[4.25rem]`).
- Konten maksimal 60rem, di tengah. Sidebar 15.5rem mulai 1024px.
- Durasi 150-200ms, hanya `transform` dan `opacity`. Progress memakai `scaleX`, bukan `width`.
- `prefers-reduced-motion` mematikan animasi. Fokus muncul instan (`transition: none`), outline 3px.

## 7. Komponen dan state
| Komponen | File | Varian / state |
|----------|------|----------------|
| Button | `ui/button.tsx` | primary, secondary, ghost, danger; md, lg, icon; block; default, hover, focus, active, disabled, loading (`aria-busy`) |
| Card | `ui/card.tsx` | Card, CardTitle, CardDescription |
| ProgressBar | `ui/progress-bar.tsx` | `role=progressbar`, `aria-valuetext`, nilai di-clamp 0..max |
| ProgressRing | `ui/progress-ring.tsx` | label + nilai, isi tengah bebas |
| StatCard | `ui/stat-card.tsx` | label, nilai, hint, ikon |
| StatusChip | `ui/status-chip.tsx` | completed, partial, missed, excused, upcoming (ikon + label) |
| Skeleton | `ui/skeleton.tsx` | `aria-hidden`, animasi mati saat reduced motion |
| EmptyState | `ui/feedback-state.tsx` | judul, deskripsi, aksi |
| ErrorState | `ui/feedback-state.tsx` | `role=alert`, nada error-soft |
| SessionExpiredState | `ui/feedback-state.tsx` | `role=alert`, nada info, ajakan masuk lagi |
| AccessDeniedState | `ui/feedback-state.tsx` | `role=alert`, nada netral, jalur ke CS |
| PermissionDeniedState | `ui/feedback-state.tsx` | `role=alert`, nada warning, langkah mengubah izin |
| Sheet | `ui/sheet.tsx` | Radix Dialog: fokus terkunci, Escape menutup; bawah di mobile, dialog di md+ |
| DemoBadge | `brand/demo-badge.tsx` | `role=note`, tampil saat `NEXT_PUBLIC_DATA_MODE=mock` |
| Wordmark | `brand/wordmark.tsx` | teks sementara, ganti saat logo NgajiGaes tersedia |
| AppShell, BottomNav, SidebarNav | `shell/` | `aria-current=page`, skip link, bottom nav di bawah 1024px |
| OfflineBanner | `shell/offline-banner.tsx` | muncul saat event `offline` terbaca |
| PageHeader | `shell/page-header.tsx` | judul + deskripsi |
| ThemeToggle | `shell/theme-toggle.tsx` | Ikuti perangkat, Terang, Gelap, Gelap saat malam (sementara 18.00-05.00, DECISIONS D8) |

State halaman yang belum punya komponen (butuh data, S3-S4): purchase pending, prayer data stale, push unavailable, level locked, counter syncing, unsynced on logout, content not reviewed. Lihat PRD §26.

Galeri hidup di `/dev/components`.

## 8. Aturan copy (PRD §7.7, CLAUDE.md)
- Bahasa Indonesia, kalimat pendek, nada suportif. Tanpa shaming, tanpa menilai iman.
- Tanpa em-dash dan tanpa titik tengah (·) sebagai pemisah di UI.
- Hindari kata "leverage", "seamless", "robust", "holistic".
- Label status baku: Tuntas (centang), Sebagian (setengah lingkaran), Terlewat (lingkaran kosong), Berhalangan (jeda), Akan datang (jam). Status tidak pernah hanya warna.
- Malam terlewat: pesan menenangkan, tanpa kata gagal, progress tidak reset.
- Angka contoh wajib berlabel demo. Angka tanpa label demo dilarang.
- Teks Arab dzikir hanya dari `content/amalan.v1.json`. Jangan diketik ulang di komponen.
- Nama CS dan tautan WhatsApp dari config, bukan hardcode.
