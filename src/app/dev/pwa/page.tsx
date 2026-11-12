import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InstallGuide } from "@/components/pwa/install-guide";
import { UpdatePrompt } from "@/components/pwa/update-prompt";
import { DEV_ROUTES_ENABLED } from "@/lib/env";

export const metadata: Metadata = { title: "Komponen PWA", robots: { index: false } };

/** Dev gallery for the PWA components. Off in production unless NEXT_PUBLIC_ENABLE_DEV_ROUTES=true. */
export default function Page() {
  if (!DEV_ROUTES_ENABLED) notFound();
  return (
    <main className="mx-auto flex max-w-[var(--content-max)] flex-col gap-6 p-4 md:p-8">
      <h1 className="text-2xl font-bold">Komponen PWA</h1>
      <section aria-labelledby="g-install" className="flex flex-col gap-3">
        <h2 id="g-install" className="text-lg font-semibold">
          Panduan pasang
        </h2>
        <InstallGuide />
      </section>
      <section aria-labelledby="g-update" className="flex flex-col gap-3">
        <h2 id="g-update" className="text-lg font-semibold">
          Pemberitahuan versi baru
        </h2>
        <UpdatePrompt preview />
      </section>
    </main>
  );
}
