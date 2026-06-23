/**
 * POST /api/foxy/quiz-answer — grade an evidential Foxy "Quiz me" MCQ.
 *
 * PART B1 (integrity-critical). This is the ONLY chat-side path that moves
 * mastery, and it does so through the SANCTIONED pipeline — IDENTICAL to
 * /api/tutor/answer:
 *
 *   served-item verification  -> tutor_commit_attempt RPC
 *                             -> learner.concept_check_answered
 *                             -> conceptMasteryProjector
 *                             -> concept_mastery.mastery_probability / p_know
 *
 * Anti mastery-injection: a client can NOT POST an arbitrary {correct, concept}.
 * We look up the SERVER-ISSUED foxy_served_items row by id, verify it belongs to
 * this student, was server-issued, and is not already answered, then grade the
 * student's chosen index against the SERVER-HELD correct_index (never a client
 * claim). Only then do we commit through tutor_commit_attempt.
 *
 * Anti-cheat parity (P3): the single-MCQ floor is the quiz 3s/question rule —
 * a response_time_ms below 3000 is rejected (too fast to have read the question).
 *
 * XP: this path awards ZERO XP. It deliberately does NOT call
 * atomic_quiz_profile_update — that RPC enforces the 200/day quiz XP cap and is
 * the authority for quiz XP; routing evidential Foxy answers through it would
 * either bypass the cap or double-count. Mastery is the reward here, not XP.
 *
 * Request body:
 *   {
 *     served_item_id: string (uuid),   // the foxy_served_items row id (from serve)
 *     chosen_index:   number (0..3),    // the option the student picked
 *     attempt_id:     string (uuid),    // client-generated; idempotency key (23505 dedupe)
 *     response_time_ms?: number         // >= 3000 (P3 parity); optional but recommended
 *   }
 *
 * Response (success):
 *   {
 *     ok: true,
 *     correct: boolean,
 *     correct_index: number,            // revealed AFTER grading
 *     evidential: true,
 *     mastery: { concept_id, mastery_mean, attempts, mastered },
 *     xp_earned: 0
 *   }
 * Response (already answered / duplicate attempt): 409 { error: 'already_answered' }
 * Response (too fast): 422 { error: 'too_fast', detail }
 * Response (not your item / not found): 404 { error: 'served_item_not_found' }
 * Response (concept unresolvable at grade time): 422 { error: 'not_evidential' }
 *
 * Owner: ai-engineer. Reviewers: assessment (mastery-move parity), testing, quality.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';
import { capture } from '@/lib/posthog/server';
import { MASTERY_THRESHOLD } from '@/lib/tutor/types';

export const dynamic = 'force-dynamic';

const TUTOR_FLAG = 'ff_tutor_v1';
const BKT_FLAG = 'ff_tutor_bkt_v1';
const BUS_FLAG = 'ff_event_bus_v1';
const PROJECTOR_FLAG = 'ff_projector_runner_v1';

// P3 anti-cheat parity: single-MCQ floor mirrors the quiz "3s average per
// question" rule. Below this we refuse to grade (too fast to be a real answer).
const MIN_RESPONSE_TIME_MS = 3000;

const BodySchema = z.object({
  served_item_id: z.string().uuid(),
  chosen_index: z.number().int().min(0).max(3),
  attempt_id: z.string().uuid(),
  response_time_ms: z.number().int().nonnegative().optional(),
});

type Body = z.infer<typeof BodySchema>;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;
  const envHint = {
    userId,
    role: 'student' as const,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  };

  // Evidential grading rides the same flag matrix as /api/tutor/answer. The
  // sanctioned mastery move requires all four flags ON (Path C v2). When the
  // tutor flag is OFF the endpoint does not exist (404, parity with tutor route).
  const tutorOn = await isFeatureEnabled(TUTOR_FLAG, envHint);
  if (!tutorOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: Body;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'bad_request', detail: (err as Error).message.slice(0, 200) },
      { status: 400 },
    );
  }

  // P3 anti-cheat parity — refuse implausibly fast answers BEFORE any DB work.
  if (typeof body.response_time_ms === 'number' && body.response_time_ms < MIN_RESPONSE_TIME_MS) {
    return NextResponse.json(
      {
        error: 'too_fast',
        detail: `Answer too fast (min ${MIN_RESPONSE_TIME_MS}ms per question, P3 anti-cheat).`,
      },
      { status: 422 },
    );
  }

  const [bktOn, busOn, projectorOn] = await Promise.all([
    isFeatureEnabled(BKT_FLAG, envHint),
    isFeatureEnabled(BUS_FLAG, envHint),
    isFeatureEnabled(PROJECTOR_FLAG, envHint),
  ]);

  // Resolve the caller's student row (RLS-scoped read).
  const { data: studentRow } = await supabase
    .from('students').select('id').eq('auth_user_id', userId).maybeSingle();
  if (!studentRow) {
    return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  }
  const studentId = studentRow.id as string;

  // ── Served-item verification (anti mastery-injection) ────────────────────
  // Read the SERVER-ISSUED item. We use the admin client so the read can also
  // see the correct_index (the RLS policy permits the student to read their own
  // row anyway, but the answer-key compare runs server-side either way). We
  // STILL scope the query to this student_id so one student can never grade
  // another student's served item.
  const { data: servedItem, error: servedErr } = await supabaseAdmin
    .from('foxy_served_items')
    .select('id, session_id, student_id, concept_id, question_id, correct_index, answered_at')
    .eq('id', body.served_item_id)
    .eq('student_id', studentId)
    .maybeSingle();

  if (servedErr || !servedItem) {
    return NextResponse.json({ error: 'served_item_not_found' }, { status: 404 });
  }

  // Already answered → idempotent refusal. The served-item answered_at stamp is
  // the first guard; the tutor_commit_attempt 23505 is the second (same
  // attempt_id retried). Both resolve to 409.
  if (servedItem.answered_at) {
    return NextResponse.json({ error: 'already_answered' }, { status: 409 });
  }

  const conceptId = servedItem.concept_id as string;
  const serverCorrectIndex = servedItem.correct_index as number;

  // Grade against the SERVER-HELD key (never a client `correct` claim).
  const correct = body.chosen_index === serverCorrectIndex;

  // Resolve the concept's subject/chapter for the concept-check event envelope.
  // If the concept row vanished (deleted between serve and grade) the item is no
  // longer evidential — we cannot move mastery on a concept that no longer
  // exists. Refuse rather than guess.
  const { data: conceptRow, error: cErr } = await supabaseAdmin
    .from('chapter_concepts')
    .select('id, subject, chapter_number, difficulty')
    .eq('id', conceptId)
    .maybeSingle();
  if (cErr || !conceptRow) {
    logger.warn('foxy/quiz-answer: concept row missing at grade time', {
      // P13: ids/scope only.
      conceptId,
    });
    return NextResponse.json({ error: 'not_evidential' }, { status: 422 });
  }

  // Sanctioned mastery move requires the full Path C flag set (parity with
  // /api/tutor/answer). If any gate is OFF we do NOT silently fall back to a
  // naive mastery write from a chat surface — we refuse to move mastery and
  // tell the client the item was non-evidential this turn. This keeps the
  // binding contract honest: evidential moves go ONLY through the projector.
  const allFlagsOn = bktOn && busOn && projectorOn;
  if (!allFlagsOn) {
    return NextResponse.json(
      { error: 'not_evidential', detail: 'mastery pipeline not enabled' },
      { status: 422 },
    );
  }

  const occurredAt = new Date().toISOString();

  // ── CLAIM the served item BEFORE committing (single-use authority) ────────
  // Conditional UPDATE on answered_at IS NULL is the atomic single-flight gate:
  // the FIRST grade claims the row; a concurrent or retried grade (even with a
  // DIFFERENT attempt_id) finds answered_at already set, claims nothing, and is
  // refused 409. This closes the double-apply window that the up-front
  // answered_at read alone cannot (two requests can both pass the read). The
  // tutor_commit_attempt 23505 guard remains the second line of defence for the
  // same-attempt_id retry case.
  const { data: claimedRows, error: claimErr } = await supabaseAdmin
    .from('foxy_served_items')
    .update({ answered_at: occurredAt, attempt_id: body.attempt_id })
    .eq('id', servedItem.id)
    .eq('student_id', studentId)
    .is('answered_at', null)
    .select('id');
  if (claimErr) {
    logger.error('foxy/quiz-answer: served-item claim failed', {
      servedItemId: servedItem.id,
      error: claimErr.message,
    });
    return NextResponse.json({ error: 'grade_failed' }, { status: 500 });
  }
  if (!claimedRows || claimedRows.length === 0) {
    // Lost the race / already answered between the read and the claim.
    return NextResponse.json({ error: 'already_answered' }, { status: 409 });
  }

  const rpcArgs = {
    p_attempt_id:        body.attempt_id,
    p_student_id:        studentId,
    p_concept_id:        conceptId,
    p_correct:           correct,
    p_chosen_index:      body.chosen_index,
    p_response_time_ms:  body.response_time_ms ?? null,
    // Stable, distinguishable from the tutor practice id so audit can tell the
    // evidential Foxy path apart from the tutor concept-check path.
    p_question_id:       (servedItem.question_id as string | null) ?? `${conceptId}:evidential:v1`,
    p_subject_code:      conceptRow.subject as string,
    p_chapter_number:    conceptRow.chapter_number as number,
    p_occurred_at:       occurredAt,
    p_event_id:          crypto.randomUUID(),
    p_idempotency_key:   `foxy.quiz-answer.${body.attempt_id}`,
  };

  const { data, error: rpcErr } = await supabaseAdmin.rpc('tutor_commit_attempt', rpcArgs);

  if (rpcErr) {
    // 23505 = duplicate attempt_id (client retried) → idempotent 409. Same
    // semantics as /api/tutor/answer. (We've already claimed the item; on a
    // genuine retry the claim above would have 409'd first, so reaching here
    // with 23505 means the SAME attempt_id was committed via another surface —
    // still an honest 409.)
    if (rpcErr.code === '23505') {
      return NextResponse.json({ error: 'already_answered' }, { status: 409 });
    }
    // RPC failed after we claimed the item. Release the claim so the student can
    // retry (best-effort; failure here just leaves it claimed, which is safe —
    // no mastery moved).
    logger.error('foxy/quiz-answer: tutor_commit_attempt RPC failed', {
      // P13: ids/scope only, never the student name/email.
      conceptId,
      attemptId: body.attempt_id,
      rpcError: rpcErr.message,
      rpcCode: rpcErr.code,
    });
    await supabaseAdmin
      .from('foxy_served_items')
      .update({ answered_at: null, attempt_id: null })
      .eq('id', servedItem.id)
      .eq('attempt_id', body.attempt_id);
    return NextResponse.json({ error: 'mastery_write_failed' }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  const posterior = Number(row?.posterior_mastery_mean);
  const seq = Number(row?.attempt_sequence);

  // Reuse the canonical tutor_answer_recorded event — the evidential Foxy path
  // IS a tutor concept-check answer committed through the SAME tutor_commit_attempt
  // RPC. Avoids minting a new analytics event (ops-owned PostHogEventName union).
  // The distinct `${conceptId}:evidential:v1` question_id on the concept-check
  // event lets dashboards separate the Foxy lane from the tutor lane.
  await capture('tutor_answer_recorded', userId, {
    concept_id: conceptId,
    correct,
    new_mastery_mean: posterior,
    difficulty: (conceptRow.difficulty as number | null) ?? null,
    path: 'c',
  });

  return NextResponse.json({
    ok: true,
    correct,
    // Reveal the correct index AFTER grading so the UI can show feedback.
    correct_index: serverCorrectIndex,
    evidential: true,
    xp_earned: 0,
    mastery: {
      concept_id: conceptId,
      mastery_mean: posterior,
      attempts: seq,
      mastered: posterior >= MASTERY_THRESHOLD,
    },
  });
}
