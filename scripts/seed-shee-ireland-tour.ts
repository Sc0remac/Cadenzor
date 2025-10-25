#!/usr/bin/env tsx
/**
 * Seed script for "SHEE Ireland Tour" project
 *
 * This script creates a comprehensive example project with timeline items
 * across all lanes (Live, Promo, Travel, Release, Legal, Finance)
 *
 * Run with: npx tsx scripts/seed-shee-ireland-tour.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables from app/.env.local
dotenv.config({ path: resolve(__dirname, '../app/.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface TimelineItem {
  type: 'LIVE_HOLD' | 'TRAVEL_SEGMENT' | 'PROMO_SLOT' | 'RELEASE_MILESTONE' | 'LEGAL_ACTION' | 'FINANCE_ACTION';
  title: string;
  description?: string;
  start_at: string;
  end_at: string;
  status: 'planned' | 'tentative' | 'confirmed' | 'waiting' | 'done' | 'canceled';
  priority_score: number;
  labels?: Record<string, any>;
}

async function main() {
  console.log('🎸 Seeding SHEE Ireland Tour project...\n');

  // 1. Get the first user (or specify a user ID)
  const { data: users, error: userError } = await supabase.auth.admin.listUsers();

  if (userError || !users || users.users.length === 0) {
    console.error('❌ No users found. Please create a user first.');
    process.exit(1);
  }

  const userId = users.users[0].id;
  console.log(`✓ Found user: ${users.users[0].email} (${userId})`);

  // 2. Check if project already exists
  const { data: existingProject } = await supabase
    .from('projects')
    .select('id')
    .eq('name', 'SHEE Ireland Tour')
    .maybeSingle();

  let projectId: string;

  if (existingProject) {
    console.log(`✓ Project already exists: ${existingProject.id}`);
    projectId = existingProject.id;

    // Delete existing project items
    const { error: deleteError } = await supabase
      .from('project_items')
      .delete()
      .eq('project_id', projectId);

    if (deleteError) {
      console.error('❌ Error deleting existing items:', deleteError.message);
    } else {
      console.log('✓ Cleared existing timeline items');
    }
  } else {
    // 3. Create the project
    const projectStartDate = new Date('2025-11-01');
    const projectEndDate = new Date('2025-11-30');

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        name: 'SHEE Ireland Tour',
        slug: 'shee-ireland-tour',
        description: 'Barry Can\'t Swim - SHEE album release tour across Ireland',
        status: 'active',
        start_date: projectStartDate.toISOString(),
        end_date: projectEndDate.toISOString(),
        created_by: userId,
        labels: {
          artist: 'Barry Can\'t Swim',
          territory: 'IE',
          album: 'SHEE',
        },
      })
      .select()
      .single();

    if (projectError || !project) {
      console.error('❌ Error creating project:', projectError?.message);
      process.exit(1);
    }

    projectId = project.id;
    console.log(`✓ Created project: ${project.name} (${projectId})`);

    // 4. Add user as project member (check if not already exists)
    const { data: existingMember } = await supabase
      .from('project_members')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!existingMember) {
      const { error: memberError } = await supabase
        .from('project_members')
        .insert({
          project_id: projectId,
          user_id: userId,
          role: 'owner',
        });

      if (memberError) {
        console.error('❌ Error adding project member:', memberError.message);
        process.exit(1);
      }

      console.log('✓ Added user as project owner');
    } else {
      console.log('✓ User is already a project member');
    }
  }

  // 5. Define comprehensive timeline items
  const timelineItems: TimelineItem[] = [
    // LIVE SHOWS
    {
      type: 'LIVE_HOLD',
      title: 'Dublin - Button Factory',
      description: 'Main show in Dublin, 500 capacity venue',
      start_at: new Date('2025-11-08T21:00:00Z').toISOString(),
      end_at: new Date('2025-11-09T00:30:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 95,
      labels: {
        city: 'Dublin',
        venue: 'Button Factory',
        territory: 'IE',
        capacity: 500,
        fee: '€5,000',
      },
    },
    {
      type: 'LIVE_HOLD',
      title: 'Cork - Cyprus Avenue',
      description: 'Cork headline show',
      start_at: new Date('2025-11-10T21:00:00Z').toISOString(),
      end_at: new Date('2025-11-11T00:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 90,
      labels: {
        city: 'Cork',
        venue: 'Cyprus Avenue',
        territory: 'IE',
        capacity: 300,
        fee: '€3,500',
      },
    },
    {
      type: 'LIVE_HOLD',
      title: 'Galway - Róisín Dubh',
      description: 'Galway show',
      start_at: new Date('2025-11-15T21:00:00Z').toISOString(),
      end_at: new Date('2025-11-16T00:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 85,
      labels: {
        city: 'Galway',
        venue: 'Róisín Dubh',
        territory: 'IE',
        capacity: 250,
        fee: '€3,000',
      },
    },
    {
      type: 'LIVE_HOLD',
      title: 'Belfast - Limelight',
      description: 'Belfast headline show',
      start_at: new Date('2025-11-20T21:00:00Z').toISOString(),
      end_at: new Date('2025-11-21T00:00:00Z').toISOString(),
      status: 'tentative',
      priority_score: 80,
      labels: {
        city: 'Belfast',
        venue: 'Limelight',
        territory: 'IE',
        capacity: 400,
        fee: '€4,000',
      },
    },
    {
      type: 'LIVE_HOLD',
      title: 'Limerick - Dolans Warehouse',
      description: 'Limerick show',
      start_at: new Date('2025-11-22T21:00:00Z').toISOString(),
      end_at: new Date('2025-11-23T00:00:00Z').toISOString(),
      status: 'tentative',
      priority_score: 75,
      labels: {
        city: 'Limerick',
        venue: 'Dolans Warehouse',
        territory: 'IE',
        capacity: 200,
        fee: '€2,500',
      },
    },

    // TRAVEL SEGMENTS
    {
      type: 'TRAVEL_SEGMENT',
      title: 'London → Dublin',
      description: 'Flight to Dublin for tour start',
      start_at: new Date('2025-11-08T08:00:00Z').toISOString(),
      end_at: new Date('2025-11-08T15:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 90,
      labels: {
        from: 'London',
        to: 'Dublin',
        transport: 'Flight',
        booking_ref: 'EI123',
      },
    },
    {
      type: 'TRAVEL_SEGMENT',
      title: 'Dublin → Cork',
      description: 'Drive to Cork',
      start_at: new Date('2025-11-10T10:00:00Z').toISOString(),
      end_at: new Date('2025-11-10T13:30:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 85,
      labels: {
        from: 'Dublin',
        to: 'Cork',
        transport: 'Van',
        distance: '260km',
      },
    },
    {
      type: 'TRAVEL_SEGMENT',
      title: 'Cork → Galway',
      description: 'Drive to Galway via Limerick',
      start_at: new Date('2025-11-14T11:00:00Z').toISOString(),
      end_at: new Date('2025-11-14T14:30:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 80,
      labels: {
        from: 'Cork',
        to: 'Galway',
        transport: 'Van',
        distance: '210km',
      },
    },
    {
      type: 'TRAVEL_SEGMENT',
      title: 'Galway → Belfast',
      description: 'Drive to Belfast',
      start_at: new Date('2025-11-19T09:00:00Z').toISOString(),
      end_at: new Date('2025-11-19T13:00:00Z').toISOString(),
      status: 'planned',
      priority_score: 75,
      labels: {
        from: 'Galway',
        to: 'Belfast',
        transport: 'Van',
        distance: '240km',
      },
    },

    // PROMO SLOTS
    {
      type: 'PROMO_SLOT',
      title: 'RTÉ 2FM Interview',
      description: 'Radio interview with Dan Hegarty',
      start_at: new Date('2025-11-07T14:00:00Z').toISOString(),
      end_at: new Date('2025-11-07T15:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 88,
      labels: {
        city: 'Dublin',
        type: 'Radio Interview',
        station: 'RTÉ 2FM',
        contact: 'Dan Hegarty',
      },
    },
    {
      type: 'PROMO_SLOT',
      title: 'Hot Press Magazine Feature',
      description: 'Cover story interview and photoshoot',
      start_at: new Date('2025-11-05T11:00:00Z').toISOString(),
      end_at: new Date('2025-11-05T17:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 92,
      labels: {
        city: 'Dublin',
        type: 'Print Interview',
        publication: 'Hot Press',
      },
    },
    {
      type: 'PROMO_SLOT',
      title: 'Cork 96FM Interview',
      description: 'Local radio promo for Cork show',
      start_at: new Date('2025-11-10T10:00:00Z').toISOString(),
      end_at: new Date('2025-11-10T10:30:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 70,
      labels: {
        city: 'Cork',
        type: 'Radio Interview',
        station: 'Cork 96FM',
      },
    },
    {
      type: 'PROMO_SLOT',
      title: 'BBC Radio Ulster - Across The Line',
      description: 'Live session and interview',
      start_at: new Date('2025-11-20T19:00:00Z').toISOString(),
      end_at: new Date('2025-11-20T20:30:00Z').toISOString(),
      status: 'tentative',
      priority_score: 85,
      labels: {
        city: 'Belfast',
        type: 'Radio Session',
        station: 'BBC Radio Ulster',
      },
    },
    {
      type: 'PROMO_SLOT',
      title: 'Record Store Meet & Greet',
      description: 'Tower Records Dublin - album signing',
      start_at: new Date('2025-11-07T17:00:00Z').toISOString(),
      end_at: new Date('2025-11-07T19:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 75,
      labels: {
        city: 'Dublin',
        type: 'Meet & Greet',
        venue: 'Tower Records',
      },
    },

    // RELEASE MILESTONES
    {
      type: 'RELEASE_MILESTONE',
      title: 'SHEE Album Digital Release',
      description: 'Official digital release on all platforms',
      start_at: new Date('2025-11-01T00:00:00Z').toISOString(),
      end_at: new Date('2025-11-01T00:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 100,
      labels: {
        album: 'SHEE',
        platform: 'All DSPs',
        type: 'Album Release',
      },
    },
    {
      type: 'RELEASE_MILESTONE',
      title: 'SHEE Vinyl Release',
      description: 'Limited edition vinyl available in stores',
      start_at: new Date('2025-11-01T09:00:00Z').toISOString(),
      end_at: new Date('2025-11-01T09:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 95,
      labels: {
        album: 'SHEE',
        format: 'Vinyl',
        quantity: '1000 copies',
        type: 'Physical Release',
      },
    },
    {
      type: 'RELEASE_MILESTONE',
      title: 'Lead Single Promo Send-Out',
      description: 'Send lead single to radio and press',
      start_at: new Date('2025-10-15T00:00:00Z').toISOString(),
      end_at: new Date('2025-10-15T00:00:00Z').toISOString(),
      status: 'done',
      priority_score: 85,
      labels: {
        track: 'Lead Single',
        recipients: '250+ contacts',
        type: 'Promo Send-Out',
      },
    },
    {
      type: 'RELEASE_MILESTONE',
      title: 'Music Video Premiere',
      description: 'YouTube premiere for album title track',
      start_at: new Date('2025-11-04T18:00:00Z').toISOString(),
      end_at: new Date('2025-11-04T18:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 88,
      labels: {
        track: 'SHEE',
        platform: 'YouTube',
        type: 'Video Release',
      },
    },

    // LEGAL ACTIONS
    {
      type: 'LEGAL_ACTION',
      title: 'Button Factory Contract',
      description: 'Review and sign venue contract for Dublin show',
      start_at: new Date('2025-10-20T00:00:00Z').toISOString(),
      end_at: new Date('2025-10-27T00:00:00Z').toISOString(),
      status: 'done',
      priority_score: 90,
      labels: {
        venue: 'Button Factory',
        city: 'Dublin',
        type: 'Venue Contract',
        deal_value: '€5,000',
      },
    },
    {
      type: 'LEGAL_ACTION',
      title: 'Cork Show Contract',
      description: 'Finalize Cyprus Avenue agreement',
      start_at: new Date('2025-10-22T00:00:00Z').toISOString(),
      end_at: new Date('2025-10-29T00:00:00Z').toISOString(),
      status: 'done',
      priority_score: 85,
      labels: {
        venue: 'Cyprus Avenue',
        city: 'Cork',
        type: 'Venue Contract',
        deal_value: '€3,500',
      },
    },
    {
      type: 'LEGAL_ACTION',
      title: 'Tour Insurance',
      description: 'Secure comprehensive tour insurance',
      start_at: new Date('2025-10-25T00:00:00Z').toISOString(),
      end_at: new Date('2025-11-01T00:00:00Z').toISOString(),
      status: 'waiting',
      priority_score: 92,
      labels: {
        type: 'Insurance',
        coverage: 'Tour + Equipment',
        provider: 'TBD',
      },
    },
    {
      type: 'LEGAL_ACTION',
      title: 'Work Permits (if needed)',
      description: 'Confirm crew work permits for Northern Ireland',
      start_at: new Date('2025-10-28T00:00:00Z').toISOString(),
      end_at: new Date('2025-11-05T00:00:00Z').toISOString(),
      status: 'planned',
      priority_score: 75,
      labels: {
        type: 'Work Permits',
        territory: 'Northern Ireland',
      },
    },

    // FINANCE ACTIONS
    {
      type: 'FINANCE_ACTION',
      title: 'Button Factory - Deposit Invoice',
      description: 'Process 50% deposit payment',
      start_at: new Date('2025-10-28T00:00:00Z').toISOString(),
      end_at: new Date('2025-11-04T00:00:00Z').toISOString(),
      status: 'waiting',
      priority_score: 88,
      labels: {
        venue: 'Button Factory',
        amount: '€2,500',
        type: 'Deposit',
        payment_terms: '50% upfront',
      },
    },
    {
      type: 'FINANCE_ACTION',
      title: 'Cork Show - Settlement',
      description: 'Receive full payment post-show',
      start_at: new Date('2025-11-11T00:00:00Z').toISOString(),
      end_at: new Date('2025-11-18T00:00:00Z').toISOString(),
      status: 'planned',
      priority_score: 85,
      labels: {
        venue: 'Cyprus Avenue',
        amount: '€3,500',
        type: 'Settlement',
      },
    },
    {
      type: 'FINANCE_ACTION',
      title: 'Tour Budget Reconciliation',
      description: 'Final tour expenses and profit calculation',
      start_at: new Date('2025-11-25T00:00:00Z').toISOString(),
      end_at: new Date('2025-11-30T00:00:00Z').toISOString(),
      status: 'planned',
      priority_score: 70,
      labels: {
        type: 'Budget Reconciliation',
        expected_profit: '€12,000',
      },
    },
    {
      type: 'FINANCE_ACTION',
      title: 'Van Rental Payment',
      description: 'Pay tour vehicle rental upfront',
      start_at: new Date('2025-11-01T00:00:00Z').toISOString(),
      end_at: new Date('2025-11-05T00:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 80,
      labels: {
        type: 'Vehicle Rental',
        amount: '€1,200',
        provider: 'Enterprise',
      },
    },
    {
      type: 'FINANCE_ACTION',
      title: 'Hotel Accommodations - Bulk Booking',
      description: 'Pre-pay hotel rooms for entire tour',
      start_at: new Date('2025-11-01T00:00:00Z').toISOString(),
      end_at: new Date('2025-11-07T00:00:00Z').toISOString(),
      status: 'waiting',
      priority_score: 82,
      labels: {
        type: 'Accommodation',
        amount: '€2,800',
        nights: '14 room-nights',
      },
    },

    // EUROPEAN LEG - Demonstrating travel conflict detection
    {
      type: 'LIVE_HOLD',
      title: 'Berlin - Berghain / Panorama Bar',
      description: 'Special show in Berlin',
      start_at: new Date('2025-11-25T22:00:00Z').toISOString(),
      end_at: new Date('2025-11-26T03:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 95,
      labels: {
        city: 'Berlin',
        venue: 'Berghain',
        territory: 'DE',
        timezone: 'Europe/Berlin',
        capacity: 800,
        fee: '€8,000',
      },
    },
    {
      type: 'LIVE_HOLD',
      title: 'Amsterdam - Paradiso',
      description: 'Amsterdam show - TRAVEL CONFLICT: only 2hr gap from Berlin (4hr required)',
      start_at: new Date('2025-11-26T05:00:00Z').toISOString(),
      end_at: new Date('2025-11-26T07:30:00Z').toISOString(),
      status: 'tentative',
      priority_score: 90,
      labels: {
        city: 'Amsterdam',
        venue: 'Paradiso',
        territory: 'NL',
        timezone: 'Europe/Amsterdam',
        capacity: 700,
        fee: '€7,000',
      },
    },
    {
      type: 'PROMO_SLOT',
      title: 'BBC Radio 1 - Essential Mix Recording',
      description: 'Record Essential Mix in London - TRAVEL CONFLICT: only 1.5hr gap from Amsterdam (4hr required)',
      start_at: new Date('2025-11-26T09:00:00Z').toISOString(),
      end_at: new Date('2025-11-26T13:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 98,
      labels: {
        city: 'London',
        territory: 'GB',
        timezone: 'Europe/London',
        type: 'Radio Recording',
        station: 'BBC Radio 1',
      },
    },
    {
      type: 'PROMO_SLOT',
      title: 'Paris - Boiler Room Set',
      description: 'Boiler Room performance - TRAVEL CONFLICT: only 2hr gap from London (4hr required)',
      start_at: new Date('2025-11-26T15:00:00Z').toISOString(),
      end_at: new Date('2025-11-26T17:00:00Z').toISOString(),
      status: 'confirmed',
      priority_score: 95,
      labels: {
        city: 'Paris',
        territory: 'FR',
        timezone: 'Europe/Paris',
        type: 'Live Stream',
        platform: 'Boiler Room',
      },
    },
    {
      type: 'LIVE_HOLD',
      title: 'Tokyo - Womb',
      description: 'Japan tour kickoff - MAJOR TRAVEL CONFLICT: only 12hr gap from Paris (16hr required)',
      start_at: new Date('2025-11-27T05:00:00Z').toISOString(),
      end_at: new Date('2025-11-27T09:00:00Z').toISOString(),
      status: 'tentative',
      priority_score: 92,
      labels: {
        city: 'Tokyo',
        venue: 'Womb',
        territory: 'JP',
        timezone: 'Asia/Tokyo',
        capacity: 1000,
        fee: '¥1,200,000',
      },
    },
  ];

  console.log(`\n📝 Inserting ${timelineItems.length} timeline items...`);

  // 6. Insert all timeline items
  for (const item of timelineItems) {
    const { error } = await supabase
      .from('project_items')
      .insert({
        project_id: projectId,
        created_by: userId,
        ...item,
      });

    if (error) {
      console.error(`   ❌ Error inserting "${item.title}":`, error.message);
    } else {
      const emoji =
        item.type === 'LIVE_HOLD' ? '🎸' :
        item.type === 'TRAVEL_SEGMENT' ? '🚗' :
        item.type === 'PROMO_SLOT' ? '📻' :
        item.type === 'RELEASE_MILESTONE' ? '💿' :
        item.type === 'LEGAL_ACTION' ? '📄' :
        item.type === 'FINANCE_ACTION' ? '💰' : '📌';

      console.log(`   ${emoji} ${item.title} (${item.status})`);
    }
  }

  console.log(`\n✅ Successfully seeded SHEE Ireland Tour project!`);
  console.log(`\n📊 Summary:`);
  console.log(`   Project ID: ${projectId}`);
  console.log(`   Total Items: ${timelineItems.length}`);
  console.log(`   - 🎸 Live Shows: 8`);
  console.log(`   - 🚗 Travel: 4`);
  console.log(`   - 📻 Promo: 7`);
  console.log(`   - 💿 Release Milestones: 4`);
  console.log(`   - 📄 Legal: 4`);
  console.log(`   - 💰 Finance: 5`);
  console.log(`\n⚠️  Travel Conflicts Seeded (Nov 25-27):`);
  console.log(`   - Berlin → Amsterdam (2hr gap, 4hr required) ⚠️ CONFLICT`);
  console.log(`   - Amsterdam → London (1.5hr gap, 4hr required) ⚠️ CONFLICT`);
  console.log(`   - London → Paris (2hr gap, 4hr required) ⚠️ CONFLICT`);
  console.log(`   - Paris → Tokyo (12hr gap, 16hr required) ⚠️ MAJOR CONFLICT`);
  console.log(`\n🎉 Open the timeline page (Nov 25-27) to view the conflicts!\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
