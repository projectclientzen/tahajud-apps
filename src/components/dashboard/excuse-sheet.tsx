"use client";

import * as React from "react";
import { errorMessage, useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { addDaysISO } from "@/lib/dates";
import { formatDateLong } from "@/lib/format-id";

const fieldClass =
  "min-h-12 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-body";

interface ExcuseSheetProps {
  /** Session key of tonight, used as the default date. */
  sessionKey: string;
  /** Dates already marked, so the user can undo them. */
  excusedDates: string[];
  trigger: React.ReactNode;
}

/** Excuse mode (PRD §10.6): one night or a range of at most 15 days, no reason asked. */
export function ExcuseSheet({ sessionKey, excusedDates, trigger }: ExcuseSheetProps) {
  const { layer, bump } = useData();
  const [open, setOpen] = React.useState(false);
  const [range, setRange] = React.useState(false);
  const [from, setFrom] = React.useState(sessionKey);
  const [to, setTo] = React.useState(sessionKey);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setFrom(sessionKey);
      setTo(sessionKey);
      setError(null);
    }
  }, [open, sessionKey]);

  async function submit() {
    if (!layer) return;
    setBusy(true);
    setError(null);
    try {
      await layer.excuse.addExcuse(range ? { from, to } : { from: sessionKey });
      bump();
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(date: string) {
    if (!layer) return;
    setError(null);
    try {
      await layer.excuse.cancelExcuse(date);
      bump();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      title="Tandai berhalangan"
      description="Tanpa alasan. Progress level tetap aman dan malam ini tidak dihitung."
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1">
          <legend className="pb-1 font-semibold">Untuk</legend>
          <label className="flex min-h-12 items-center gap-3">
            <input
              type="radio"
              name="excuse-mode"
              className="size-5 accent-[var(--primary)]"
              checked={!range}
              onChange={() => setRange(false)}
            />
            Malam ini ({formatDateLong(sessionKey)})
          </label>
          <label className="flex min-h-12 items-center gap-3">
            <input
              type="radio"
              name="excuse-mode"
              className="size-5 accent-[var(--primary)]"
              checked={range}
              onChange={() => setRange(true)}
            />
            Rentang tanggal
          </label>
        </fieldset>

        {range ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="excuse-from" className="text-helper text-text-muted">
                Dari
              </label>
              <input
                id="excuse-from"
                type="date"
                className={fieldClass}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="excuse-to" className="text-helper text-text-muted">
                Sampai (maksimal 15 hari)
              </label>
              <input
                id="excuse-to"
                type="date"
                className={fieldClass}
                min={from}
                max={addDaysISO(from, 14)}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
            {error}
          </p>
        ) : null}

        <Button onClick={submit} loading={busy}>
          Tandai berhalangan
        </Button>

        {excusedDates.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="font-semibold">Sudah ditandai</p>
            <ul className="flex flex-col gap-1">
              {excusedDates.map((d) => (
                <li key={d} className="flex items-center justify-between gap-3">
                  <span>{formatDateLong(d)}</span>
                  <Button variant="ghost" onClick={() => cancel(d)}>
                    Batalkan
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-helper text-text-muted">Pembatalan hanya bisa selama masih dalam jendela koreksi.</p>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
