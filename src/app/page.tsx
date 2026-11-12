import { DemoBadge } from "@/components/brand/demo-badge";
import { Wordmark } from "@/components/brand/wordmark";
import { EntryActions } from "@/components/auth/entry-actions";

/** Light entry page (PRD v1.2 §5.2): short intro, sign in, and the purchase link when one is configured. */
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
        <EntryActions />
      </section>
    </main>
  );
}
