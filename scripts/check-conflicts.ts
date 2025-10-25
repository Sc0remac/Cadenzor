#!/usr/bin/env tsx
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../app/.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data, error } = await supabase
    .from('project_items')
    .select('title, start_at, end_at, labels, tz')
    .eq('project_id', '0e5f380a-8db2-4094-8045-fe89e62c0887')
    .gte('start_at', '2025-11-25')
    .lte('start_at', '2025-11-30')
    .order('start_at');

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Events Nov 25-30 with travel conflicts:');
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
