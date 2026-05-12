/**
 * POST /api/tutor/answer — record a concept-check outcome.
 *
 * Body: { concept_id: uuid, chosen_index: int, correct: boolean,
 *         response_time_ms?: int }
 *
 * Side effects:
 *   1. UPSERT into public.concept_mastery — naive Phase 0 update:
 *        correct  → mastery_mean = max(current ?? 0.5, 0.9), streak++
 *        wrong    → mastery_mean = min(current ?? 0.5, 0.5), streak = 0
 *      A real BKT projector replaces this in Phase 2 (consumer of
 *      learner.concept_check_answered events).
 *   2. Publish `learner.concept_check_answered` to state_events (best-effort
 *      — failure logged but does not 500 the response).
 *
 * Returns: the updated mastery row for the client to merge into its cache.
 * The /tutor page refetches /api/tutor/next after this resolves and gets the
 * next concept.
 *
 * Gating: same ff_tutor_v1 flag as /api/tutor/next. The page never sees this
 * endpoint when the flag is off.
 *
 * ADR: docs/architecture/ADR-004-adaptive-tutor.md
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { publishEvent } from '@/lib/state/events/publish';
import { logger } from '@/lib/logger';
import { capture } from '@/lib/posthog/server';
import { MASTERY_THRESHOLD } from '@/lib/tutor/types';

export const dynamic = 'force-dynamic';

const FLAG_NAME = 'ff_tutor_v1';

const BodySchema = z.object({
  concept_id: z.string().uuid(),
  chosen_index: z.number().int().min(0).max(3),
  correct: z.boolean(),
  response_time_ms: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    const json = await request.json();
    body = BodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: 'bad_request', detail: (err as Error).message.slice(0, 200) },
      { status: 400 },
    );
  }

  // Look up student row + the concept metadata we'll need for the event payload.
  const { data: studentRow } = await supabase
    .from('students')
    .select('id')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (!studentRow) {
    return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  }
  const studentId = studentRow.id as string;

  const { data: conceptRow, error: cErr } = await supabase
    .from('chapter_concepts')
    .select('id, subject, chapter_number, difficulty')
    .eq('id', body.concept_id)
    .maybeSingle();
  if (cErr || !conceptRow) {
    return NextResponse.json({ error: 'concept_not_found' }, { status: 404 });
  }

  // ── Step 1: naive mastery update ───────────────────────────────────
  // Read current row (if any), compute new mastery, upsert. Using the
  // service-role client because concept_mastery is RLS-locked to writes
  // by the projector role.
  const sbAdmin = supabaseAdmin;

  const { data: existing } = await sbAdmin
    .from('concept_mastery')
    .select('mastery_mean, total_attempts, total_correct, streak_current')
    .eq('student_id', studentId)
    .eq('concept_id', body.concept_id)
    .maybeSingle();

  const currentMean = (existing?.mastery_mean as number | null) ?? 0.5;
  const currentAttempts = (existing?.total_attempts as number | null) ?? 0;
  const currentCorrect = (existing?.total_correct as number | null) ?? 0;
  const currentStreak = (existing?.streak_current as number | null) ?? 0;

  const newMean = body.correct
    ? Math.max(currentMean, MASTERY_THRESHOLD + 0.05)
    : Math.min(currentMean, 0.5);
  const newStreak = body.correct ? currentStreak + 1 : 0;

  const upsertPayload = {
    student_id: studentId,
    concept_id: body.concept_id,
    mastery_mean: newMean,
    last_practiced_at: new Date().toISOString(),
    total_attempts: currentAttempts + 1,
    total_correct: currentCorrect + (body.correct ? 1 : 0),
    streak_current: newStreak,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await sbAdmin
    .from('concept_mastery')
    .upsert(upsertPayload, { onConflict: 'student_id,concept_id' });

  if (upsertErr) {
    logger.error('tutor/answer: concept_mastery upsert failed', {
      userId, conceptId: body.concept_id, error: upsertErr.message,
    });
    return NextResponse.json(
      { error: 'mastery_write_failed', detail: upsertErr.message },
      { status: 500 },
    );
  }

  // ── Step 2: publish state-bus event (best-effort) ───────────────────
  // The event payload mirrors LearnerConceptCheckAnsweredSchema if it lands
  // in the registry; for now we use a generic shape under the existing bus.
  // Failure here is logged but does not fail the user-facing response.
  try {
    await publishEvent(sbAdmin, {
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: userId,
      tenantId: null,
      idempotencyKey: `tutor-answer-${userId}-${body.concept_id}-${Date.now()}`,
      kind: 'learner.quiz_completed',  // closest existing event in registry
      payload: {
        quizSessionId: crypto.randomUUID(),
        subjectCode: conceptRow.subject as string,
        chapterNumber: conceptRow.chapter_number as number,
        questionCount: 1,
        correctCount: body.correct ? 1 : 0,
        durationSec: Math.round((body.response_time_ms ?? 0) / 1000),
        xpEarned: body.correct ? 5 : 0,
      },
    });
  } catch (err) {
    logger.warn('tutor/answer: state_events publish failed (non-fatal)', {
      userId, error: (err as Error).message,
    });
  }

  await capture('tutor_answer_recorded', userId, {
    concept_id: body.concept_id,
    correct: body.correct,
    new_mastery_mean: newMean,
    difficulty: (conceptRow.difficulty as number | null) ?? null,
  });

  return NextResponse.json({
    ok: true,
    mastery: {
      concept_id: body.concept_id,
      mastery_mean: newMean,
      total_attempts: currentAttempts + 1,
      streak_current: newStreak,
      mastered: newMean >= MASTERY_THRESHOLD,
    },
  });
}
