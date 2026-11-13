# X-part1: login email + password, aktivasi email + HP (bagian 1 SCALEV-AUTH-PLAN §8.7)

Tanggal 13 Nov 2026. Branch `claude/scalev-email-pass`, basis main @ 90fe8ee (CLAUDE.md dengan aturan auth baru). Rencana: `docs/sessions/SCALEV-AUTH-PLAN.md` §8 (revisi 65adeae).
Tidak dikerjakan sesuai perintah: webhook Scalev dan worker (X3/X6), admin (X8), SMTP (X2).

## Hasil
| Bagian | Status |
|--------|--------|
| Kontrak (`src/data/contracts.ts`) | `login`, `activate`, `reset-password`, `set-password`, `me/password`; kode error `INVALID_CREDENTIALS`, `ACTIVATION_FAILED`, `INVALID_TOKEN`, `WEAK_PASSWORD`; `INVALID_OTP` dihapus |
| Migration `20261116030000_auth_password.sql` | `auth_credentials`, `auth_tokens` (reset admin), `auth_events`; `purchase_orders.customer_phone_hash` + `activation_blocked`; entitlement `staff_comp` + `granted_by`; fungsi aktivasi, reset, login, token, ganti password; OTP dihapus; `delete_account` ikut menghapus bukti HP |
| Servis `src/server/auth/` | `password.ts` (scrypt), `service.ts` (`login`, `activate`, `resetPasswordSelf`, `setPasswordWithToken`, `changePassword`), `tokens.ts` (token admin), `config.ts` (`TRUSTED_PROXY_HOPS`), `crypto.ts` (`hashPhone`) |
| Endpoint | `POST /auth/login`, `/auth/activate`, `/auth/reset-password`, `/auth/set-password`, `/me/password` (+ tetap: `complete-pending-login`, `logout`, `/me`, perangkat) |
| Repository | `AuthRepository` HTTP dan mock (order demo, akun demo, tautan reset demo lewat dev panel) |
| Layar | `/login`, `/activate`, `/forgot-password`, `/reset`, `/payment/success`, ganti password di `/settings/account`; `/auth/verify` mengalihkan ke `/login` |
| Jalur OTP | `OtpProvider`, provider Supabase, `login_otps`, `otp_issue/verify`, `provision_user`, `local_auth_user`, `domain/auth/otp.ts`, layar verify, test OTP: dihapus atau diganti test alur baru. Pengecualian: lihat "Penghapusan yang butuh tangan" |

## Pengaman (CLAUDE.md) dan di mana diuji
| Aturan | Mekanisme | Test |
|--------|-----------|------|
| Rate limit per email, HP, IP | `app_private.rate_hit/rate_count`, kunci di-hash dengan pepper. Aktivasi: gagal 5/15 mnt per email, 5/15 mnt per HP, 20/jam per IP, 3/jam per pasangan. Login: gagal 10/15 mnt per email, 30/10 mnt per IP | `api-activation.test.ts` ACT-04, `api-auth.test.ts` AUTH-15, `x4-auth.live.ts` |
| IP tepercaya | `callerOf(req, TRUSTED_PROXY_HOPS)` memakai entri dari AKHIR `X-Forwarded-For` | `api-auth.test.ts` (entri palsu di depan diabaikan), `x4-auth.live.ts` |
| Respons generik | satu `ACTIVATION_FAILED`, satu `INVALID_CREDENTIALS`, satu `INVALID_TOKEN`, 429 tanpa sebab | ACT-02, AUTH-09 |
| Aktivasi sekali per entitlement | `activate_account` mengunci per email dan menolak entitlement ber-`user_id` | ACT-03 (4 request paralel, satu menang) |
| Batas 3 perangkat | `start_device_session` tidak berubah, `device_limit` + token tertunda | AUTH-14 (server, mock, live) |
| Audit | `auth_events` (activated, reset_self, reset_admin, password_changed) tanpa email/HP; `admin_audit_logs` untuk tautan reset admin | `auth-password.test.ts`, ACT-06, ADMIN-RESET-01 |
| Password hash | scrypt N=2^15, r=8, p=3, `maxmem` 64 MiB. Angka berasal dari rencana (OWASP Password Storage Cheat Sheet, setelan setara scrypt; diverifikasi sesi perencanaan 13 Nov 2026, tidak saya ulang). Yang saya buktikan sendiri: dengan `maxmem` 64 MiB hash N=2^15, r=8, p=3 benar-benar jalan di Node (test `password-hash.test.ts`) | `password-hash.test.ts`, kolom DB menolak non-PHC |
| Tidak ada plaintext | kolom `password_hash` ber-check PHC; HP hanya HMAC | AUTH-12 / ACT-05: pindai semua tabel + log setelah perjalanan penuh |
| Token reset admin | hash HMAC, sekali pakai (satu `UPDATE ... RETURNING`), 60 mnt, token baru mencabut lama, alasan wajib + audit | ADMIN-RESET-01 (server, DB), e2e mock |

