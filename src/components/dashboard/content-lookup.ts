import { getAmalan } from "@/domain/content";
import type { LevelNumber } from "@/domain/config/provisional";

export const levelTitle = (level: LevelNumber) => getAmalan().levels[level].title;

/** Activity ids look like "night:tahlil" (S2-1). Any level that has the id can name it. */
export function activityTitle(id: string): string {
  for (const level of [3, 2, 1] as const) {
    const hit = getAmalan().levels[level].activities.find((a) => a.id === id);
    if (hit) return hit.title;
  }
  return id;
}
