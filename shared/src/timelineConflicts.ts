import type { TimelineItemRecord } from "./types";

export type TimelineConflictSeverity = "warning" | "error";
export type ConflictType = "lane_overlap" | "same_territory_buffer" | "travel_time" | "timezone_jump";

export interface TimelineConflict {
  id: string;
  items: [TimelineItemRecord, TimelineItemRecord];
  severity: TimelineConflictSeverity;
  message: string;
  type?: ConflictType;
  metadata?: {
    requiredBufferHours?: number;
    availableBufferHours?: number;
    travelTimeHours?: number;
    fromCity?: string;
    toCity?: string;
    fromTerritory?: string;
    toTerritory?: string;
  };
}

export interface TimelineConflictOptions {
  bufferHours?: number;
  enableTravelTimeDetection?: boolean;
  enableTimezoneWarnings?: boolean;
}

/**
 * Travel time estimates in hours between different regions/territories.
 * Used to detect insufficient travel buffers between consecutive events.
 */
interface TravelTimeEstimate {
  hours: number;
  description: string;
}

const TRAVEL_TIME_LOOKUP: Record<string, TravelTimeEstimate> = {
  // Same city - minimal travel time
  "SAME_CITY": { hours: 1, description: "Same city" },

  // Within same region
  "EU_TO_EU": { hours: 4, description: "Within Europe" },
  "US_TO_US": { hours: 6, description: "Within USA" },
  "ASIA_TO_ASIA": { hours: 5, description: "Within Asia" },
  "UK_TO_UK": { hours: 3, description: "Within UK" },

  // Cross-continental
  "EU_TO_US": { hours: 12, description: "Europe to USA" },
  "US_TO_EU": { hours: 12, description: "USA to Europe" },
  "EU_TO_ASIA": { hours: 14, description: "Europe to Asia" },
  "ASIA_TO_EU": { hours: 14, description: "Asia to Europe" },
  "US_TO_ASIA": { hours: 16, description: "USA to Asia" },
  "ASIA_TO_US": { hours: 16, description: "Asia to USA" },

  // Default for unknown routes
  "UNKNOWN": { hours: 8, description: "Unknown route" },
};

const REGION_MAP: Record<string, string> = {
  // Europe
  "GB": "EU", "DE": "EU", "FR": "EU", "ES": "EU", "IT": "EU", "NL": "EU",
  "BE": "EU", "AT": "EU", "CH": "EU", "SE": "EU", "NO": "EU", "DK": "EU",
  "FI": "EU", "PL": "EU", "CZ": "EU", "PT": "EU", "IE": "EU", "GR": "EU",

  // Americas
  "US": "US", "CA": "US", "MX": "US",

  // Asia
  "JP": "ASIA", "CN": "ASIA", "KR": "ASIA", "SG": "ASIA", "TH": "ASIA",
  "IN": "ASIA", "HK": "ASIA", "TW": "ASIA", "MY": "ASIA", "ID": "ASIA",

  // Oceania
  "AU": "ASIA", "NZ": "ASIA",
};

/**
 * Estimate travel time in hours between two locations.
 */
