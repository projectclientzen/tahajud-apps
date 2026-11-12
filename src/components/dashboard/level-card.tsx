import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { LevelProgressResponse } from "@/data";
import { levelTitle } from "./content-lookup";

/** Section C: active level, completed nights against the target, link to the journey. */
export function LevelCard({ progress }: { progress: LevelProgressResponse }) {
  const current = progress.levels.find((l) => l.is_current) ?? progress.levels[0]!;
  const left = Math.max(0, current.required - current.completed);
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>
        Level {current.level}: {levelTitle(current.level)}
      </CardTitle>
      <ProgressBar
        label="Malam tuntas"
        value={Math.min(current.completed, current.required)}
        max={current.required}
        valueText={`${current.completed} dari ${current.required} malam tuntas`}
      />
      <p className="text-text-muted">
        {left > 0 ? `Tinggal ${left} malam tuntas lagi.` : "Target level ini sudah tercapai."}
      </p>
      <p className="text-helper text-text-muted">Target level masih sementara sampai disetujui pembimbing.</p>
      <Link href="/levels" className={buttonVariants({ variant: "secondary", block: true })}>
        Lihat perjalanan level
      </Link>
    </Card>
  );
}
