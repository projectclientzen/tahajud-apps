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

## Sinkron main (b3a43ea) dan permintaan U1b
- `git merge origin/main` bersih, tanpa konflik.
- Kartu jadwal dashboard kini memakai `ScheduleNote` (`@/components/settings/schedule-note`): label sumber, Terverifikasi/Perlu dicek ulang/Belum diverifikasi (ikon + teks), atribusi "Bimas Islam Kemenag RI via EQuran.id" hanya untuk jadwal penyedia asli. Baris "jadwal tersimpan" dan "terakhir sinkron" tetap.
- `PageHeader` padat di 390 px: sudah (aksi + badge + Keluar sebaris, diuji di `u1a-night-flow`).
- `s3-a11y` dark mobile di `/worship/dhikr/[id]` (document-title): tidak bisa direproduksi (4/4 lulus terisolasi). Penyebab yang masuk akal: judul dokumen diperbarui Next sesaat setelah navigasi klien, axe kadang jalan lebih dulu saat beban tinggi. Perbaikan: test menunggu `toHaveTitle(/Dzikir/)` sebelum axe (aturan axe tidak dilonggarkan).

## Gerbang akhir pada hasil gabungan (output asli)
- `pnpm typecheck`, `pnpm lint`: bersih. `pnpm test`: 33 file, 593 passed, 3 skipped (live DB). `pnpm audit --prod`: "No known vulnerabilities found".
- `pnpm test:e2e --trace off` (penuh, port 3100): 258 passed, 46 skipped, 2 failed. Keduanya `r3b-quran.spec.ts:29` (U1b), mobile dan desktop, galat di kode test: `apiResponse.text: Response has been disposed` pada `route.fetch()` di baris 92-93. Bukan U1a: pada worktree `origin/main` murni, test yang sama di project mobile lulus sekali dan gagal sekali dengan galat identik (flake balapan intersepsi rute). Terisolasi di branch ini: desktop lulus, mobile gagal sekali.
- Spec `u1a-night-flow` (10 test, dua project) dan semua spec a11y lain lulus (axe 0 serious/critical di route U1a, light dan dark).
- Run sebelum merge: 209 passed, 1 failed `r3b-settings:20` (U1b, lingkungan/balapan; gagal juga di `main` lama pada port 3100). Tidak muncul lagi di run gabungan ini.
- Run e2e penuh menimpa PNG lama di `docs/screenshots/s1,s3`; dikembalikan dengan `git checkout`.

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
