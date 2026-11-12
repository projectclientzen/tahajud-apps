# Brief Agen A: S3 layar inti (Dashboard, Sesi Ibadah, Dzikir Counter, Level Journey)

Baca dulu: `CLAUDE.md`, `docs/briefs/PARALLEL-RULES.md`, `docs/PRD-v1.2.md` §6.3, §7, §8, §10-12, §26, `docs/DESIGN_SYSTEM.md`, `docs/SITEMAP.md`, `docs/sessions/S1.md`, `docs/sessions/S2.md` (API data layer, dev tools, skenario).

## Kondisi awal di main
Design system + shell (S1), domain engine + kontrak Zod + mock data layer dengan 7 skenario dan time travel (S2). Route `/dashboard`, `/worship` masih placeholder.

## Tugas
1. `src/components/providers/`: `DataProvider` (client) yang membuat satu `createDataLayer({...})` per user demo, plus hooks per area. Pakai TanStack Query jika menurutmu sepadan (catat alasan); jika tidak, hooks sederhana dengan invalidasi manual. UI tidak boleh import dari `src/data/mock/**`.
2. Dev panel (hanya `NEXT_PUBLIC_DATA_MODE=mock` dan non-production): pilih skenario, atur jam (time travel: +1 jam, +1 hari, set jam tertentu), simulasi offline, provider jadwal down, reset. Tombol kecil yang membuka Sheet, tidak menutupi CTA.
3. `/dashboard`: section A-I PRD §8.2, filter 7/30/90, kalender (ikon + label, klik membuka detail sesi), semua state §8.3. Angka hanya dari data layer.
4. `/worship` + `/worship/session`: daftar aktivitas per fase (malam, Subuh, setelah Subuh), centang salat/checklist, link ke counter, transisi Subuh (tanpa countdown negatif, tanpa auto-centang, aktivitas malam tetap bisa dicatat), ringkasan sesi. Label "required" menyebut syarat aplikasi, bukan kewajiban fikih.
5. `/worship/dhikr/[id]`: tombol tap ≥ 160px, progress ring, minus, reset dengan konfirmasi (`set_zero`), konfirmasi target tercapai + "+N lebih", toggle "Layar tetap menyala" (Wake Lock jika didukung), getar jika didukung, indikator "Tersimpan di perangkat / Tersinkron". Teks Arab dari data layer (asal `content/amalan.v1.json`), apa adanya. Transliterasi `null`: jangan tampilkan toggle jika tidak ada.
6. Mode berhalangan: satu malam atau rentang (maks 15 hari), tanpa alasan, bisa dibatalkan dalam jendela koreksi.
7. `/levels`: perjalanan 3 level, locked state, milestone Level 3, "berlaku mulai sesi berikutnya".
8. Tambah `pf_al_waqiah` dan `pf_ayat_seribu_dinar` sebagai centang dengan catatan "Reader menyusul". Jangan tampilkan teks ayat.
9. E2E baru (`tests/e2e/s3-*.spec.ts`): DZIKIR-01 (tap tersimpan setelah reload), DZIKIR-04 (100 tap cepat → jumlah request sesuai coalescing, cek lewat dev tools/mock), LEVEL-02 via skenario, REPORT-02 (akun baru = empty state), alur Level 1 dari dashboard sampai ringkasan di 360px, transisi Subuh via time travel. Axe light + dark untuk semua route baru.

## Default yang dipakai (keputusan owner belum final, tandai PROV di UI kode)
- Salat: satu centang per salat (usulan S2-2).
- `program_start_date`: sesi pertama yang bisa dikerjakan (S2-3).
- Insight: ambang dan teks dari `src/domain/reporting/insight.ts` apa adanya.

## Skill
ui-ux-pro-max, hallmark (Floor), antislop (Delivery Gate wajib sebelum selesai), antislop-ui, antislop-human, antislop-layoutmobile, antislop-copywriting (semua copy UI), antislop-code, ponytail. Catat di laporan skill mana yang benar-benar dipanggil lewat tool Skill.

## Definition of done
- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e --trace off` lolos, output asli di `docs/sessions/S3.md`.
- Screenshot `docs/screenshots/s3/` (dashboard, sesi, counter, levels; 390 & 1280; light & dark), dilihat sendiri.
- Badge "Data demo" tampil di semua layar berdata.
- Commit + push ke branch sesi (bukan main).
