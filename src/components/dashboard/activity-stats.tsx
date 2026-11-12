"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { Dashboard } from "@/data";
import { activityTitle } from "./content-lookup";

type Stat = Dashboard["activity_statistics"][number];
const TOP = 6;

/** Section F: how often each amalan was completed, most consistent first. */
export function ActivityStats({ stats }: { stats: Stat[] }) {
  const [all, setAll] = React.useState(false);
  const rows = stats
    .filter((s) => s.sessions > 0)
    .sort((a, b) => b.times_completed / b.sessions - a.times_completed / a.sessions || b.sessions - a.sessions);
  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, TOP);
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Performa amalan</CardTitle>
      <ul className="flex flex-col gap-4">
        {shown.map((s) => (
          <li key={s.id}>
            <ProgressBar
              label={activityTitle(s.id)}
              value={s.times_completed}
              max={s.sessions}
              valueText={`${s.times_completed} dari ${s.sessions} sesi`}
            />
            {s.total_count > 0 ? (
              <p className="pt-1 text-helper text-text-muted">Total hitungan {s.total_count.toLocaleString("id-ID")}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {rows.length > TOP ? (
        <Button variant="ghost" onClick={() => setAll((v) => !v)}>
          {all ? "Tampilkan lebih sedikit" : `Tampilkan semua (${rows.length})`}
        </Button>
      ) : null}
    </Card>
  );
}
