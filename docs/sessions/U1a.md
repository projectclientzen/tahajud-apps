# Sesi U1a: UI/UX alur inti ibadah

Branch: `claude/u1a-ui-core-worship` (basis `main` 0e5cfd2). Fase A dan B dikerjakan sekaligus (T1b sudah di main).
Arah desain: yang sudah ada (`docs/DESIGN_SYSTEM.md`, PRD v1.2 §7). Tidak ada token warna, font, atau radius baru.
Dial: ENERGY 1 / RHYTHM 1 / MOTION 1 (alat ibadah malam, tenang, hampir tanpa gerak).

## Skill yang benar-benar dipanggil lewat tool Skill
ui-ux-pro-max, antislop, antislop-ui, antislop-human, antislop-layoutmobile, antislop-copywriting, hallmark. Catatan: salinan skill di sini tanpa `sloplint.mjs` dan `capture.mjs`, jadi Floor Hallmark dan Delivery Gate antislop saya telusuri manual (daftar di bawah).

## Foto
`docs/screenshots/u1/u1a-before-*` dan `u1a-after-*`, pola `<layar>-<390|1280>-<light|dark>.png`. Dibuat oleh `tests/e2e/u1a-shots.spec.ts` (mati kecuali `U1A_PHASE=before|after`, jalankan dengan `--project=desktop`). Layar: entry, login, verify, verify-error, access-none, access-pending, onb-welcome/region/confirm, dash-new, dash-3am, dash-fajr, dash-filled, dash-offline, levels-new, levels-l2, worship-home, session-empty/start/progress/fajr, counter-zero/mid/reached. Semua dilihat sendiri (sebelum dan sesudah, mobile light dan dark, desktop light dan dark untuk dashboard, counter, sesi). File dikompres ke palet (5 MB total).
State loading dan error tidak difoto terpisah: `LoadGate` (skeleton, ErrorState, OfflineState) tidak diubah dan sudah diuji di spec S3/R3.

## Audit per layar dan tindakan
| Layar | Temuan | Tindakan |
|-------|--------|----------|
| Counter `/worship/dhikr/[id]` | (1) Pesan "Target tercapai" menyisip di atas tombol, mendorong +1 ke bawah dan menutup tombol minus/reset di balik nav saat 100 tap: tata letak bergeser tepat saat orang menekan. (2) Hitungan di cincin dan tombol +1 terpisah, dua target visual untuk satu aksi. (3) Teks Arab panjang bisa mendorong tombol keluar layar. (4) Trek cincin hampir tak terlihat di light. | Seluruh lingkaran (`min(78vw, 17rem)`, 272px di 390) adalah tombol tap, hitungan 72px di dalamnya, busur progres di sekelilingnya yang menjadi hijau saat target. "Target tercapai" dan "+N lebih" ada di dalam tombol (testid `reached` tetap), pengumuman SR lewat `role=status` sr-only. Tidak ada elemen yang berubah ukuran. Teks Arab dalam kotak `max-h-[28dvh]` yang bisa digulir dan difokus keyboard. Trek cincin `border-strong/35`. Header (kembali, keluar) tidak diubah karena DZIKIR-06 keluar dari layar ini. |
| Sesi `/worship/session` | (1) Tidak ada gambaran progres: harus gulir 3000px untuk tahu posisi. (2) Baris dzikir tanpa penanda di kiri, rata kiri berbeda dari baris centang. (3) Label "Hitungan" diulang di tiap baris. (4) Setelah Subuh tidak ada jalan cepat ke amalan Subuh. (5) Empat blok teks sebelum aksi pertama. | Progress bar "Syarat sesi tuntas x dari y" dari data sesi (bukan angka karangan). Hitungan "x dari y" per fase (di luar `h2`, nama heading "Malam" tetap). Baris dzikir: ikon lingkaran/centang 28px sejajar dengan kotak centang 28px, "0 dari 100 kali, selesai", bar tipis tanpa label ulang (`ProgressBar.hideText`). Tombol "Lanjut: <amalan wajib pertama yang belum selesai>" hanya setelah ada satu yang selesai (dzikir langsung ke counter, centang ke baris lewat `#act-id`). Banner Subuh punya tautan "Ke amalan Subuh". Legenda syarat tetap tampil (keputusan owner). |
| Dashboard `/dashboard` | Badge demo dan lima ikon pintasan turun ke dua baris di 390px (selisih 4px), memakan tinggi sebelum tombol utama. | Ikon pintasan tanpa celah (tiap target tetap 44px), tombol keluar 44px. Satu baris di 390. Tombol utama tetap paling menonjol dan di atas lipatan. Kartu dan hierarki lain tidak diubah. |
| Levels `/levels` | Level aktif hanya dibedakan chip kecil. | Kartu level aktif berbingkai primary + latar lembut, kartu terkunci memakai surface-2. Teks tidak berubah. |
| Onboarding `/onboarding` | Langkah hanya teks 13px. Daftar radio tanpa batas jelas, target bagus tapi area tidak terlihat. | Batang 3 segmen di atas teks langkah (`aria-hidden`, teks `onboarding-step` tetap). Radio jadi baris berbingkai 56px dengan sorotan saat terpilih (`has-[:checked]`). |
| Entry `/` | Tombol Masuk kecil di mobile, di tengah halaman. | Tombol penuh lebar di mobile, auto di sm+. Teks tidak berubah. |
| Login, Verify, Access status | Dibaca dan difoto. Hierarki, label, error dekat field, link CS/Scalev dari config sudah benar. | Tidak ada perubahan. |
| Shell (nav, header) | Nav bawah 68px, target 44px, aman area bawah. Dev panel tidak disentuh. | Hanya `PageHeader` (celah aksi dan ukuran tombol keluar). |

