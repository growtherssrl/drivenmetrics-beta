import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkSearches() {
  console.log('Checking Deep Marketing Searches...\n');

  // 1. Total searches
  const { count: totalCount } = await supabase
    .from('deep_marketing_searches')
    .select('*', { count: 'exact', head: true });
  console.log(`Total searches: ${totalCount}`);

  // 2. Searches with user_id
  const { count: withUserCount } = await supabase
    .from('deep_marketing_searches')
    .select('*', { count: 'exact', head: true })
    .not('user_id', 'is', null);
  console.log(`Searches with user_id: ${withUserCount}`);

  // 3. Searches without user_id
  const { count: withoutUserCount } = await supabase
    .from('deep_marketing_searches')
    .select('*', { count: 'exact', head: true })
    .is('user_id', null);
  console.log(`Searches without user_id: ${withoutUserCount}`);

  // 4. Sample of searches without user_id
  if (withoutUserCount && withoutUserCount > 0) {
    const { data: orphanSearches } = await supabase
      .from('deep_marketing_searches')
      .select('id, query, status, created_at')
      .is('user_id', null)
      .limit(5);
    
    console.log('\nSample searches without user_id:');
    console.table(orphanSearches);
  }

  // 5. Searches per user
  const { data: userStats } = await supabase
    .from('deep_marketing_searches')
    .select('user_id')
    .not('user_id', 'is', null);
  
  if (userStats) {
    const userCounts = userStats.reduce((acc: any, curr) => {
      acc[curr.user_id] = (acc[curr.user_id] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\nSearches per user:');
    console.table(
      Object.entries(userCounts)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 10)
        .map(([userId, count]) => ({ userId, count }))
    );
  }

  // 6. Check for orphaned user_ids
  const { data: allSearchUsers } = await supabase
    .from('deep_marketing_searches')
    .select('user_id')
    .not('user_id', 'is', null);
  
  if (allSearchUsers) {
    const uniqueUserIds = [...new Set(allSearchUsers.map(s => s.user_id))];
    
    for (const userId of uniqueUserIds) {
      const { data: user } = await supabase
        .from('users')
        .select('user_id')
        .eq('user_id', userId)
        .single();
      
      if (!user) {
        console.log(`\n⚠️  User ID ${userId} has searches but doesn't exist in users table!`);
      }
    }
  }
}

checkSearches().catch(console.error);