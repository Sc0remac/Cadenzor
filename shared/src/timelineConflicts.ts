import type { ProjectConflictRecord, TimelineItemRecord } from "./types";

export interface DetectTimelineConflictsOptions {
  bufferHours?: number;
}

interface ScheduledItem {
  item: TimelineItemRecord;
  start: number;
  end: number;
  lane: string;
}

const DEFAULT_BUFFER_HOURS = 4;
const FALLBACK_DURATION_MS = 2 * 60 * 60 * 1000;

function normaliseLane(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "General";
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function detectTimelineConflicts(
  items: TimelineItemRecord[],
  options: DetectTimelineConflictsOptions = {}
): { conflicts: ProjectConflictRecord[]; conflictItemIds: Set<string> } {
  const bufferHours = options.bufferHours ?? DEFAULT_BUFFER_HOURS;
  const bufferMs = Math.max(0, bufferHours) * 60 * 60 * 1000;

  const scheduled: ScheduledItem[] = items
    .map((item) => {
      const start = toTimestamp(item.startsAt);
      if (start == null) return null;
      const endRaw = toTimestamp(item.endsAt);
      const end = endRaw && endRaw > start ? endRaw : start + FALLBACK_DURATION_MS;
      return {
        item,
        start,
        end,
        lane: normaliseLane(item.lane),
      } satisfies ScheduledItem;
    })
    .filter((value): value is ScheduledItem => Boolean(value))
    .sort((a, b) => a.start - b.start);

  const conflicts: ProjectConflictRecord[] = [];
  const conflictItemIds = new Set<string>();
  const seen = new Set<string>();

  for (let i = 0; i < scheduled.length; i += 1) {
    for (let j = i + 1; j < scheduled.length; j += 1) {
      const a = scheduled[i];
      const b = scheduled[j];
      if (a.item.id === b.item.id) continue;

      const overlap = a.end > b.start && b.end > a.start;
      if (overlap && a.lane === b.lane) {
        const key = `${a.item.id}:${b.item.id}:lane`;
        if (!seen.has(key)) {
          seen.add(key);
          conflictItemIds.add(a.item.id);
          conflictItemIds.add(b.item.id);
          conflicts.push({
            id: key,
            itemIds: [a.item.id, b.item.id],
            severity: "warning",
            message: `${a.item.title} overlaps with ${b.item.title} in ${a.lane} lane`,
          });
        }
      }

      const aTerritory = a.item.territory?.trim();
      const bTerritory = b.item.territory?.trim();
      if (aTerritory && bTerritory && aTerritory === bTerritory) {
        const gap = Math.abs(a.start - b.start);
        if (gap < bufferMs) {
          const key = `${a.item.id}:${b.item.id}:territory`;
          if (!seen.has(key)) {
            seen.add(key);
            conflictItemIds.add(a.item.id);
            conflictItemIds.add(b.item.id);
            conflicts.push({
              id: key,
              itemIds: [a.item.id, b.item.id],
              severity: "error",
              message: `${a.item.title} and ${b.item.title} are both in ${aTerritory} without the ${bufferHours}h buffer`,
            });
          }
        }
      }

      if (aTerritory && bTerritory && aTerritory !== bTerritory) {
        const first = a.start <= b.start ? a : b;
        const second = first === a ? b : a;
        const gap = second.start - first.end;
        if (gap < bufferMs) {
          const key = `${first.item.id}:${second.item.id}:travel`;
          if (!seen.has(key)) {
            seen.add(key);
            conflictItemIds.add(first.item.id);
            conflictItemIds.add(second.item.id);
            const gapHours = Math.max(0, gap) / (60 * 60 * 1000);
            conflicts.push({
              id: key,
              itemIds: [first.item.id, second.item.id],
              severity: "warning",
              message: `${second.item.title} starts ${gapHours.toFixed(1)}h after ${first.item.title} in a different territory`,
            });
          }
        }
      }
    }
  }

  conflicts.sort((a, b) => {
    if (a.severity === b.severity) {
      return a.id.localeCompare(b.id);
    }
    if (a.severity === "error") return -1;
    if (b.severity === "error") return 1;
    return a.id.localeCompare(b.id);
  });

  return { conflicts, conflictItemIds };
}
