# Prompt untuk Hermes (setup Scalev untuk Tahajud Tracker)

Disiapkan orchestrator, 13 Nov 2026. Owner menyalin blok di bawah ke Hermes.

```
Konteks: kamu sudah tersambung ke API + webhook Scalev akun NgajiGaes (store id 2785, domain ngajigaes.com). Kami membangun app "Tahajud Tracker" (PWA berbayar, nanti di VPS sendiri). Rencana teknis lengkap ada di repo github.com/projectclientzen/tahajud-apps branch `claude/scalev-email-pass`, file docs/sessions/SCALEV-AUTH-PLAN.md §8.

Alur akses yang sudah diputuskan owner:
1. Pembeli checkout produk Tahajud Tracker di Scalev (email + nomor HP wajib).
2. Scalev kirim webhook ke app. App memverifikasi tanda tangan, lalu mengambil detail order lewat GET /v3/orders/{id} (tidak percaya payload webhook saja).
3. Order lunas + varian benar → app menyimpan entitlement (belum ada akun).
4. Pembeli buka app → "Aktivasi akun" → isi EMAIL + NOMOR HP yang dipakai saat order → cocok → buat password → login email + password.
5. Tanpa SMTP. Lupa password: isi email + HP lagi, atau CS membuat link reset dari halaman admin.

ATURAN: jangan kirim API key, signing secret, atau data pribadi pembeli asli di chat. Untuk contoh payload, samarkan email/HP/nama (contoh: a***@gmail.com, 0812****5678). Kalau ada yang belum bisa dicek, tulis "belum dicek", jangan menebak.

TOLONG KERJAKAN DAN LAPORKAN PER NOMOR:

A. Setup produk di Scalev
1. Buat produk "Tahajud Tracker": produk digital, sekali bayar (akses permanen), 1 varian. Laporkan product id, variant id (angka), variant_unique_id (variant_...), dan SKU.
2. Wajibkan EMAIL dan NOMOR HP di form checkout produk ini. Laporkan pengaturan yang dipakai dan apakah bisa dipaksa wajib.
3. Redirect setelah bayar: tunggu URL dari kami (rencana: https://<domain-app>/payment/success, tanpa token/order id). Catat di mana pengaturannya.
4. Harga: ISI oleh owner. Jangan mengarang.
5. Konfirmasi paket Scalev akun ini mendukung webhook (dokumentasi: paket Basic ke atas).

B. Verifikasi data order nyata (pakai 1 order lunas yang sudah ada, data pribadi disamarkan)
6. Dari GET /v3/orders/{id}: field mana yang berisi email pembeli dan nomor HP pembeli (customer.email, customer.phone, destination_address.email, destination_address.phone, atau lainnya)? Apakah selalu terisi?
7. Format nomor HP yang disimpan Scalev (08..., 62..., +62...)?
8. Di orderlines GET order: field identitas varian apa yang ada (variant angka, variant_sku, variant_unique_id)? Kirim potongan JSON yang disamarkan.
9. Nilai payment_status untuk order lunas (paid, settled, lainnya) dan field nominal.
10. Simpan 1 contoh payload webhook `order.created` dan `payment.received` asli (disamarkan) sebagai fixture, kirim ke owner dalam bentuk file, bukan teks chat panjang.

C. Webhook dan kredensial (lakukan SETELAH app sudah online dan owner memberi URL; jangan simpan webhook sebelum endpoint hidup karena Scalev langsung mengirim business.test_event dan butuh balasan 2xx)
11. Buat API key Scalev BARU khusus app ini, akses seminimal mungkin (baca order + cek pembayaran saja bila bisa). Jangan pakai key milikmu. Serahkan ke owner untuk dimasukkan ke secret environment server (SCALEV_API_KEY), bukan lewat chat.
12. Siapkan webhook ke URL app yang diberikan owner, event: order.created, payment.received, payment.failed, order.status_changed. Serahkan signing secret ke owner lewat jalur aman (SCALEV_WEBHOOK_SIGNING_SECRET).
13. Setelah webhook disimpan: laporkan apakah business.test_event berhasil (status 2xx).

D. Pertanyaan tambahan
14. Apakah Scalev mengirim ulang webhook bila endpoint gagal (retry)? Berapa kali dan interval berapa? Kalau tidak terdokumentasi, tulis "tidak terdokumentasi".
15. Apakah POST /v3/orders/{id}/check-payment punya efek samping (mengubah status, mengirim notifikasi)? Kalau tidak yakin, jangan dipanggil di order asli.
16. Refund/pembatalan: event dan nilai field apa yang muncul pada order yang di-refund atau dibatalkan?

Format jawaban: per nomor, singkat, sertakan contoh JSON yang disamarkan bila ada.
```
