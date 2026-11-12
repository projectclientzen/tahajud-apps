# Sesi T3c (Sonnet): endpoint API yang belum ada. STATUS: BERHENTI DI TENGAH (batas waktu dari orchestrator)

Branch: `claude/t3c-api-missing` di atas `main` @ a234d99. Tanggal: 2026-11-12.

## Sudah
- Migration `supabase/migrations/20261115010000_api_missing.sql` (nama numerik 14 digit karena `schema.test.ts` dan Supabase CLI mewajibkan; bukan `20261115a*`). Isi: push subscription (add/remove, trigger hapus subscription saat perangkat dicabut/logout), riwayat notifikasi, jadwal salat tersimpan, ekspor data, hapus akun (anonimkan order + entitlement dengan hash HMAC email, hapus job menunggu, catat `data_deletion_requests`).
- 8 route baru: `POST /me/data-export`, `POST /me/delete-account` (wajib `{confirm:true}`), `GET /prayer-times`, `GET /quran/surahs`, `GET /quran/surahs/:id` (dari `content/quran/uthmani.json`, teks tidak diubah), `POST /me/push-subscriptions`, `DELETE /me/push-subscriptions/:id` (SECURITY-04: id orang lain = 404), `GET /me/notifications`.
- Kode error `FORBIDDEN_ORIGIN` (403, Origin salah) dan `INTERNAL_ERROR` (500, kegagalan tak terduga). Putus koneksi/DB sibuk tetap `NOT_AVAILABLE` 503.
- http repository (`createHttpDataLayer` kini mengembalikan `DataLayer & LiveExtras`: `prayerTimes`, `quranCatalog`, `push`, `account`). Interface baru di `repositories.ts` (tambahan saja).
- Test: `tests/db/api-missing.test.ts` (55), `tests/unit/server/api-extra.test.ts` (88), test lama diperbarui (origin 403, INTERNAL_ERROR, daftar RPC, PRIVATE list).
- Live e2e baru `tests/e2e/t3c-endpoints.live.ts` + `t3c-fixtures.sql`; `playwright.t3b.config.ts` kini `t3[bc]-*.live.ts` dan memuat dua file fixture. `t3b-level1.live.ts` diperbarui (origin 403).

## Hasil gerbang (apa adanya)
```
pnpm typecheck  -> lolos
pnpm lint       -> lolos
pnpm test       -> 41 files passed, 966 passed | 3 skipped (termasuk tests/db)
```
## BELUM dijalankan
- `pnpm test:e2e --trace off`, `pnpm test:e2e:live --trace off` (termasuk `t3c-endpoints.live.ts`, belum pernah dijalankan), `pnpm audit --prod`.
- STATUS.md belum diupdate (dokumen orchestrator/owner menunggu).
- Commit akhir sesi ini di-push setelah laporan ini.

## Perlu tindakan agen/orchestrator lain
1. **Wajib bersamaan dengan merge ini**: `src/offline/sender.ts` (area Q1) set `TRANSIENT` perlu menambah `"INTERNAL_ERROR"` (dan sebaiknya `"FORBIDDEN_ORIGIN"`). Tanpa itu, 500 tak terduga pada ketukan checklist/counter dianggap `rejected` dan antrean offline membuang operasi.
2. Nama migration: T6/T7 kemungkinan kena aturan 14 digit yang sama. Saya pakai `20261115010000`; usul `020000` untuk T6, `030000` untuk T7.
3. `tests/db/schema.test.ts` (daftar RPC) akan konflik di merge bila T6/T7 menambah RPC.
4. UI hapus akun live (`src/components/settings/account-view.tsx`) masih "belum tersedia": hubungkan ke `layer.account.deleteAccount()`, lalu bersihkan IndexedDB. Implementasi mock untuk interface baru milik Q1 bila layar membutuhkannya.
5. Panduan `PRD §19.3`: `GET /prayer-times` hanya membaca baris tersimpan, `source` selalu `provider`, `cache_status=cached` berarti lewat `valid_until`.

## Keputusan teknis
- Hapus akun: user id dari cookie, bukan body. Hash email `deleted:<HMAC-SHA256(pepper)>`. Daftar ulang dengan email yang sama = tanpa akses (entitlement lama terputus). Perlu konfirmasi owner.
- Endpoint push milik browser: pengguna terakhir yang login di browser itu memiliki endpoint (upsert), maks 10 subscription per user.
- Ekspor/hapus/hapus-push tidak butuh entitlement aktif. Ekspor dan hapus dibatasi 5 per jam per user.
- Ekspor memuat tanggal berhalangan milik user itu sendiri (bukan untuk admin).
- `GET /me/notifications`: hanya job `sent` 30 hari terakhir, judul/isi dari `notification_templates` bila ada. T6 dapat memperluas.