## Antarmuka untuk X3/X6 (Scalev) dan X8 (admin)
Untuk X3/X6 (worker Scalev):
- Hash HP: `hashPhone(pepper, rawPhone)` di `src/server/auth/crypto.ts` (pepper = `SESSION_PEPPER`). Panggil dengan `customer.phone` (cadangan `destination_address.phone`) dari hasil `GET /v3/orders/{id}`, BUKAN dari payload webhook. Hasil null (bukan nomor) = karantina `missing_phone`. Simpan ke `purchase_orders.customer_phone_hash`.
- Syarat order untuk aktivasi (semua di `activate_account`): entitlement `entitlement_type='lifetime'`, `status='active'`, `user_id is null`, `email_normalized` = email order, waktu mulai/akhir berlaku; order `verified_via='scalev_api'`, `payment_status in ('paid','settled')`, `customer_phone_hash` terisi, `activation_blocked=false`. Order tanpa email atau HP tidak bisa diaktivasi mandiri (jalur CS).
- Tidak ada email undangan, tidak ada `auth_tokens` untuk pembeli, tidak ada penautan `user_id` oleh worker: `activate_account` menautkan.
- `email_outbox` tidak dipakai oleh alur ini.
- Pepper berubah = semua `customer_phone_hash` lama tidak cocok lagi (dicatat di `.env.example`).
- Migration T6 `housekeeping()` memanggil tabel `login_otps` yang kini dihapus. Saat T6 di-merge, ganti baris itu (lihat "Untuk orchestrator").

Untuk X8 (admin):
- `issueAdminResetToken(deps, { actorId, targetUserId, reason, ttlSeconds? })` di `src/server/auth/tokens.ts` mengembalikan `{ token, expires_at }`; `buildResetLink(appBaseUrl, token)` menyusun `/reset#t=<token>`. Token hanya ada di memori pemanggil; tampilkan sekali. SQL: `app_private.password_token_issue`. Pemanggil wajib sudah memeriksa peran admin.
- Akun staff: skema siap (`entitlement_type='staff_comp'`, tanpa `purchase_order_id`, `granted_by`). X8 membuat `auth.users` + `profiles` + entitlement, lalu tautan reset (test `works for an account that has no password yet`).
- BELUM ada (lingkup X8): bypass level untuk `staff_comp` di fungsi `get_*level*`, pengecualian staff di agregat admin/laporan, pengatur `activation_blocked` oleh admin, tampilan HP sebagian (`phoneTail` di `src/domain/auth/phone.ts` siap).
- Hapus akun (T3c) sudah menghapus kredensial (cascade) dan `customer_phone_hash`.

## Gerbang (dijalankan di checkout ini)
Diisi saat run penuh selesai, lihat bagian bawah.

## Penghapusan yang butuh tangan
Pemeriksa keamanan menolak perintah `git rm` gabungan (sesi ini tidak bisa menghapus file lewat shell). Saya tidak mengulangnya lewat jalan lain. File berikut dikosongkan (berisi satu komentar dan `export {}`); mohon dihapus dengan `git rm` sebelum merge:
- `src/server/auth/providers.ts`
- `src/components/auth/verify-form.tsx`
- `src/app/api/v1/auth/request-otp/route.ts`
- `src/app/api/v1/auth/verify-otp/route.ts`
Halaman `src/app/(auth)/auth/verify/page.tsx` sengaja dipertahankan sebagai alihan ke `/login` (bookmark lama).

## Untuk orchestrator
1. `git rm` empat file di atas.
2. Merge T6: `housekeeping()` (T6 `20261115b000100`) menghapus dari `login_otps`. Tabel itu sudah tidak ada setelah migration ini, jadi fungsi harus diganti: hapus dari `auth_tokens` (kedaluwarsa > 7 hari) dan `auth_events` bila perlu. plpgsql baru gagal saat `housekeeping` dijalankan, bukan saat migration, jadi mudah terlewat.
3. Urutan nama migration: file ini `20261116030000`. Pada urutan di rencana §5.2 ia berada setelah `email_outbox_hardening` (010000) dan `scalev_orders` (020000); `scalev_apply_order` (040000) bergantung padanya.
4. `supabase/stubs/auth_stub.sql` tidak diubah (milik X1). Fungsi pembuat akun memakai `security definer` supaya role backend tidak perlu hak tulis `auth.users`.
5. CLAUDE.md di repo sudah berisi aturan auth baru; PRD v1.3 dan `docs/PLAN.md` belum diubah (hak orchestrator).

## Risiko dan hal yang belum terbukti
- Tidak ada Postgres nyata, hanya PGlite. Perilaku `security definer`, `set local role`, dan kunci penasihat belum diuji di Postgres 16/17 (B5 di rencana).
- Waktu hash scrypt N=2^15 di VPS belum diukur. Di sini test memakai ln=10 agar cepat; satu test menjalankan ln=15 sungguhan (batas waktu 20 dtk).
- Risiko sisa yang diterima owner (CLAUDE.md): penyerang yang tahu email DAN HP order sebelum pembeli asli bisa mengambil akun. Mitigasi ada, tanpa notifikasi ke pembeli (Q13: layar sukses menampilkan "Akun aktif untuk [email]").
- Penguncian login per email bisa dipakai penyerang untuk mengunci satu email maksimal 15 menit (diterima di rencana §3.8).
- `ACCOUNT_SELF_DELETE` tetap nonaktif default (tidak diubah).
- Perilaku iOS PWA (cookie terpisah dari Safari) tidak relevan lagi untuk pembeli (tanpa tautan email), tetapi untuk tautan reset dari CS yang dibuka dari WhatsApp belum diuji di perangkat.

## Pertanyaan untuk owner
1. Q12: konfirmasi bahwa aktivasi tanpa mailbox adalah pengecualian aturan (b). CLAUDE.md sudah mencatatnya; mohon konfirmasi ulang bila perlu.
2. Q14: format dan keterisian `customer.phone` pada order Scalev nyata (cek Hermes). Normalisasi saya: `08...`, `+62...`, `62...`, `8...` menjadi `62...`; nomor luar negeri dengan `+` atau `00` dipertahankan.
3. Password minimal 10 karakter dan batas percobaan (lihat `PROVISIONAL_AUTH`): setuju?
