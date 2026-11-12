"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { ErrorState, OfflineState, PurchasePendingState } from "@/components/ui/feedback-state";
import { Skeleton } from "@/components/ui/skeleton";
import { errorCode, errorMessage } from "./data-provider";

interface LoadGateProps<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  onRetry: () => void;
  children: (data: T) => React.ReactNode;
}

function PageSkeleton() {
  return (
    <div role="status" aria-label="Memuat" className="flex flex-col gap-4">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** One place for loading, error, offline and purchase-pending states (PRD §26). Old data stays visible on reload. */
export function LoadGate<T>({ data, error, loading, onRetry, children }: LoadGateProps<T>) {
  const code = errorCode(error);
  // Access beats stale data: once the entitlement is inactive, old numbers must not stay on screen.
  if (code === "ENTITLEMENT_INACTIVE") return <PurchasePendingState />;
  const retry = (
    <Button variant="secondary" onClick={onRetry}>
      Coba lagi
    </Button>
  );
  if (data !== null) {
    return (
      <>
        {error ? (
          <p role="status" className="mb-4 rounded-[var(--radius-control)] bg-info-soft p-3">
            {code === "OFFLINE"
              ? "Kamu sedang offline. Data di layar belum diperbarui."
              : "Data belum bisa diperbarui. Yang tampil adalah data terakhir."}
          </p>
        ) : null}
        {children(data)}
      </>
    );
  }
  if (loading && !error) return <PageSkeleton />;
  if (code === "OFFLINE") return <OfflineState action={retry} />;
  return <ErrorState title="Data belum bisa dimuat" description={errorMessage(error)} action={retry} />;
}
