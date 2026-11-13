"use client";

import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { getNiat, niatFor, niatView } from "@/domain/content";

/** Activity keys that have a niat entry in content/niat.v1.json. Other steps show no button. */
export function hasNiat(activityKey: string): boolean {
  return niatFor(getNiat(), activityKey) !== null;
}

/**
 * "Lihat niat" for one prayer step. All text comes from content/niat.v1.json (owner). While the owner has not
 * filled it, the sheet says so. Nothing is generated or shown from memory.
 */
export function NiatButton({ activityKey, className }: { activityKey: string; className?: string }) {
  const content = getNiat();
  const entry = niatFor(content, activityKey);
  if (!entry) return null;
  const v = niatView(content, entry);
  return (
    <Sheet
      title={`Niat ${v.title}`}
      trigger={
        <Button variant="ghost" className={className} aria-label={`Lihat niat ${v.title}`}>
          <ScrollText aria-hidden className="size-5" />
          Lihat niat
        </Button>
      }
    >
      {v.state === "unavailable" ? (
        <div className="flex flex-col gap-2" data-testid="niat-empty">
          <p className="font-medium">Bacaan niat belum tersedia</p>
          <p className="text-text-muted">Teks niat akan muncul di sini setelah disiapkan oleh tim NgajiGaes.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-testid="niat-text">
          {v.needsReview ? (
            <p className="w-fit rounded-full bg-warning-soft px-2.5 py-0.5 text-helper font-medium">
              Teks ini belum selesai ditinjau.
            </p>
          ) : null}
          {v.arabic ? (
            <p
              className="arabic rounded-[var(--radius-control)] bg-surface-2 p-3 text-start text-[1.75rem] leading-[2.1]"
              lang="ar"
              dir="rtl"
            >
              {v.arabic}
            </p>
          ) : null}
          {v.latin ? <p className="italic">{v.latin}</p> : null}
          {v.translation ? <p className="text-text-muted">{v.translation}</p> : null}
        </div>
      )}
    </Sheet>
  );
}
