import Link from "next/link";
import { CS_WHATSAPP_URL } from "./auth-shell";

const linkClass = "inline-flex min-h-11 items-center py-2 font-semibold underline";

export function CsLink({ children = "Hubungi CS lewat WhatsApp" }: { children?: React.ReactNode }) {
  return CS_WHATSAPP_URL ? (
    <a href={CS_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  ) : (
    <p className="text-helper text-text-muted">Nomor WhatsApp CS menyusul.</p>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={linkClass}>
      {children}
    </Link>
  );
}
