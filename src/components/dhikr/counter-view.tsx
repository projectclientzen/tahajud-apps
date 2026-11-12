"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { LoadGate } from "@/components/providers/load-gate";
import { useLoad } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback-state";
import { CounterScreen } from "./counter-screen";

/** /worship/dhikr/[id]: finds the counter activity in tonight's session and mounts the counter. */
export function CounterView({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(async (l) => ({ session: await l.session.getActiveSession() }));
  const activity = data?.session?.activities.find((a) => a.id === id && a.kind === "counter") ?? null;
  const back = (
    <Link href="/worship/session" className={buttonVariants({ variant: "ghost" })}>
      <ChevronLeft aria-hidden className="size-5" />
      Kembali ke sesi
    </Link>
  );
  return (
    <>
      <PageHeader title={activity?.title ?? "Dzikir"} actions={back} />
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {({ session }) =>
          activity ? (
            <CounterScreen key={activity.id} activity={activity} />
          ) : (
            <EmptyState
              title={session ? "Dzikir ini tidak ada di sesi malam ini" : "Sesi malam ini belum dimulai"}
              description="Buka daftar amalan untuk memilih dzikir yang tersedia."
              action={
                <Link href="/worship/session" className={buttonVariants({ variant: "secondary" })}>
                  Buka sesi ibadah
                </Link>
              }
            />
          )
        }
      </LoadGate>
    </>
  );
}
