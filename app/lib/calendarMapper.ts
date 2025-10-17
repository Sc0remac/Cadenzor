import { calendar_v3 } from "googleapis";
import type {
  TimelineItemLabels,
  TimelineItemLinks,
  TimelineItemRecord,
  TimelineItemStatus,
  TimelineItemType,
  TimelinePriorityComponents,
} from "@kazador/shared";
import {
  getTimelineLaneForType,
  normaliseTimelineItemStatus,
  normaliseTimelineItemType,
} from "@kazador/shared";

interface MapOptions {
  projectId: string;
  projectSourceId: string;
  calendarSummary: string;
  calendarTimezone?: string | null;
}

export interface CalendarMappingResult {
  type: TimelineItemType;
  lane: string;
  status: TimelineItemStatus;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  labels: TimelineItemLabels;
  links: TimelineItemLinks;
  priorityScore: number | null;
  priorityComponents: TimelinePriorityComponents;
  metadata: Record<string, unknown>;
}

function stripHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  return text.length > 0 ? text : null;
}

function pickFirst<T>(values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value != null) return value as T;
  }
  return null;
}

function normaliseIso(dateTime: string | null | undefined): string | null {
  if (!dateTime) return null;
  const ms = Date.parse(dateTime);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function normaliseAllDay(date: string | null | undefined): string | null {
  if (!date) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function extractMeetingUrl(event: calendar_v3.Schema$Event): string | null {
  const entryPoint = event.conferenceData?.entryPoints?.find((point) => Boolean(point.uri));
  if (entryPoint?.uri) {
    return entryPoint.uri;
  }
  if (event.hangoutLink) {
    return event.hangoutLink;
  }
  const textSources = [event.description ?? "", event.location ?? ""];
  const regexes = [
    /(https?:\/\/[a-zA-Z0-9.-]+\.zoom\.us\/[a-zA-Z0-9/?=&_%-]+)/i,
    /(https?:\/\/meet\.google\.com\/[a-z0-9-]+)/i,
    /(https?:\/\/teams\.microsoft\.com\/[a-zA-Z0-9/?=&_%-]+)/i,
  ];
  for (const text of textSources) {
    for (const regex of regexes) {
      const match = text.match(regex);
      if (match?.[0]) {
        return match[0];
      }
    }
  }
  return null;
}

function detectLane(summary: string | undefined, description: string | null): string {
  const text = `${summary ?? ""} ${description ?? ""}`.toLowerCase();
  if (/\b(show|gig|performance|set|festival|hold)\b/.test(text)) {
    return "LIVE_HOLDS";
  }
  if (/\b(flight|train|travel|transit|airport|fly)\b/.test(text)) {
    return "TRAVEL";
  }
  if (/\b(interview|press|radio|podcast|mix|promo|appearance)\b/.test(text)) {
    return "PROMO";
  }
  if (/\b(rehearsal|soundcheck|tech)\b/.test(text)) {
    return "PROMO";
  }
  if (/\b(contract|legal|review|sign|agreement)\b/.test(text)) {
    return "LEGAL";
  }
  return "PROMO";
}

function detectType(summary: string | undefined, description: string | null): TimelineItemType {
  const lane = detectLane(summary, description);
  if (lane === "LIVE_HOLDS") return "LIVE_HOLD";
  if (lane === "TRAVEL") return "TRAVEL_SEGMENT";
  if (lane === "LEGAL") return "LEGAL_ACTION";
  return "PROMO_SLOT";
}

function parseLocation(value: string | null | undefined): { city?: string; territory?: string } {
  if (!value) return {};
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) {
    return { city: parts[0] };
  }
  return { city: parts[0], territory: parts[parts.length - 1] };
}

function derivePriority(startIso: string | null): { score: number | null; components: TimelinePriorityComponents } {
  if (!startIso) {
    return { score: null, components: { source: "calendar" } };
  }
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) {
    return { score: null, components: { source: "calendar" } };
  }
  const diffHours = (startMs - Date.now()) / (1000 * 60 * 60);
  let score: number;
  if (diffHours <= 0) {
    score = 65;
  } else if (diffHours < 4) {
    score = 95;
  } else if (diffHours < 24) {
    score = 85;
  } else if (diffHours < 72) {
    score = 75;
  } else {
    score = 60;
  }
  const components: TimelinePriorityComponents = {
    source: "calendar",
    hoursUntil: Number(diffHours.toFixed(2)),
  };
  return { score, components };
}

