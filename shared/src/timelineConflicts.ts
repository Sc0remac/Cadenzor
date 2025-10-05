import type { TimelineItemRecord } from "./types";

export type TimelineConflictSeverity = "warning" | "error";

export interface TimelineConflict {
  id: string;
  items: [TimelineItemRecord, TimelineItemRecord];
  severity: TimelineConflictSeverity;
  message: string;
}

export interface TimelineConflictOptions {
  bufferHours?: number;
}

function toTimestamp(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function detectTimelineConflicts(
  items: TimelineItemRecord[],
  options: TimelineConflictOptions = {}
): TimelineConflict[] {
  const bufferHours = options.bufferHours ?? 4;
  const bufferMs = Math.max(bufferHours, 0) * 60 * 60 * 1000;

  const scheduled = items
    .map((item) => {
      const start = toTimestamp(item.startsAt);
      if (!start) return null;
      const endTimestamp = toTimestamp(item.endsAt);
      const end = endTimestamp && endTimestamp > start ? endTimestamp : start;
      return { item, start, end } satisfies {
        item: TimelineItemRecord;
        start: number;
        end: number;
      };
    })
    .filter((value): value is { item: TimelineItemRecord; start: number; end: number } => Boolean(value))
    .sort((a, b) => a.start - b.start);

  if (scheduled.length === 0) {
    return [];
  }

  const conflicts: TimelineConflict[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < scheduled.length; i += 1) {
    for (let j = i + 1; j < scheduled.length; j += 1) {
      const a = scheduled[i];
      const b = scheduled[j];
      if (a.item.id === b.item.id) continue;

      const sameLane = a.item.lane && b.item.lane && a.item.lane === b.item.lane;
      const overlap = a.end > b.start && b.end > a.start;
      if (sameLane && overlap) {
        const key = `${a.item.id}:${b.item.id}:lane`;
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push({
            id: key,
            items: [a.item, b.item],
            severity: "warning",
            message: `${a.item.title} overlaps with ${b.item.title} in the ${a.item.lane} lane`,
          });
        }
      }

      const sameTerritory = a.item.territory && b.item.territory && a.item.territory === b.item.territory;
      if (sameTerritory) {
        const delta = Math.abs(a.start - b.start);
        if (delta < bufferMs) {
          const key = `${a.item.id}:${b.item.id}:territory`;
          if (!seen.has(key)) {
            seen.add(key);
            conflicts.push({
              id: key,
              items: [a.item, b.item],
              severity: "error",
              message: `${a.item.title} and ${b.item.title} are both in ${a.item.territory} without the ${bufferHours}h buffer`,
            });
          }
        }
      }

      const chronological = a.start <= b.start
        ? { first: a, second: b }
        : { first: b, second: a };

      const territoryChange =
        chronological.first.item.territory &&
        chronological.second.item.territory &&
        chronological.first.item.territory !== chronological.second.item.territory;

      if (territoryChange) {
        const travelGap = chronological.second.start - chronological.first.end;
        if (travelGap < bufferMs) {
          const hoursGap = Math.max(0, Math.round(travelGap / (60 * 60 * 1000)));
          const key = `${chronological.first.item.id}:${chronological.second.item.id}:travel`;
          if (!seen.has(key)) {
            seen.add(key);
            conflicts.push({
              id: key,
              items: [chronological.first.item, chronological.second.item],
              severity: "warning",
              message: `${chronological.second.item.title} starts ${hoursGap}h after ${chronological.first.item.title} in a different territory`,
            });
          }
        }
      }
    }
  }

  return conflicts;
}

export function buildConflictIndex(conflicts: TimelineConflict[]): Map<string, TimelineConflict[]> {
  const index = new Map<string, TimelineConflict[]>();
  for (const conflict of conflicts) {
    for (const item of conflict.items) {
      const list = index.get(item.id) ?? [];
      list.push(conflict);
      index.set(item.id, list);
    }
  }
  return index;
}
