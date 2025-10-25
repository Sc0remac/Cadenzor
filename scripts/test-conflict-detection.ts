#!/usr/bin/env tsx
import { detectTimelineConflicts, buildConflictIndex } from '../shared/src/timelineConflicts';

// Simulate the items from the database (with NEW TIGHTER TIMINGS)
const items = [
  {
    id: '1',
    projectId: 'test',
    type: 'LIVE_HOLD' as const,
    lane: 'LIVE_HOLDS' as const,
    kind: null,
    title: 'Berlin - Berghain',
    description: null,
    startsAt: '2025-11-25T22:00:00Z',
    endsAt: '2025-11-26T03:00:00Z',
    dueAt: null,
    timezone: null,
    status: 'confirmed' as const,
    priorityScore: 95,
    priorityComponents: null,
    labels: {
      city: 'Berlin',
      venue: 'Berghain',
      territory: 'DE',
      timezone: 'Europe/Berlin',
    },
    links: {},
    createdBy: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    territory: 'DE',
  },
  {
    id: '2',
    projectId: 'test',
    type: 'LIVE_HOLD' as const,
    lane: 'LIVE_HOLDS' as const,
    kind: null,
    title: 'Amsterdam - Paradiso',
    description: null,
    startsAt: '2025-11-26T05:00:00Z',  // CHANGED: 2hr gap from Berlin
    endsAt: '2025-11-26T07:30:00Z',
    dueAt: null,
    timezone: null,
    status: 'tentative' as const,
    priorityScore: 90,
    priorityComponents: null,
    labels: {
      city: 'Amsterdam',
      venue: 'Paradiso',
      territory: 'NL',
      timezone: 'Europe/Amsterdam',
    },
    links: {},
    createdBy: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    territory: 'NL',
  },
  {
    id: '3',
    projectId: 'test',
    type: 'PROMO_SLOT' as const,
    lane: 'PROMO' as const,
    kind: null,
    title: 'BBC Radio 1 - Essential Mix',
    description: null,
    startsAt: '2025-11-26T09:00:00Z',  // CHANGED: 1.5hr gap from Amsterdam
    endsAt: '2025-11-26T13:00:00Z',
    dueAt: null,
    timezone: null,
    status: 'confirmed' as const,
    priorityScore: 98,
    priorityComponents: null,
    labels: {
      city: 'London',
      territory: 'GB',
      timezone: 'Europe/London',
    },
    links: {},
    createdBy: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    territory: 'GB',
  },
  {
    id: '4',
    projectId: 'test',
    type: 'PROMO_SLOT' as const,
    lane: 'PROMO' as const,
    kind: null,
    title: 'Paris - Boiler Room',
    description: null,
    startsAt: '2025-11-26T15:00:00Z',  // NEW: 2hr gap from London
    endsAt: '2025-11-26T17:00:00Z',
    dueAt: null,
    timezone: null,
    status: 'confirmed' as const,
    priorityScore: 95,
    priorityComponents: null,
    labels: {
      city: 'Paris',
      territory: 'FR',
      timezone: 'Europe/Paris',
    },
    links: {},
    createdBy: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    territory: 'FR',
  },
  {
    id: '5',
    projectId: 'test',
    type: 'LIVE_HOLD' as const,
    lane: 'LIVE_HOLDS' as const,
    kind: null,
    title: 'Tokyo - Womb',
    description: null,
    startsAt: '2025-11-27T05:00:00Z',  // NEW: 12hr gap from Paris (16hr required)
    endsAt: '2025-11-27T09:00:00Z',
    dueAt: null,
    timezone: null,
    status: 'tentative' as const,
    priorityScore: 92,
    priorityComponents: null,
    labels: {
      city: 'Tokyo',
      venue: 'Womb',
      territory: 'JP',
      timezone: 'Asia/Tokyo',
    },
    links: {},
    createdBy: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    territory: 'JP',
  },
];

console.log('🔍 Testing conflict detection...\n');

const conflicts = detectTimelineConflicts(items, {
  bufferHours: 4,
  enableTravelTimeDetection: true,
  enableTimezoneWarnings: true,
});

console.log(`Found ${conflicts.length} conflicts:\n`);

conflicts.forEach((conflict, idx) => {
  console.log(`${idx + 1}. Type: ${conflict.type}`);
  console.log(`   Severity: ${conflict.severity}`);
  console.log(`   Message: ${conflict.message}`);
  console.log(`   Items: ${conflict.items[0].title} ↔ ${conflict.items[1].title}`);
  if (conflict.metadata) {
    console.log(`   Metadata:`, JSON.stringify(conflict.metadata, null, 4));
  }
  console.log('');
});

const conflictIndex = buildConflictIndex(conflicts);
console.log('Conflict index:');
conflictIndex.forEach((conflicts, itemId) => {
  const item = items.find(i => i.id === itemId);
  console.log(`  ${item?.title}: ${conflicts.length} conflict(s)`);
  conflicts.forEach(c => {
    console.log(`    - ${c.type}: ${c.message}`);
  });
});
