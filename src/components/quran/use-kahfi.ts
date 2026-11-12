"use client";

import * as React from "react";
import { useData, useLoad, useNow } from "@/components/providers/data-provider";
import { alKahfiWindow, isInAlKahfiWindow, parseClock, zonedInstant } from "@/domain";

/** "Bacaan Jumat" state from the domain window. `estimate` is true when Maghrib is missing (manual schedule). */
export function useKahfiWindow(): { active: boolean; estimate: boolean } {
  const now = useNow(30_000);
  const { version } = useData();
  const { data } = useLoad((l) => l.prayer.getNextFajr(), [version]);
  return React.useMemo(() => {
    if (!now || !data) return { active: false, estimate: false };
    const tz = data.timezone;
    const clock = data.maghrib_at
      ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(
          new Date(data.maghrib_at),
        )
      : null;
    const m = clock ? parseClock(clock) : null;
    const w = alKahfiWindow({
      now,
      tz,
      maghribFor: (d) => (m ? zonedInstant(d, m.hour, m.minute, tz) : null),
    });
    return { active: isInAlKahfiWindow(w, now), estimate: w?.usedFallback ?? false };
  }, [now, data]);
}
