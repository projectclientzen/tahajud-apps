import Link from "next/link";
import { DemoBadge } from "@/components/brand/demo-badge";
import { Wordmark } from "@/components/brand/wordmark";
import { buttonVariants } from "@/components/ui/button";

/** Light entry page (PRD v1.2 §5.2). Login arrives in S4; until then it opens the demo. */
export default function EntryPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[var(--content-max)] flex-col px-4 py-6 sm:px-6">
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
          <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
            Buka prototipe
          </Link>
        </div>
      </section>
    </main>
  );
}
