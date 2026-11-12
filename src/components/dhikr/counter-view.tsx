"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { LoadGate } from "@/components/providers/load-gate";
import { useData, useLoad } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback-state";
import { STORE_QUEUE, openUserDb } from "@/data/user-db";
import type { QueueItem } from "@/offline";
import { CounterScreen, opsFromQueue } from "./counter-screen";

/** /worship/dhikr/[id]: finds the counter activity in tonight's session and mounts the counter. */
export function CounterView({ id }: { id: string }) {
  const { userId, queue } = useData();
  const { data, error, loading, reload } = useLoad(async (l) => {
    const session = await l.session.getActiveSession();
    // Wait for the queue to load, then read what an earlier visit left in it.
    await queue?.pendingCount();
    const items = (await (await openUserDb(userId)).getAll(STORE_QUEUE)) as QueueItem[];
    return { session, items };
  });
  const activity = data?.session?.activities.find((a) => a.id === id && a.kind === "counter") ?? null;
  const back = (
    <Link href="/worship/session" className={`${buttonVariants({ variant: "ghost" })} whitespace-nowrap`}>
      <ChevronLeft aria-hidden className="size-5" />
      Kembali ke sesi
    </Link>
  );
  return (
    <>
      <PageHeader title={activity?.title ?? "Dzikir"} actions={back} />
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {({ session, items }) =>
          activity ? (
            <CounterScreen key={activity.id} activity={activity} initialOps={opsFromQueue(items, activity.id)} />
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
