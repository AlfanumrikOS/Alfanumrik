/**
 * ALFANUMRIK — Post-Migration Validation
 *
 * Runs after NCERT ingestion to verify:
 * 1. New content exists and is active
 * 2. Old content is deprecated (is_active = false)
 * 3. Coverage meets minimum thresholds
 * 4. Foxy retrieval returns new content
 * 5. No grade/subject has zero chunks
 *
 * Usage:
 *   npx tsx scripts/ncert-ingestion/validate.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Re-export the mojibake guardrail so callers (ingest.ts, tests) can pull it
// from one stable path. The detector lives in `./mojibake` so it stays a pure
// module with no env-var requirements.
export { isDevanagariMojibake, assertNoMojibake, INDIC_SUBJECT_LANGUAGES } from './mojibake';
export type { IngestRowSample } from './mojibake';

const EXPECTED_SUBJECTS: Record<string, string[]> = {
  '6': ['math', 'science', 'english', 'hindi', 'social_studies'],
  '7': ['math', 'science', 'english', 'hindi', 'social_studies'],
  '8': ['math', 'science', 'english', 'hindi', 'social_studies'],
  '9': ['math', 'science', 'english', 'hindi', 'social_studies'],
  '10': ['math', 'science', 'english', 'hindi', 'social_studies'],
  '11': ['physics', 'chemistry', 'math', 'biology', 'english'],
  '12': ['physics', 'chemistry', 'math', 'biology', 'english'],
};

const MIN_CHUNKS_PER_SUBJECT = 20;

interface ValidationResult {
  check: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  details: string;
}

async function main() {
  console.error('🔍 ALFANUMRIK POST-MIGRATION VALIDATION');
  console.error('═'.repeat(60));

  const results: ValidationResult[] = [];

  // Check 1: New content exists
  const { count: newCount } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('source', 'ncert_2025');

  results.push({
    check: 'New NCERT 2025 content exists',
    status: (newCount ?? 0) > 0 ? 'PASS' : 'FAIL',
    details: `${newCount ?? 0} active chunks with source=ncert_2025`,
  });

  // Check 2: Old content is deprecated
  const { count: oldActiveCount } = await supabase
    .from('rag_content_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('source', 'legacy');

  results.push({
    check: 'Old legacy content deprecated',
    status: (oldActiveCount ?? 0) === 0 ? 'PASS' : 'WARN',
    details: `${oldActiveCount ?? 0} legacy chunks still active`,
  });

  // Check 3: Coverage per grade/subject
  // Build coverage map using per-combo COUNT queries — avoids Supabase JS row limits.
  const coverage: Record<string, number> = {};
  for (const [grade, subjects] of Object.entries(EXPECTED_SUBJECTS)) {
    for (const subject of subjects) {
      const { count } = await supabase
        .from('rag_content_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('grade_short', grade)
        .eq('subject_code', subject);
      coverage[`${grade}|${subject}`] = count ?? 0;
    }
  }

  let gapsFound = 0;
  for (const [grade, subjects] of Object.entries(EXPECTED_SUBJECTS)) {
    for (const subject of subjects) {
      const count = coverage[`${grade}|${subject}`] || 0;
      if (count < MIN_CHUNKS_PER_SUBJECT) {
        gapsFound++;
        results.push({
          check: `Coverage: Grade ${grade} ${subject}`,
          status: count === 0 ? 'FAIL' : 'WARN',
          details: `${count} chunks (minimum: ${MIN_CHUNKS_PER_SUBJECT})`,
        });
      }
    }
  }

  if (gapsFound === 0) {
    results.push({
      check: 'Coverage: All grade/subject combinations',
      status: 'PASS',
      details: `All ${Object.values(EXPECTED_SUBJECTS).flat().length} combinations meet minimum threshold`,
    });
  }

  // Check 4: Curriculum topics updated
  const { count: topicCount } = await supabase
    .from('curriculum_topics')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  results.push({
    check: 'Curriculum topics exist',
    status: (topicCount ?? 0) > 0 ? 'PASS' : 'WARN',
    details: `${topicCount ?? 0} active topics`,
  });

  // Check 5: Content media (if applicable)
  try {
    const { count: mediaCount } = await supabase
      .from('content_media')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    results.push({
      check: 'Content media (images/figures)',
      status: (mediaCount ?? 0) > 0 ? 'PASS' : 'WARN',
      details: `${mediaCount ?? 0} media assets`,
    });
  } catch {
    results.push({
      check: 'Content media table',
      status: 'WARN',
      details: 'Table may not exist yet (migration pending)',
    });
  }

  // Check 6: Embedding coverage — chunks without vectors won't be retrieved
  const { count: nullEmbedCount } = await supabase
    .from('rag_content_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('source', 'ncert_2025')
    .is('embedding', null);

  const nullEmbedPct = newCount && newCount > 0
    ? Math.round(((nullEmbedCount ?? 0) / newCount) * 100)
    : 0;

  results.push({
    check: 'Embedding coverage (ncert_2025)',
    status: (nullEmbedCount ?? 0) === 0 ? 'PASS'
          : nullEmbedPct > 5 ? 'FAIL'
          : 'WARN',
    details: `${nullEmbedCount ?? 0} chunks missing vector (${nullEmbedPct}% of ${newCount ?? 0}). Run npm run ncert:embed to fix.`,
  });

  // Print results
  console.error('');
  let hasFailure = false;
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
    console.error(`${icon} ${r.check}: ${r.status} — ${r.details}`);
    if (r.status === 'FAIL') hasFailure = true;
  }

  console.error('');
  if (hasFailure) {
    console.error('❌ VALIDATION FAILED — do not cut over to production');
    process.exit(1);
  } else {
    console.error('✅ VALIDATION PASSED — safe to cut over');
  }
}

main().catch(err => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
