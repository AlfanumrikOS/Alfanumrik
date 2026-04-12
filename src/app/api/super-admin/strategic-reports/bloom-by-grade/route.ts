import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/strategic-reports/bloom-by-grade
 *
 * Computes distribution of Bloom's taxonomy levels per grade,
 * based on question_responses (which stores bloom_level per response).
 *
 * Fallback: if question_responses has no bloom_level data, joins
 * quiz_responses -> question_bank to get bloom_level from the question.
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
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const gradeFilter = searchParams.get('grade');

    // Strategy 1: Use question_responses which has bloom_level directly + student_id
    // Join to students for grade
    let query = supabaseAdmin
      .from('question_responses')
      .select('student_id, bloom_level');

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
        { error: 'Failed to fetch question responses', detail: responsesResult.error.message },
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

    // Check if question_responses has bloom_level data
    const responsesWithBloom = responses.filter(r => r.bloom_level);

    let gradeBloomCounts: Record<string, Record<BloomLevel, number>>;

    if (responsesWithBloom.length > 0) {
      // Strategy 1: Use bloom_level from question_responses directly
      gradeBloomCounts = {};

      for (const r of responses) {
        const grade = studentGradeMap.get(r.student_id);
        if (!grade) continue; // Student not in filter or not active

        const bloom = normalizeBloomLevel(r.bloom_level);
        if (!bloom) continue;

        if (!gradeBloomCounts[grade]) {
          gradeBloomCounts[grade] = { remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 };
        }
        gradeBloomCounts[grade][bloom]++;
      }
    } else {
      // Strategy 2 fallback: join quiz_responses -> question_bank for bloom_level
      const { data: quizResponses, error: qrErr } = await supabaseAdmin
        .from('quiz_responses')
        .select('student_id, question_id');

      if (qrErr) {
        return NextResponse.json(
          { error: 'Failed to fetch quiz responses', detail: qrErr.message },
          { status: 500 }
        );
      }

      // Collect unique question IDs
      const questionIds = Array.from(new Set((quizResponses || []).map(r => r.question_id).filter(Boolean)));

      // Fetch bloom_level from question_bank for those questions (batch)
      const questionBloomMap = new Map<string, string>();
      if (questionIds.length > 0) {
        // Fetch in batches of 500 to avoid URL-too-long
        const BATCH_SIZE = 500;
        for (let i = 0; i < questionIds.length; i += BATCH_SIZE) {
          const batch = questionIds.slice(i, i + BATCH_SIZE);
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

      gradeBloomCounts = {};
      for (const r of quizResponses || []) {
        const grade = studentGradeMap.get(r.student_id);
        if (!grade) continue;

        const rawBloom = questionBloomMap.get(r.question_id);
        const bloom = normalizeBloomLevel(rawBloom);
        if (!bloom) continue;

        if (!gradeBloomCounts[grade]) {
          gradeBloomCounts[grade] = { remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0, create: 0 };
        }
        gradeBloomCounts[grade][bloom]++;
      }
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
