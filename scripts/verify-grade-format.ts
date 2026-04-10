/**
 * ALFANUMRIK — Grade Format Verification Script (P5)
 *
 * Connects to Supabase and checks that all grade values in question_bank
 * conform to P5: plain strings "6" through "12".
 *
 * Run:
 *   npx tsx scripts/verify-grade-format.ts
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const VALID_GRADES = /^(6|7|8|9|10|11|12)$/;

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Check question_bank
  console.info('=== question_bank: DISTINCT grade values ===');
  const { data: qbGrades, error: qbError } = await supabase
    .from('question_bank')
    .select('grade')
    .limit(10000);

  if (qbError) {
    console.error('Failed to query question_bank:', qbError.message);
    process.exit(1);
  }

  const distinctGrades = Array.from(new Set((qbGrades || []).map((r: { grade: string }) => r.grade))).sort();
  console.info('Found grades:', distinctGrades);

  const invalid = distinctGrades.filter((g: string) => !VALID_GRADES.test(g));
  const valid = distinctGrades.filter((g: string) => VALID_GRADES.test(g));

  console.info('Valid (P5):', valid);
  console.info('Invalid:', invalid);

  if (invalid.length === 0) {
    console.info('\nAll question_bank grades conform to P5. No action needed.');
  } else {
    console.error(`\nP5 VIOLATION: ${invalid.length} non-conforming grade format(s) found.`);
    console.info('\nFix SQL (run in Supabase SQL editor):');
    console.info('-- Normalize "Grade X" format to plain "X"');
    console.info(`UPDATE question_bank SET grade = regexp_replace(grade, '^Grade\\s+', '') WHERE grade ~ '^Grade\\s+';`);
    console.info('');
    console.info('-- Verify after fix:');
    console.info('SELECT DISTINCT grade FROM question_bank ORDER BY grade;');

    // Count affected rows per invalid format
    for (const g of invalid) {
      const { count } = await supabase
        .from('question_bank')
        .select('*', { count: 'exact', head: true })
        .eq('grade', g);
      console.warn(`  "${g}": ${count ?? '?'} rows`);
    }
  }

  // Also check curriculum_topics for consistency
  console.info('\n=== curriculum_topics: DISTINCT grade values ===');
  const { data: ctGrades, error: ctError } = await supabase
    .from('curriculum_topics')
    .select('grade')
    .limit(10000);

  if (ctError) {
    console.error('Failed to query curriculum_topics:', ctError.message);
  } else {
    const ctDistinct = Array.from(new Set((ctGrades || []).map((r: { grade: string }) => r.grade))).sort();
    console.info('Found grades:', ctDistinct);
    const ctInvalid = ctDistinct.filter((g: string) => !VALID_GRADES.test(g));
    if (ctInvalid.length > 0) {
      console.error(`P5 VIOLATION in curriculum_topics: ${ctInvalid.join(', ')}`);
    } else {
      console.info('All curriculum_topics grades conform to P5.');
    }
  }

  // Check rag_content_chunks (this table may legitimately use "Grade X" format)
  console.info('\n=== rag_content_chunks: DISTINCT grade values (informational) ===');
  const { data: ragGrades, error: ragError } = await supabase
    .from('rag_content_chunks')
    .select('grade')
    .limit(10000);

  if (ragError) {
    console.error('Failed to query rag_content_chunks:', ragError.message);
  } else {
    const ragDistinct = Array.from(new Set((ragGrades || []).map((r: { grade: string }) => r.grade))).sort();
    console.info('Found grades:', ragDistinct);
    console.info('NOTE: rag_content_chunks may use "Grade X" format by design (separate from P5 for question_bank).');
  }

  process.exit(invalid.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
