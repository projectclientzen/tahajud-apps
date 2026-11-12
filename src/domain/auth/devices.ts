import { PROVISIONAL_AUTH } from "../config/provisional";

export interface DeviceRef {
  id: string;
  lastSeenAt: number;
}

/**
 * Devices to sign out so that one more login still fits under the limit (PRD §17.1, PROV).
 * Oldest `lastSeenAt` goes first. Returns [] when there is room.
 */
export function devicesToRevoke(
  active: readonly DeviceRef[],
  max: number = PROVISIONAL_AUTH.maxActiveDevices,
): string[] {
  const excess = active.length + 1 - max;
  if (excess <= 0) return [];
  return [...active]
    .sort((a, b) => a.lastSeenAt - b.lastSeenAt)
    .slice(0, excess)
    .map((d) => d.id);
}
