# RESUME: titik lanjut orchestrator (diperbarui 12 Nov 2026 15.35 WIB)

Dipakai jika sesi orchestrator berhenti (limit token, error) dan dilanjutkan oleh jadwal otomatis atau sesi baru.

## Posisi
- `main`: sampai T4 + brief/dokumen (commit `4fb8ae2` + dokumen setelahnya).
- Branch integrasi `claude/great-cerf-mfce32`: main + T1 (`e7ebbc2`) + T2 (`a13b03c`) + T3a (`24f8923`) + T4b (`a3da3e3`). Unit 561 lolos, audit bersih, e2e 6 gagal (3 test x 2 project, titik temu T1-T2).
- Sedang jalan: T1b (session_01HkFB31AmZWqwfK4SsUgoiW) memperbaiki 3 e2e itu (brief `docs/briefs/T1b.md`).
- Standby: Agen C session_01HkFB2xqrE6x4NAZUwbMajW (env tahajud-apps), agen a lama session_01HkFB31nuh3ixhXSEc2U9by, agen b lama session_01HkFB32cEmv1CJ8uQzVTKou, sesi T2 session_01HkFB32eyF2QhAGWLb2o9pb.

## Urutan berikutnya (prioritas owner: UI/UX dulu)
1. T1b selesai → merge ke integrasi → gerbang penuh 0 failed → push integrasi ke `main`.
2. Paralel segera: T4c (Agen C, koordinat Wikidata, `docs/briefs/T4c.md`) karena file terpisah.
3. Sedang jalan paralel: U1a fase A (agen a lama session_01HkFB31nuh3ixhXSEc2U9by), U1b (sesi baru session_01HkFB2zxRfGDMijRrJho6k9; sesi T2 lama menolak tugas lewat pesan antar-sesi), T3b (agen b lama session_01HkFB32cEmv1CJ8uQzVTKou), T1b (session_01HkFB31AmZWqwfK4SsUgoiW), T4c (Agen C session_01HkFB2xqrE6x4NAZUwbMajW). Brief: `docs/briefs/U1.md`, `docs/briefs/T3b.md`.
4. Setelah T1b merged: kabari U1a/U1b masuk fase B. Setelah T3b merged: T5 + T6 paralel, lalu T7, T8, lalu prompt audit Fable untuk owner.
Catatan limit: owner menyebut limit token RESET pukul 16.00 WIB (bukan habis).

## Keputusan owner yang berlaku (ringkas)
Batas 3 perangkat (ke-4 ditolak), sesi 30 hari, label "Sedang berjalan", legenda syarat aplikasi, post-Fajr semua level, tilawah malam opsional, Al-Waqi'ah wajib, tanpa terjemahan Qur'an (default), EQuran.id dipakai (izin komersial dikirim owner setelah MVP, sebelum launch), nomor CS dan link Scalev diisi saat build produksi, logo/nama app belum final.

## Aturan orchestrator
Agen push ke branch sesi; hanya orchestrator yang merge ke main setelah typecheck, lint, test, test:e2e --trace off, audit lolos di hasil gabungan. Jangan force-push. Tanya owner hanya untuk approval, kredensial, biaya, legal, konten agama, keputusan produk baru.

## Catatan biaya
Sesi agen lama (agen a, agen b) membawa context 570-620 ribu token, sehingga tiap langkahnya mahal. Tugas baru berikutnya dijalankan di sesi baru (create_session); sesi baru menerima tugas dari prompt pembukanya, sedangkan sesi lama yang tidak dibuat orchestrator bisa menolak pesan antar-sesi.
