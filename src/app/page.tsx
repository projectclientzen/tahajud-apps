import Link from "next/link";
import { RedirectIfSignedIn } from "@/components/auth/redirect-if-signed-in";
import { DemoBadge } from "@/components/brand/demo-badge";
import { Wordmark } from "@/components/brand/wordmark";
import { buttonVariants } from "@/components/ui/button";
import { PURCHASE_URL } from "@/lib/env";

/** Light entry page (PRD v1.2 §5.2). Signed-in visitors are sent on to the dashboard. */
export default function EntryPage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-[var(--content-max)] flex-col px-4 py-6 sm:px-6">
      <RedirectIfSignedIn />
      <header className="flex items-center justify-between gap-3">
        <Wordmark />
        <DemoBadge />
      </header>
      <section className="flex flex-1 flex-col justify-center gap-6 py-16">
        <h1 className="max-w-[14ch] text-[2.5rem] font-bold leading-[1.1] sm:text-[3.25rem]">
          Satu malam demi satu malam.
        </h1>
        <p className="max-w-[34ch] text-[1.125rem] text-text-muted">
          Catat tahajud, hitung dzikir, dan lihat istiqomahmu tumbuh.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/login" className={buttonVariants({ size: "lg" })}>
            Masuk
          </Link>
          {PURCHASE_URL ? (
            <a
              href={PURCHASE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "secondary", size: "lg" })}
            >
              Beli akses
              <span className="sr-only"> (buka di tab baru)</span>
            </a>
          ) : null}
        </div>
      </section>
    </main>
  );
}
