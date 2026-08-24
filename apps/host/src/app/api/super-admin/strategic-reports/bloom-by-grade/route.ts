import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@alfanumrik/lib/admin-auth';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';

/**
 * GET /api/super-admin/strategic-reports/bloom-by-grade
 *
 * Computes distribution of Bloom's taxonomy levels per grade,
 * based on quiz_responses.bloom_level (stamped per response by the atomic
 * server-side submit path).
 *
 * Fallback: for responses whose bloom_level is NULL, joins
 * quiz_responses -> question_bank to get bloom_level from the question.
 *
 * DATA-SOURCE CORRECTION (2026-08-24): Strategy 1 used to read the legacy
 * `question_responses` table, which has ZERO rows in production — so this
 * report always silently fell through to the question_bank join, and would
 * have shown operators an empty chart had the join also been unavailable.
 * `question_responses` is dead (written only by a removed client-side
 * fire-and-forget insert, read by nothing). Do not repoint back to it.
 *
 * Query params:
 *   grade — optional filter (e.g. "6", "7", ..., "12")
 */

const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;
type BloomLevel = typeof BLOOM_LEVELS[number];

function normalizeBloomLevel(raw: string | null | undefined): BloomLevel | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  // Handle common variations
  if (lower === 'remembering' || lower === 'knowledge') return 'remember';
  if (lower === 'understanding' || lower === 'comprehension') return 'understand';
  if (lower === 'applying' || lower === 'application') return 'apply';
  if (lower === 'analyzing' || lower === 'analysis') return 'analyze';
  if (lower === 'evaluating' || lower === 'evaluation') return 'evaluate';
  if (lower === 'creating' || lower === 'synthesis') return 'create';
  if (BLOOM_LEVELS.includes(lower as BloomLevel)) return lower as BloomLevel;
  return null;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const gradeFilter = searchParams.get('grade');

    // Strategy 1: Use quiz_responses, which carries bloom_level directly +
    // student_id. question_id is retained so Strategy 2 can fill NULL rows.
    const query = supabaseAdmin
      .from('quiz_responses')
      .select('student_id, question_id, bloom_level');

    // We need student grade, so fetch students separately and join in JS
    // (Supabase JS client doesn't support cross-table joins without FK path easily)

    const studentsQuery = gradeFilter
      ? supabaseAdmin.from('students').select('id, grade').eq('grade', gradeFilter).eq('is_active', true)
      : supabaseAdmin.from('students').select('id, grade').eq('is_active', true);

    const [responsesResult, studentsResult] = await Promise.all([
      query,
      studentsQuery,
    ]);

    if (responsesResult.error) {
      return NextResponse.json(
        { error: 'Failed to fetch quiz responses', detail: responsesResult.error.message },
        { status: 500 }
      );
    }

    if (studentsResult.error) {
      return NextResponse.json(
        { error: 'Failed to fetch students', detail: studentsResult.error.message },
        { status: 500 }
      );
    }

    const students = studentsResult.data || [];
    const responses = responsesResult.data || [];

    // Build student -> grade lookup
    const studentGradeMap = new Map<string, string>();
    for (const s of students) {
      studentGradeMap.set(s.id, s.grade);
    }

    // Strategy 2 (per-row fallback, not per-report): responses whose
    // bloom_level is NULL — e.g. the pre-backfill cohort — are resolved by
    // looking the level up on question_bank. Previously this was an
    // all-or-nothing branch that only ran when Strategy 1 produced zero rows;
    // because Strategy 1 read a dead table it ALWAYS ran, and a partially
    // stamped cohort would have been silently under-counted. Now the two
    // strategies compose: direct stamp first, question_bank only to fill gaps.
    const questionIdsNeedingLookup = Array.from(
      new Set(
        responses
          .filter(r => !r.bloom_level && r.question_id)
          .map(r => r.question_id as string)
      )
    );

    const questionBloomMap = new Map<string, string>();
    if (questionIdsNeedingLookup.length > 0) {
      // Fetch in batches of 500 to avoid URL-too-long
      const BATCH_SIZE = 500;
      for (let i = 0; i < questionIdsNeedingLookup.length; i += BATCH_SIZE) {
        const batch = questionIdsNeedingLookup.slice(i, i + BATCH_SIZE);
        const { data: questions } = await supabaseAdmin
          .from('question_bank')
          .select('id, bloom_level')
          .in('id', batch);

        if (questions) {
          for (const q of questions) {
            if (q.bloom_level) {
              questionBloomMap.set(q.id, q.bloom_level);
            }
          }
        }
      }
    }

    const gradeBloomCounts: Record<string, Record<BloomLevel, number>> = {};

    for (const r of responses) {
      // P5: grade is a STRING key throughout ("6".."12"), never an integer.
      const grade = studentGradeMap.get(r.student_id);
      if (!grade) continue; // Student not in filter or not active

      const rawBloom =
        r.bloom_level ?? (r.question_id ? questionBloomMap.get(r.question_id) : undefined);
      const bloom = normalizeBloomLevel(rawBloom);
      if (!bloom) continue;

      if (!gradeBloomCounts[grade]) {
        gradeBloomCounts[grade] = { remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 };
      }
      gradeBloomCounts[grade][bloom]++;
    }

    // Convert counts to percentages
    const grades: Record<string, Record<BloomLevel, number>> = {};

    for (const [grade, counts] of Object.entries(gradeBloomCounts)) {
      const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
      if (total === 0) continue;

      grades[grade] = {
        remember: Math.round((counts.remember / total) * 100),
        understand: Math.round((counts.understand / total) * 100),
        apply: Math.round((counts.apply / total) * 100),
        analyze: Math.round((counts.analyze / total) * 100),
        evaluate: Math.round((counts.evaluate / total) * 100),
        create: Math.round((counts.create / total) * 100),
      };
    }

    return NextResponse.json({ grades });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal error computing bloom distribution', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
