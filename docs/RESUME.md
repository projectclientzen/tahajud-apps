# RESUME: titik lanjut orchestrator

> MODE HEMAT (owner, 13 Nov 2026 00.46 WIB): semua otomasi DIJEDA. Jangan membuat sesi agen baru atau jadwal otomatis sampai owner bilang lanjut. Sisa: merge T3b (branch claude/t3b-api-v1 @ fbafd61, sudah hijau di branch-nya), Q1 terhenti karena limit (branch claude/q1-e2e-flaky, WIP), lalu T5, T6, T7, T8, audit Fable.
 (diperbarui 12 Nov 2026 19.50 WIB)

Dipakai jika sesi orchestrator berhenti (limit token, error) dan dilanjutkan oleh jadwal otomatis atau sesi baru.

## Posisi (19.50 WIB)
- `main` = T1 (versi Agen A lama) + T1b (batas 3 perangkat, perbaikan e2e T1-T2, checklist lewat antrean, pesan revoked) + T2 + T3a + T4 + T4b. Gerbang penuh hijau: unit 549 (+3 live skip), e2e 210 passed / 14 skipped / 0 failed, audit bersih.
- T1 versi sesi baru (`claude/t1-auth-onboarding` e7ebbc2) TIDAK dipakai (digantikan T1b yang menambahkan batas perangkat di atas versi Agen A).
- Semua sesi agen gagal ~15.25 WIB karena limit token; U1a, U1b, T3b, T4c baru mulai dan tidak menghasilkan commit. Harus dijalankan ulang di SESI BARU (sesi lama membawa context besar dan sebagian menolak pesan antar-sesi).

## Sesi aktif (20.30 WIB, main 2333cb7)
- Selesai & merged: U1a, U1b, T4c (+ T1, T1b, T2, T3a, T4, T4b).
- Berjalan: T3b session_01HkFB31WZSsK53dbhMBNkZk (API v1 + data live), Q1 session_01HkFB2yjk91AbSymgLRYH8V (stabilkan e2e flaky).

## Urutan berikutnya (prioritas owner: UI/UX dulu)
1. Tunggu T3b dan Q1. Owner diberi tahu bahwa UI siap direview (U1a+U1b merged).
2. Setelah T3b merged: T5 + T6 paralel, lalu T7, T8, lalu prompt audit Fable untuk owner.
Catatan limit: reset terakhir 19.40 WIB; jendela 5 jam. Simpan pekerjaan dengan push WIP berkala.

## Keputusan owner yang berlaku (ringkas)
Batas 3 perangkat (ke-4 ditolak), sesi 30 hari, label "Sedang berjalan", legenda syarat aplikasi, post-Fajr semua level, tilawah malam opsional, Al-Waqi'ah wajib, tanpa terjemahan Qur'an (default), EQuran.id dipakai (izin komersial dikirim owner setelah MVP, sebelum launch), nomor CS dan link Scalev diisi saat build produksi, logo/nama app belum final.

## Aturan orchestrator
Agen push ke branch sesi; hanya orchestrator yang merge ke main setelah typecheck, lint, test, test:e2e --trace off, audit lolos di hasil gabungan. Jangan force-push. Tanya owner hanya untuk approval, kredensial, biaya, legal, konten agama, keputusan produk baru.

## Catatan biaya
Sesi agen lama (agen a, agen b) membawa context 570-620 ribu token, sehingga tiap langkahnya mahal. Tugas baru berikutnya dijalankan di sesi baru (create_session); sesi baru menerima tugas dari prompt pembukanya, sedangkan sesi lama yang tidak dibuat orchestrator bisa menolak pesan antar-sesi.
