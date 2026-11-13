import type { Metadata } from "next";
import Link from "next/link";
import { AuthLink, CsLink } from "@/components/auth/auth-links";
import { AuthShell } from "@/components/auth/auth-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Pembayaran diterima" };

/**
 * Where Scalev sends the buyer after paying. Public and static: it reads nothing from the URL and grants nothing.
 * Access starts only after the server has verified the order with Scalev.
 */
export default function Page() {
  return (
    <AuthShell>
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title font-bold">Pembayaran diterima</h1>
        <p className="text-text-muted">
          Buka aplikasi lalu pilih Aktivasi akun. Pakai email dan nomor HP yang sama dengan saat order.
        </p>
      </div>
      <Link href="/activate" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
        Aktivasi akun
      </Link>
      <p className="text-text-muted">
        Pembayaran kadang butuh beberapa menit untuk terverifikasi. Kalau aktivasi belum berhasil, tunggu sebentar lalu
        coba lagi.
      </p>
      <div className="flex flex-col">
        <AuthLink href="/login">Sudah punya akun? Masuk</AuthLink>
        <CsLink />
      </div>
    </AuthShell>
  );
}
