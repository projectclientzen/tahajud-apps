"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { mushaf, quranMeta } from "@/data/quran";
import { JUZ_COUNT, PAGE_COUNT } from "@/domain/quran";
import { cn } from "@/lib/cn";
import { readHref } from "./read-modes";

type Tab = "surah" | "juz";

function GoToPage() {
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > PAGE_COUNT) {
      setError(`Isi nomor halaman 1 sampai ${PAGE_COUNT}.`);
      return;
    }
    router.push(readHref("halaman", n));
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor="go-page" className="font-medium">
        Buka halaman
      </label>
      <div className="flex gap-2">
        <input
          id="go-page"
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          aria-describedby={error ? "go-page-error" : undefined}
          aria-invalid={error ? true : undefined}
          placeholder={`1 sampai ${PAGE_COUNT}`}
          className="min-h-12 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3"
        />
        <Button type="submit" variant="secondary">
          Buka
        </Button>
      </div>
      {error ? (
        <p id="go-page-error" role="alert" className="text-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function Row({ href, primary, secondary }: { href: string; primary: string; secondary: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
        <span className="flex flex-col">
          <span className="font-medium">{primary}</span>
          <span className="text-helper text-text-muted">{secondary}</span>
        </span>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-text-muted" />
      </Link>
    </li>
  );
}

/** Surah and juz lists plus a "go to page" box. Positions only, no Qur'an text. */
export function BrowseLists() {
  const [tab, setTab] = React.useState<Tab>("surah");
  return (
    <section aria-label="Jelajah Al-Qur'an" className="flex flex-col gap-4">
      <div role="group" aria-label="Daftar" className="flex gap-2">
        {(["surah", "juz"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "min-h-11 rounded-full border px-4 font-medium",
              tab === t ? "border-primary bg-primary text-on-primary" : "border-border-strong text-text",
            )}
          >
            {t === "surah" ? "Surah" : "Juz"}
          </button>
        ))}
      </div>
      <Card as="div" className="p-0">
        <ul className="flex flex-col divide-y divide-border">
          {tab === "surah"
            ? quranMeta.surahs.map((s) => (
                <Row
                  key={s.number}
                  href={readHref("surah", s.number)}
                  primary={`${s.number}. ${s.name}`}
                  secondary={`${s.ayahs} ayat, halaman ${mushaf.surahFirstPage(s.number)}`}
                />
              ))
            : Array.from({ length: JUZ_COUNT }, (_, i) => i + 1).map((j) => (
                <Row key={j} href={readHref("juz", j)} primary={`Juz ${j}`} secondary={`Mulai halaman ${mushaf.juzFirstPage(j)}`} />
              ))}
        </ul>
      </Card>
      <Card>
        <GoToPage />
      </Card>
    </section>
  );
}
