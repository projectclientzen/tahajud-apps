# RESUME: titik lanjut orchestrator (diperbarui 12 Nov 2026 19.50 WIB)

Dipakai jika sesi orchestrator berhenti (limit token, error) dan dilanjutkan oleh jadwal otomatis atau sesi baru.

## Posisi (19.50 WIB)
- `main` = T1 (versi Agen A lama) + T1b (batas 3 perangkat, perbaikan e2e T1-T2, checklist lewat antrean, pesan revoked) + T2 + T3a + T4 + T4b. Gerbang penuh hijau: unit 549 (+3 live skip), e2e 210 passed / 14 skipped / 0 failed, audit bersih.
- T1 versi sesi baru (`claude/t1-auth-onboarding` e7ebbc2) TIDAK dipakai (digantikan T1b yang menambahkan batas perangkat di atas versi Agen A).
- Semua sesi agen gagal ~15.25 WIB karena limit token; U1a, U1b, T3b, T4c baru mulai dan tidak menghasilkan commit. Harus dijalankan ulang di SESI BARU (sesi lama membawa context besar dan sebagian menolak pesan antar-sesi).

## Sesi aktif (dibuat 19.52 WIB, basis main 0e5cfd2)
- U1a session_01HkFB33FuS9CdmJtZsYxeh9
- U1b session_01HkFB2z3Tk5dFFpAzrVhWwD
- T3b session_01HkFB31WZSsK53dbhMBNkZk
- T4c session_01HkFB2yy3qcQu8dwc5VAxCw
Sesi lama (agen a, agen b, T1, T2, Agen C, U1b v1) tidak dipakai lagi.

## Urutan berikutnya (prioritas owner: UI/UX dulu)
1. Jalankan paralel di sesi Sonnet baru, basis `main`: U1a dan U1b (`docs/briefs/U1.md`, langsung fase B: audit + perbaiki, karena T1b sudah di main), T4c (`docs/briefs/T4c.md`, environment tahajud-apps), T3b (`docs/briefs/T3b.md`).
2. Setelah T3b merged: T5 + T6 paralel, lalu T7, T8, lalu prompt audit Fable untuk owner.
Catatan limit: reset terakhir 19.40 WIB; jendela 5 jam. Simpan pekerjaan dengan push WIP berkala.

## Keputusan owner yang berlaku (ringkas)
Batas 3 perangkat (ke-4 ditolak), sesi 30 hari, label "Sedang berjalan", legenda syarat aplikasi, post-Fajr semua level, tilawah malam opsional, Al-Waqi'ah wajib, tanpa terjemahan Qur'an (default), EQuran.id dipakai (izin komersial dikirim owner setelah MVP, sebelum launch), nomor CS dan link Scalev diisi saat build produksi, logo/nama app belum final.

## Aturan orchestrator
Agen push ke branch sesi; hanya orchestrator yang merge ke main setelah typecheck, lint, test, test:e2e --trace off, audit lolos di hasil gabungan. Jangan force-push. Tanya owner hanya untuk approval, kredensial, biaya, legal, konten agama, keputusan produk baru.

## Catatan biaya
Sesi agen lama (agen a, agen b) membawa context 570-620 ribu token, sehingga tiap langkahnya mahal. Tugas baru berikutnya dijalankan di sesi baru (create_session); sesi baru menerima tugas dari prompt pembukanya, sedangkan sesi lama yang tidak dibuat orchestrator bisa menolak pesan antar-sesi.