## Perubahan komponen `src/components/ui/**` (API tambahan, tidak ada yang dihapus)
| Komponen | Perubahan |
|----------|-----------|
| `ProgressBar` | prop opsional `hideText` (sembunyikan baris label/nilai, `aria-label` dan `aria-valuetext` tetap). |
| `ProgressRing` | prop opsional `fluid` (ikut lebar induk, kotak persegi) dan `done` (busur hijau). Trek memakai `border-strong/35`. Pemakaian lama tetap sama. |

## Gerbang (output asli)
- `pnpm typecheck`: bersih. `pnpm lint`: bersih. `pnpm test`: 30 file, 549 passed, 3 skipped (live DB).
- `pnpm audit --prod`: "No known vulnerabilities found".
- `pnpm test:e2e --trace off` (penuh, port 3200): 209 passed, 30 skipped, 1 failed: `r3b-settings.spec.ts:20` (U1b, tidak saya sentuh). Lihat "Masalah lingkungan" di bawah.
- Spec baru `tests/e2e/u1a-night-flow.spec.ts`: 7 passed di desktop, 10 passed di dua project (sebelum menambah axe). Mencakup: posisi tombol tap tidak bergeser saat target tercapai dan berada di atas nav pada 390x844, tombol >= 160px, progres syarat, tombol Lanjut, tautan Subuh, header satu baris, batang langkah onboarding, axe 0 serious/critical untuk sesi dan counter saat target tercapai di light dan dark.
- axe: spec yang sudah ada (`s3-a11y`, `shell`, `r3a-auth`, `r3a-session`, `r3a-devices`) tetap lulus, termasuk route dashboard, worship, levels, login, verify, onboarding, access status dalam light dan dark.

## Masalah lingkungan (perlu orchestrator)
`r3b-settings.spec.ts:20` ("jam tenang dan durasi ibadah bertahan setelah reload", U1b) gagal pada port 3100 (`Target tidur` kembali 22:00, bukan 23:00). Bukti bukan dari U1a:
1. Worktree bersih `origin/main` (tanpa perubahan saya) gagal di port 3100 dan lulus di 3200.
2. Branch ini dengan `src` dikembalikan ke main juga gagal di 3100 dan lulus di 3200.
3. Pada run penuh di 3200 test ini masih sekali gagal di bawah beban paralel, lulus saat dijalankan sendiri.
Dugaan: kondisi balapan simpan lalu reload di `planner-section` (preferensi hanya di perangkat) yang peka waktu, bukan masalah port itu sendiri. Perlu diperiksa U1b/T2. Dua test lain (`r3a-devices:121`, `r3b-quran:57`) gagal sekali di run penuh pertama dan lulus saat diulang sendiri (flake beban). Saya tidak mengubah file U1b. `playwright.config.ts` tidak diubah (port 3200 hanya sementara saat verifikasi lokal).
Catatan lain: run e2e penuh menjalankan spec `@screens`/`@s3screens` lama yang menimpa PNG di `docs/screenshots/s1,s3`. Saya mengembalikannya dengan `git checkout` agar diff bersih.

## Penelusuran Hallmark Floor dan antislop (manual)
Token hanya lewat variabel (tanpa literal warna/font baru), tanpa `transition: all`, tanpa animasi width/height (cincin `stroke-dashoffset`, bar `scaleX`), `overflow-x: clip`, `:focus-visible` instan, reduced-motion di CSS global, tanpa eyebrow/huruf kapital berlabel, tanpa em-dash dan tanpa titik tengah di copy baru, tanpa emoji, tanpa angka karangan (semua dari data sesi), semua kontrol berupa `button`/`a`/`input`, nama aksesibel ada. Tombol utama satu gaya. Copy baru: "Lanjut: ...", "Ke amalan Subuh", "Target tercapai", "x dari y": pendek, tanpa menyalahkan.
Dibiarkan sadar: ikon Lucide (keputusan proyek, relevan dengan isi), badge "Data demo" (wajib CLAUDE.md), wordmark teks (logo belum ada).

## Sisa pekerjaan dan saran
- Wake Lock "Layar tetap menyala" masih opt-in. Untuk jam 3 pagi layar mati saat menghitung. Saran: default aktif di counter jika didukung (keputusan produk, PRD §12.1 menulis "toggle"). Tidak saya ubah.
- Getar ringan hanya saat target (PRD §12.1). Getar per tap tidak ditambah (bisa mengganggu), usulan bila owner mau.
- Transliterasi tetap `null` sampai owner menyediakan (CLAUDE.md), jadi tidak ada toggle.
- Pindah level: tidak ada perubahan alur.
- STATUS.md: deskripsi baris Worship session dan Dzikir counter diperbarui. `docs/SESSION_LOG.md` tidak disentuh (aturan paralel: milik orchestrator), ringkasan ini bisa disalin.

## Pertanyaan untuk owner
1. Wake Lock default aktif di counter? (rekomendasi: ya)
2. Getar tiap tap, opsional di pengaturan? (rekomendasi: tunda)
