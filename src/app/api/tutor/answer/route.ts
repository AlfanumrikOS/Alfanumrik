/**
 * POST /api/tutor/answer — record a concept-check outcome.
 *
 * Flag matrix (ADR-005 Path C v2):
 *
 *   ff_tutor_v1   ff_tutor_bkt_v1   ff_event_bus_v1   ff_projector_runner_v1   Behaviour
 *   ────────────────────────────────────────────────────────────────────────────────────
 *   OFF           —                 —                 —                        404 not_found
 *   ON            OFF               —                 —                        Phase 0 legacy: naive concept_mastery upsert
 *   ON            ON                OFF               —                        Phase 0 legacy (bus required for Path C)
 *   ON            ON                ON                OFF                      Phase 0 legacy (projector required for Path C)
 *   ON            ON                ON                ON                       Path C v2 → atomic RPC tutor_commit_attempt
 *
 * Path C v2 flow:
 *   1. Validate body. attempt_id is required when ff_tutor_bkt_v1 is ON.
 *   2. Call sb.rpc('tutor_commit_attempt', {…}) — single Postgres transaction
 *      that takes pg_advisory_xact_lock(hashtext(student||concept)), reads
 *      the chain head's posterior as the BKT prior, computes posterior via
 *      public.bkt_update, INSERTs concept_attempts(status='answered'),
 *      INSERTs state_events for learner.concept_check_answered, returns
 *      (attempt_sequence, prior, posterior, event_id).
 *   3a. Success → return { ok, optimistic: true, path: 'c', mastery: {…} }.
 *   3b. UNIQUE-violation on concept_attempts PK (Postgres 23505) → 409
 *       already_answered. The duplicate attempt_id case.
 *   3c. Any other failure → log critical, INSERT concept_attempts with
 *       status='excluded' to preserve audit trail, fall through to legacy
 *       block, emit tutor_answer_path_c_fallback PostHog event.
 *
 * Why the legacy block survives PR 2: it is the rollback target. Removing
 * it would mean an RPC outage downgrades all student writes silently to
 * /dev/null. A future PR (one week post-100%) deletes it.
 *
 * ADRs : docs/architecture/ADR-005-concept-first-adaptive-learning-spine.md
 *        docs/architecture/ADR-004-adaptive-tutor.md
 * Spec : docs/superpowers/specs/2026-05-12-adr-004-phase-2-bkt-projector-design.md
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

const BodySchema = z.object({
  concept_id: z.string().uuid(),
  chosen_index: z.number().int().min(0).max(3),
  correct: z.boolean(),
  response_time_ms: z.number().int().nonnegative().optional(),
  // Optional at the schema level; required at runtime when ff_tutor_bkt_v1
  // is ON. We can't conditionally require it via Zod because the flag is
  // read after parsing.
  attempt_id: z.string().uuid().optional(),
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

  const [bktOn, busOn, projectorOn] = await Promise.all([
    isFeatureEnabled(BKT_FLAG, envHint),
    isFeatureEnabled(BUS_FLAG, envHint),
    isFeatureEnabled(PROJECTOR_FLAG, envHint),
  ]);

  if (bktOn && !body.attempt_id) {
    return NextResponse.json(
      { error: 'bad_request', detail: 'attempt_id required when ff_tutor_bkt_v1 is ON' },
      { status: 400 },
    );
  }

  // Look up student + concept (needed by every branch below).
  const { data: studentRow } = await supabase
    .from('students').select('id').eq('auth_user_id', userId).maybeSingle();
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

  // ── Path C v2 — atomic RPC ──────────────────────────────────────────
  const allFlagsOn = bktOn && busOn && projectorOn;
  if (allFlagsOn && body.attempt_id) {
    const occurredAt = new Date().toISOString();
    const rpcArgs = {
      p_attempt_id:        body.attempt_id,
      p_student_id:        studentId,
      p_concept_id:        body.concept_id,
      p_correct:           body.correct,
      p_chosen_index:      body.chosen_index,
      p_response_time_ms:  body.response_time_ms ?? null,
      p_question_id:       `${body.concept_id}:practice:v1`,
      p_subject_code:      conceptRow.subject as string,
      p_chapter_number:    conceptRow.chapter_number as number,
      p_occurred_at:       occurredAt,
      p_event_id:          crypto.randomUUID(),
      p_idempotency_key:   `tutor.answer.${body.attempt_id}`,
    };

    const { data, error: rpcErr } = await supabaseAdmin.rpc('tutor_commit_attempt', rpcArgs);

    if (!rpcErr && data) {
      // Supabase returns TABLE-returning functions as an array of rows.
      const row = Array.isArray(data) ? data[0] : data;
      const posterior = Number(row?.posterior_mastery_mean);
      const seq = Number(row?.attempt_sequence);

      await capture('tutor_answer_recorded', userId, {
        concept_id: body.concept_id,
        correct: body.correct,
        new_mastery_mean: posterior,
        difficulty: (conceptRow.difficulty as number | null) ?? null,
        path: 'c',
      });

      return NextResponse.json({
        ok: true,
        optimistic: true,
        path: 'c',
        mastery: {
          concept_id: body.concept_id,
          mastery_mean: posterior,
          attempts: seq,
          mastered: posterior >= MASTERY_THRESHOLD,
        },
      });
    }

    // RPC failed. Distinguish the duplicate-attempt UNIQUE violation
    // (Postgres SQLSTATE 23505) from other errors. Duplicate means the
    // client retried with the same attempt_id — the chain row already
    // exists (idempotently), so a 409 is the honest answer.
    if (rpcErr?.code === '23505') {
      return NextResponse.json({ error: 'already_answered' }, { status: 409 });
    }

    logger.error('tutor/answer: tutor_commit_attempt RPC failed; falling back to legacy', {
      userId,
      conceptId: body.concept_id,
      attemptId: body.attempt_id,
      rpcError: rpcErr?.message,
      rpcCode: rpcErr?.code,
    });
    await capture('tutor_answer_path_c_fallback', userId, {
      concept_id: body.concept_id,
      attempt_id: body.attempt_id,
      reason: 'rpc_error',
      error: rpcErr?.message ?? 'unknown',
    });

    // Record an excluded marker for the audit trail. The chain-head reads
    // filter on status='answered', so this row never enters BKT chains.
    // Failure here is non-fatal — we still attempt the legacy write below.
    const { error: excludedErr } = await supabaseAdmin.from('concept_attempts').insert({
      attempt_id:             body.attempt_id,
      student_id:             studentId,
      concept_id:             body.concept_id,
      attempt_sequence:       null,
      served_at:              occurredAt,
      answered_at:            occurredAt,
      correct:                body.correct,
      chosen_index:           body.chosen_index,
      response_time_ms:       body.response_time_ms ?? null,
      prior_mastery_mean:     null,
      posterior_mastery_mean: null,
      status:                 'excluded',
    });
    if (excludedErr && excludedErr.code !== '23505') {
      logger.error('tutor/answer: excluded marker insert failed', {
        userId,
        attemptId: body.attempt_id,
        error: excludedErr.message,
      });
    }
    // FALL THROUGH to the legacy block.
  }

  // ── Legacy block (Phase 0 inline naive write) ───────────────────────
  // Used when ff_tutor_bkt_v1 is OFF, when any of the gating flags is OFF,
  // or when the Path C RPC failed and we just fell through.
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

  const { error: upsertErr } = await sbAdmin.from('concept_mastery').upsert(
    {
      student_id:        studentId,
      concept_id:        body.concept_id,
      mastery_mean:      newMean,
      last_practiced_at: new Date().toISOString(),
      total_attempts:    currentAttempts + 1,
      total_correct:     currentCorrect + (body.correct ? 1 : 0),
      streak_current:    newStreak,
      updated_at:        new Date().toISOString(),
    },
    { onConflict: 'student_id,concept_id' },
  );

  if (upsertErr) {
    logger.error('tutor/answer: legacy concept_mastery upsert failed', {
      userId,
      conceptId: body.concept_id,
      error: upsertErr.message,
    });
    return NextResponse.json(
      { error: 'mastery_write_failed', detail: upsertErr.message },
      { status: 500 },
    );
  }

  await capture('tutor_answer_recorded', userId, {
    concept_id: body.concept_id,
    correct: body.correct,
    new_mastery_mean: newMean,
    difficulty: (conceptRow.difficulty as number | null) ?? null,
    path: 'legacy',
  });

  return NextResponse.json({
    ok: true,
    optimistic: false,
    path: 'legacy',
    mastery: {
      concept_id: body.concept_id,
      mastery_mean: newMean,
      attempts: currentAttempts + 1,
      streak_current: newStreak,
      mastered: newMean >= MASTERY_THRESHOLD,
    },
  });
}
