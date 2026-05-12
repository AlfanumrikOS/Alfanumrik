/**
 * GET /api/tutor/next — the Adaptive Tutor entry point.
 *
 * Returns the single concept the student should learn next, decided by
 * resolveNextConcept() (pure picker, see src/lib/tutor/resolve-next-concept.ts).
 *
 * Phase 0 picker: strict sequential within the student's grade, scoped to
 * (subject, chapter_number, concept_number), skipping concepts whose
 * concept_mastery.mastery_mean is at or above MASTERY_THRESHOLD.
 *
 * Gating: ff_tutor_v1. When OFF, returns 404 so legacy /learn routes keep
 * rendering. When ON, the /tutor page calls this on every refetch.
 *
 * ADR: docs/architecture/ADR-004-adaptive-tutor.md
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { resolveNextConcept } from '@/lib/tutor/resolve-next-concept';
import type {
  ConceptMasteryRow,
  TutorConceptRow,
  TutorNextResponse,
} from '@/lib/tutor/types';
import { logger } from '@/lib/logger';
import { capture } from '@/lib/posthog/server';

export const dynamic = 'force-dynamic';

const FLAG_NAME = 'ff_tutor_v1';

export async function GET(_request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // Flag gate — 404 when off so /learn keeps rendering for non-pilot users.
  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    await capture('tutor_next_404', userId, { reason: 'flag_off' });
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Pull the student's grade. The tutor scopes by grade — the student
  // never escapes their current grade except via explicit teacher action.
  const { data: studentRow, error: sErr } = await supabase
    .from('students')
    .select('id, grade, preferred_language')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (sErr || !studentRow) {
    await capture('tutor_next_404', userId, { reason: 'no_student_profile' });
    return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  }
  const studentId = studentRow.id as string;
  const grade = (studentRow.grade as string).replace(/^Grade\s*/i, '').trim();

  // Fetch all active concepts for this grade, sorted as the resolver
  // expects: subject ASC, chapter ASC, concept_number ASC.
  const { data: conceptRows, error: cErr } = await supabase
    .from('chapter_concepts')
    .select(
      'id, grade, subject, chapter_number, chapter_title, concept_number, ' +
      'title, title_hi, explanation, explanation_hi, example_content, ' +
      'example_content_hi, key_formula, practice_question, practice_options, ' +
      'practice_correct_index, practice_explanation, practice_explanation_hi, ' +
      'difficulty, bloom_level, estimated_minutes',
    )
    .eq('grade', grade)
    .eq('is_active', true)
    .order('subject', { ascending: true })
    .order('chapter_number', { ascending: true })
    .order('concept_number', { ascending: true });

  if (cErr) {
    logger.warn('tutor/next: concepts read failed', { userId, error: cErr.message });
    return NextResponse.json({ error: 'concept_read_failed' }, { status: 500 });
  }
  const conceptsInGrade = (conceptRows ?? []) as unknown as TutorConceptRow[];

  // Fetch this student's mastery rows. Scoped by student_id only; the
  // resolver intersects with concept ids itself.
  const { data: masteryRowsRaw, error: mErr } = await supabase
    .from('concept_mastery')
    .select('concept_id, mastery_mean, last_practiced_at')
    .eq('student_id', studentId);

  if (mErr) {
    // Mastery read failure degrades gracefully to "treat all as un-mastered" —
    // we never block the student on a projector outage.
    logger.warn('tutor/next: mastery read failed; treating all unmastered', {
      userId, error: mErr.message,
    });
  }
  const masteryRows = (masteryRowsRaw ?? []) as unknown as ConceptMasteryRow[];

  const decision: TutorNextResponse = resolveNextConcept({
    conceptsInGrade,
    masteryRows,
    // currentChapterHint comes in Phase 1 once we wire recent-activity reads.
    currentChapterHint: null,
  });

  await capture('tutor_next_resolved', userId, {
    status: decision.status,
    reason: decision.reason ?? null,
    concept_id: decision.concept?.id ?? null,
    subject: decision.concept?.subject ?? null,
    chapter_number: decision.concept?.chapter_number ?? null,
    mastered: decision.progress?.mastered ?? null,
    total: decision.progress?.total ?? null,
  });

  return NextResponse.json(decision, {
    headers: {
      // 10s private cache — mastery shifts fast in the inner loop, so we
      // want refetches after every answer to see the new pick.
      'Cache-Control': 'private, max-age=10',
    },
  });
}
