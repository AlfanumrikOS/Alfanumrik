/**
 * ALFANUMRIK — Curriculum Migration Rollback
 *
 * Reverts the NCERT 2025 migration by:
 * 1. Deactivating all ncert_2025 content
 * 2. Reactivating legacy content
 *
 * Usage:
 *   npx tsx scripts/ncert-ingestion/rollback.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  console.error('⚠️  ALFANUMRIK CURRICULUM ROLLBACK');
  console.error('═'.repeat(60));

  // Step 1: Deactivate new content
  console.error('🔄 Step 1: Deactivating ncert_2025 content...');
  const { error: e1 } = await supabase
    .from('rag_content_chunks')
    .update({ is_active: false })
    .eq('source', 'ncert_2025')
    .eq('is_active', true);

  if (e1) console.error('   Error:', e1.message);
  else console.error('   Done — new chunks deactivated');

  // Step 2: Reactivate legacy content
  console.error('🔄 Step 2: Reactivating legacy content...');
  const { error: e2 } = await supabase
    .from('rag_content_chunks')
    .update({ is_active: true })
    .eq('source', 'legacy')
    .eq('is_active', false);

  if (e2) console.error('   Error:', e2.message);
  else console.error('   Done — legacy chunks reactivated');

  // Step 3: Revert curriculum topics
  console.error('🔄 Step 3: Reverting curriculum topics...');
  const { error: e3 } = await supabase
    .from('curriculum_topics')
    .update({ source_version: 'legacy' })
    .eq('source_version', 'ncert_2025');

  if (e3) console.error('   Error:', e3.message);
  else console.error('   Done — topics reverted');

  console.error('');
  console.error('✅ ROLLBACK COMPLETE');
  console.error('   Foxy and quizzes now use legacy content');
  console.error('   Run validate.ts to verify the rollback state');
}

main().catch(err => {
  console.error('❌ Rollback failed:', err);
  process.exit(1);
});
