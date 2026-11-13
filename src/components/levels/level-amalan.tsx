import { getAmalan, PHASES } from "@/domain/content";
import { cn } from "@/lib/cn";

const PHASE_LABEL = { night: "Malam", fajr: "Subuh", post_fajr: "Setelah Subuh" } as const;

/**
 * What one level asks for, phase by phase, with the Arabic text straight from content/amalan.v1.json.
 * Read only and free of hooks, so Help and the level history share it. Nothing here edits or reformats the text.
 */
export function LevelAmalan({
  level: lv,
  className,
  phaseHeading: PhaseHeading = "h4",
}: {
  level: 1 | 2 | 3;
  className?: string;
  /** Heading level of the phase titles, so a page can keep its outline in order. */
  phaseHeading?: "h3" | "h4";
}) {
  const amalan = getAmalan();
  const level = amalan.levels[lv];
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {PHASES.map((ph) => {
        const items = level.activities.filter((a) => a.phase === ph);
        if (items.length === 0) return null;
        return (
          <div key={ph} className="flex flex-col gap-2">
            <PhaseHeading className="font-semibold">{PHASE_LABEL[ph]}</PhaseHeading>
            <ul className="flex flex-col gap-3">
              {items.map((a) => {
                const dhikr = a.dhikrRef ? amalan.dhikr[a.dhikrRef] : null;
                const meta = [
                  a.target ? `Target ${a.target} ${a.unit ?? ""}`.trim() : null,
                  a.required ? null : "Opsional",
                ]
                  .filter(Boolean)
                  .join(". ");
                return (
                  <li key={a.id} className="flex flex-col gap-1">
                    <p>
                      {a.title}
                      {meta ? <span className="block text-helper text-text-muted">{meta}</span> : null}
                    </p>
                    {dhikr ? (
                      <p
                        className="arabic rounded-[var(--radius-control)] bg-surface-2 p-3 text-start text-[1.5rem] leading-[2.1]"
                        lang="ar"
                        dir="rtl"
                      >
                        {dhikr.arabicText}
                      </p>
                    ) : null}
                    {dhikr && dhikr.reviewStatus !== "published" ? (
                      <p className="text-helper text-text-muted">Teks ini belum selesai ditinjau.</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