function estimateTravelTime(
  fromCity: string | null | undefined,
  toCity: string | null | undefined,
  fromTerritory: string | null | undefined,
  toTerritory: string | null | undefined
): TravelTimeEstimate {
  // Same city - minimal travel
  if (fromCity && toCity && fromCity.toLowerCase() === toCity.toLowerCase()) {
    return TRAVEL_TIME_LOOKUP["SAME_CITY"];
  }

  // Different cities but need territory to estimate
  if (!fromTerritory || !toTerritory) {
    return TRAVEL_TIME_LOOKUP["UNKNOWN"];
  }

  const fromTerritoryUpper = fromTerritory.toUpperCase();
  const toTerritoryUpper = toTerritory.toUpperCase();

  // Same territory
  if (fromTerritoryUpper === toTerritoryUpper) {
    return TRAVEL_TIME_LOOKUP["SAME_CITY"];
  }

  // Map to regions
  const fromRegion = REGION_MAP[fromTerritoryUpper];
  const toRegion = REGION_MAP[toTerritoryUpper];

  if (!fromRegion || !toRegion) {
    return TRAVEL_TIME_LOOKUP["UNKNOWN"];
  }

  // Same region
  if (fromRegion === toRegion) {
    const key = `${fromRegion}_TO_${toRegion}`;
    return TRAVEL_TIME_LOOKUP[key] || TRAVEL_TIME_LOOKUP["UNKNOWN"];
  }

  // Cross-region
  const routeKey = `${fromRegion}_TO_${toRegion}`;
  return TRAVEL_TIME_LOOKUP[routeKey] || TRAVEL_TIME_LOOKUP["UNKNOWN"];
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
  const enableTravelTime = options.enableTravelTimeDetection !== false;
  const enableTimezoneWarnings = options.enableTimezoneWarnings !== false;

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

      // 1. Lane overlap detection
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
            type: "lane_overlap",
          });
        }
      }

      // 2. Same territory buffer detection
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
              type: "same_territory_buffer",
            });
          }
        }
      }

      // 3. Travel time detection (enhanced)
      if (enableTravelTime) {
        const chronological = a.start <= b.start
          ? { first: a, second: b }
          : { first: b, second: a };

        const fromCity = chronological.first.item.labels?.city;
        const toCity = chronological.second.item.labels?.city;
        const fromTerritory = chronological.first.item.labels?.territory || chronological.first.item.territory;
        const toTerritory = chronological.second.item.labels?.territory || chronological.second.item.territory;

        // Check if there's a location change
        const cityChange = fromCity && toCity && fromCity.toLowerCase() !== toCity.toLowerCase();
        const territoryChange = fromTerritory && toTerritory && fromTerritory !== toTerritory;

        if (cityChange || territoryChange) {
          // Calculate actual gap between events
          const travelGapMs = chronological.second.start - chronological.first.end;
          const travelGapHours = travelGapMs / (60 * 60 * 1000);

          // Estimate required travel time
          const travelEstimate = estimateTravelTime(fromCity, toCity, fromTerritory, toTerritory);
          const requiredBufferMs = travelEstimate.hours * 60 * 60 * 1000;

          // Flag if insufficient travel time
          if (travelGapMs < requiredBufferMs) {
            const key = `${chronological.first.item.id}:${chronological.second.item.id}:travel`;
            if (!seen.has(key)) {
              seen.add(key);
              const availableHours = Math.max(0, Math.floor(travelGapHours * 10) / 10);
              conflicts.push({
                id: key,
                items: [chronological.first.item, chronological.second.item],
                severity: "error",
                message: `⚠️ Insufficient travel time from ${fromCity || fromTerritory || "unknown"} to ${toCity || toTerritory || "unknown"} (${travelEstimate.hours}hr required, only ${availableHours}hr available)`,
                type: "travel_time",
                metadata: {
                  requiredBufferHours: travelEstimate.hours,
                  availableBufferHours: availableHours,
                  travelTimeHours: travelEstimate.hours,
                  fromCity: fromCity || undefined,
                  toCity: toCity || undefined,
                  fromTerritory: fromTerritory || undefined,
                  toTerritory: toTerritory || undefined,
                },
              });
            }
          }
        }
      }

      // 4. Timezone jump warnings (optional)
      if (enableTimezoneWarnings) {
        const chronological = a.start <= b.start
          ? { first: a, second: b }
          : { first: b, second: a };

        const fromTz = chronological.first.item.timezone;
        const toTz = chronological.second.item.timezone;

        if (fromTz && toTz && fromTz !== toTz) {
          // Calculate timezone offset difference (simplified)
          const travelGapMs = chronological.second.start - chronological.first.end;
          const travelGapHours = travelGapMs / (60 * 60 * 1000);

          // Only warn if the gap is less than 6 hours (likely insufficient for timezone adjustment)
          if (travelGapHours < 6) {
            const key = `${chronological.first.item.id}:${chronological.second.item.id}:timezone`;
            if (!seen.has(key)) {
              seen.add(key);
              conflicts.push({
                id: key,
                items: [chronological.first.item, chronological.second.item],
                severity: "warning",
                message: `Timezone change from ${fromTz} to ${toTz} with only ${Math.floor(travelGapHours)}hr gap - verify timing`,
                type: "timezone_jump",
              });
            }
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

/**
 * Time slot suggestion for scheduling assistant.
 */
export interface TimeSlot {
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  durationHours: number;
  confidence: "high" | "medium" | "low";
  notes?: string;
  warnings?: string[];
}

export interface FindSlotsOptions {
  dateRange: [string, string]; // [start, end] ISO 8601
  durationHours: number;
  city?: string;
  territory?: string;
  constraints?: ("not_overlapping_travel" | "avoid_timezone_jumps" | "prefer_business_hours")[];
  maxResults?: number;
}

/**
 * Find available time slots in a timeline, considering travel buffers and constraints.
 * Used by the Smart Scheduling Assistant API.
 */
export function findAvailableSlots(
  items: TimelineItemRecord[],
  options: FindSlotsOptions
): TimeSlot[] {
  const {
    dateRange,
    durationHours,
    city,
    territory,
    constraints = [],
    maxResults = 5,
  } = options;

  const rangeStart = Date.parse(dateRange[0]);
  const rangeEnd = Date.parse(dateRange[1]);

  if (Number.isNaN(rangeStart) || Number.isNaN(rangeEnd) || rangeStart >= rangeEnd) {
    return [];
  }

  const durationMs = durationHours * 60 * 60 * 1000;
  const considerTravel = constraints.includes("not_overlapping_travel");
  const preferBusinessHours = constraints.includes("prefer_business_hours");

  // Build occupied time blocks (including travel buffers)
  const occupiedBlocks: Array<{ start: number; end: number; item: TimelineItemRecord }> = [];

  for (const item of items) {
    const start = toTimestamp(item.startsAt);
    if (!start) continue;
    const endTimestamp = toTimestamp(item.endsAt);
    const end = endTimestamp && endTimestamp > start ? endTimestamp : start;

    // Add the event itself
    occupiedBlocks.push({ start, end, item });

    // Add travel buffer after this event if needed
    if (considerTravel) {
      const itemCity = item.labels?.city;
      const itemTerritory = item.labels?.territory || item.territory;

      // If requesting slot in different city/territory, add travel buffer
      if ((city && itemCity && city.toLowerCase() !== itemCity.toLowerCase()) ||
          (territory && itemTerritory && territory !== itemTerritory)) {
        const travelEstimate = estimateTravelTime(itemCity, city, itemTerritory, territory);
        const travelBufferMs = travelEstimate.hours * 60 * 60 * 1000;
        occupiedBlocks.push({
          start: end,
          end: end + travelBufferMs,
          item,
        });
      }
    }
  }

  // Sort by start time
  occupiedBlocks.sort((a, b) => a.start - b.start);

  // Find gaps between occupied blocks
  const gaps: Array<{ start: number; end: number }> = [];

  // Gap before first event
  if (occupiedBlocks.length === 0 || occupiedBlocks[0].start > rangeStart + durationMs) {
    const gapEnd = occupiedBlocks.length > 0 ? occupiedBlocks[0].start : rangeEnd;
    gaps.push({
      start: rangeStart,
      end: Math.min(gapEnd, rangeEnd),
    });
  }

  // Gaps between events
  for (let i = 0; i < occupiedBlocks.length - 1; i++) {
    const currentEnd = occupiedBlocks[i].end;
    const nextStart = occupiedBlocks[i + 1].start;

    if (nextStart > currentEnd + durationMs) {
      gaps.push({
        start: Math.max(currentEnd, rangeStart),
        end: Math.min(nextStart, rangeEnd),
      });
    }
  }

  // Gap after last event
  if (occupiedBlocks.length > 0) {
    const lastEnd = occupiedBlocks[occupiedBlocks.length - 1].end;
    if (lastEnd + durationMs < rangeEnd) {
      gaps.push({
        start: Math.max(lastEnd, rangeStart),
        end: rangeEnd,
      });
    }
  }

  // Convert gaps to time slots
  const slots: TimeSlot[] = [];

  for (const gap of gaps) {
    const gapDuration = gap.end - gap.start;

    // Can we fit the requested duration?
    if (gapDuration < durationMs) continue;

    // Generate slot at start of gap
    const slotStart = gap.start;
    const slotEnd = slotStart + durationMs;

    // Check if in business hours (9am-6pm local time) if preferred
    let confidence: "high" | "medium" | "low" = "high";
    const warnings: string[] = [];

    if (preferBusinessHours) {
      const startDate = new Date(slotStart);
      const hour = startDate.getUTCHours(); // Simplified - should use timezone
      if (hour < 9 || hour > 18) {
        confidence = "medium";
        warnings.push("Outside typical business hours (9am-6pm)");
      }
    }

    // Check for weekend
    const startDate = new Date(slotStart);
    const dayOfWeek = startDate.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      if (confidence === "high") confidence = "medium";
      warnings.push("Falls on weekend");
    }

    slots.push({
      startTime: new Date(slotStart).toISOString(),
      endTime: new Date(slotEnd).toISOString(),
      durationHours,
      confidence,
      notes: `${Math.floor(gapDuration / (60 * 60 * 1000))}hr gap available`,
      warnings: warnings.length > 0 ? warnings : undefined,
    });

    // Also suggest mid-gap if gap is large enough
    if (gapDuration >= durationMs * 3) {
      const midSlotStart = gap.start + (gapDuration - durationMs) / 2;
      const midSlotEnd = midSlotStart + durationMs;

      slots.push({
        startTime: new Date(midSlotStart).toISOString(),
        endTime: new Date(midSlotEnd).toISOString(),
        durationHours,
        confidence: "high",
        notes: "Centered in available gap",
      });
    }

    if (slots.length >= maxResults) break;
  }

  // Sort by confidence and time
  slots.sort((a, b) => {
    const confScore = { high: 3, medium: 2, low: 1 };
    const aScore = confScore[a.confidence];
    const bScore = confScore[b.confidence];
    if (aScore !== bScore) return bScore - aScore;
    return Date.parse(a.startTime) - Date.parse(b.startTime);
  });

  return slots.slice(0, maxResults);
}
