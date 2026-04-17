/**
 * ALFANUMRIK — cbse_syllabus Backfill
 *
 * Populate cbse_syllabus by taking the UNION of two sources:
 *   1. distinct (grade_short, subject_code, chapter_number, chapter_title) from rag_content_chunks
 *   2. distinct (grade, subject, chapter_number, chapter_title) from question_bank
 *
 * Rows already present are skipped (UNIQUE constraint). Triggers + nightly
 * recompute fill in chunk_count / verified_question_count / rag_status
 * afterward.
 *
 * Run: npx tsx scripts/backfill-cbse-syllabus.ts [--dry-run]
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
 * Spec: §11.1 Week 1
 */

import { supabaseAdmin } from '../src/lib/supabase-admin';
import { logger } from '../src/lib/logger';

interface BackfillResult {
  planned: number;
  inserted: number;
  skipped: number;
  errors: Array<{ row: Record<string, unknown>; error: string }>;
}

interface Options {
  dryRun?: boolean;
}

export async function backfillCbseSyllabus(opts: Options = {}): Promise<BackfillResult> {
  const { dryRun = false } = opts;
  const result: BackfillResult = { planned: 0, inserted: 0, skipped: 0, errors: [] };

  // Source 1: rag_content_chunks
  const { data: chunkTuples, error: chunkErr } = await supabaseAdmin.rpc(
    'distinct_chapter_tuples_from_chunks'
  );
  if (chunkErr) throw new Error(`chunk tuple fetch failed: ${chunkErr.message}`);

  // Source 2: question_bank
  const { data: bankTuples, error: bankErr } = await supabaseAdmin.rpc(
    'distinct_chapter_tuples_from_bank'
  );
  if (bankErr) throw new Error(`bank tuple fetch failed: ${bankErr.message}`);

  const merged = new Map<string, {
    grade: string; subject_code: string; chapter_number: number;
    chapter_title: string; subject_display: string;
  }>();

  for (const t of [...(chunkTuples || []), ...(bankTuples || [])]) {
    const key = `${t.grade}|${t.subject_code}|${t.chapter_number}`;
    if (!merged.has(key)) {
      merged.set(key, {
        grade: t.grade,
        subject_code: t.subject_code,
        chapter_number: t.chapter_number,
        chapter_title: t.chapter_title || `Chapter ${t.chapter_number}`,
        subject_display: t.subject_display || t.subject_code,
      });
    }
  }

  result.planned = merged.size;
  if (dryRun) return result;

  for (const row of merged.values()) {
    const { error } = await supabaseAdmin.from('cbse_syllabus').insert({
      board: 'CBSE',
      grade: row.grade,
      subject_code: row.subject_code,
      subject_display: row.subject_display,
      chapter_number: row.chapter_number,
      chapter_title: row.chapter_title,
    });
    if (error) {
      if (error.code === '23505') {
        result.skipped++;                         // UNIQUE violation — already present
      } else {
        result.errors.push({ row, error: error.message });
      }
    } else {
      result.inserted++;
    }
  }

  logger.info('backfill_cbse_syllabus_complete', result as unknown as Record<string, unknown>);
  return result;
}

// CLI runner
if (require.main === module) {
  (async () => {
    const dryRun = process.argv.includes('--dry-run');
    const res = await backfillCbseSyllabus({ dryRun });
    console.log(JSON.stringify(res, null, 2));
  })();
}