export function mapGoogleEventToTimelineItem(
  event: calendar_v3.Schema$Event,
  options: MapOptions
): CalendarMappingResult | null {
  if (!event || !event.id) {
    return null;
  }

  const description = stripHtml(event.description);
  const type = detectType(event.summary ?? "", description);
  const lane = detectLane(event.summary ?? "", description);
  const status = normaliseTimelineItemStatus(event.status ?? undefined);

  const startsAt =
    normaliseIso(event.start?.dateTime) ??
    normaliseAllDay(event.start?.date) ??
    normaliseIso(event.originalStartTime?.dateTime) ??
    normaliseAllDay(event.originalStartTime?.date);

  const endsAt =
    normaliseIso(event.end?.dateTime) ??
    normaliseAllDay(event.end?.date) ??
    (event.originalStartTime?.dateTime ? normaliseIso(event.originalStartTime.dateTime) : null);

  const timezone = pickFirst([
    event.start?.timeZone,
    event.end?.timeZone,
    event.originalStartTime?.timeZone,
    options.calendarTimezone,
    "UTC",
  ]);
  const meetingUrl = extractMeetingUrl(event);
  const location = parseLocation(event.location);

  const { score: priorityScore, components: priorityComponents } = derivePriority(startsAt);

  const organizerName = event.organizer?.displayName || event.organizer?.email || null;
  const labels: TimelineItemLabels = {
    lane,
    city: location.city ?? null,
    territory: location.territory ?? null,
    calendarTitle: options.calendarSummary,
    calendarSourceId: options.projectSourceId,
  };

  if (meetingUrl) {
    labels.meetingUrl = meetingUrl;
  }
  if (organizerName) {
    labels.organizer = organizerName;
  }
  if (Array.isArray(event.attendees) && event.attendees.length > 0) {
    labels.attendeeCount = event.attendees.length;
  }

  const links: TimelineItemLinks = {
    calendarId: event.id,
    calendarSourceId: options.projectSourceId,
  };

  if (meetingUrl) {
    links.meetingUrl = meetingUrl;
  }

  const metadata: Record<string, unknown> = {
    location: event.location ?? null,
    organizer: event.organizer ?? null,
    attendees: event.attendees ?? null,
    hangoutLink: event.hangoutLink ?? null,
  };

  return {
    type: normaliseTimelineItemType(type),
    lane,
    status,
    title: event.summary || "Untitled event",
    description,
    startsAt,
    endsAt,
    timezone,
    labels,
    links,
    priorityScore,
    priorityComponents,
    metadata,
  };
}

export function mapCalendarItemToTimelineRecord(
  projectId: string,
  mapping: CalendarMappingResult,
  overrides: Partial<TimelineItemRecord> = {}
): TimelineItemRecord {
  return {
    id: overrides.id ?? "",
    projectId,
    type: mapping.type,
    lane: mapping.lane,
    kind: "calendar_event",
    title: mapping.title,
    description: mapping.description,
    startsAt: mapping.startsAt,
    endsAt: mapping.endsAt,
    dueAt: null,
    timezone: mapping.timezone,
    status: mapping.status,
    priorityScore: mapping.priorityScore,
    priorityComponents: mapping.priorityComponents,
    labels: mapping.labels,
    links: mapping.links,
    createdBy: overrides.createdBy ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    conflictFlags: overrides.conflictFlags ?? null,
    layoutRow: overrides.layoutRow ?? null,
    territory: mapping.labels.territory ?? null,
  };
}
