/**
 * POST /api/v2/placement/answer — record one placement probe response.
 *
 * Writes a single append-only row to learning_events with
 * event_type = 'placement_probe' (DECISIONS.md §1). NOTHING is written to
 * student_learning_profiles or concept_mastery from here: the projector reads
 * these events and sets a prior. One writer, one truth.
 *
 * "Haven't done this yet" arrives as unseen: true with optionId null. It sets a
 * low prior and records NO wrong answer — punishing honesty about untaught
 * content would corrupt the estimate this flow exists to create.
 *
 * Idempotency (DB-enforced, review fix): the caller supplies the idempotency
 * key it generated when the student answered. A cheap SELECT-by-key is tried
 * first as a fast path, but it is NOT the correctness guarantee — two
 * concurrent retries could both pass that read before either writes. The
 * actual guarantee is the partial UNIQUE index
 * learning_events_placement_probe_idempotency_uniq (migration
 * 20260802090000) on (student_id, context->>'idempotencyKey') WHERE
 * event_type = 'placement_probe'. A retry that loses the fast-path race still
 * hits the index on INSERT, raises a Postgres unique-violation (SQLSTATE
 * 23505), which this route catches and translates into the SAME
 * { accepted: true, duplicate: true } response as a fast-path hit — mirroring
 * isOpenAssignmentConflict() in api/teacher/remediation/route.ts, the
 * established convention for turning a named unique-index violation into a
 * benign duplicate response instead of a 500.
 *
 * Auth: study_plan.create (NOT study_plan.view — this is a write). The two
 * sibling GET routes in this family stay on study_plan.view.
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';
import { validateBody } from '@alfanumrik/lib/validation';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';
import { PlacementAnswerRequest } from '@alfanumrik/lib/api/v2/contract';

export const dynamic = 'force-dynamic';

const FLAG_NAME = 'ff_placement_v1';

/** Named DB backstop for placement-probe idempotency (migration 20260802090000). */
const PLACEMENT_PROBE_IDEMPOTENCY_INDEX = 'learning_events_placement_probe_idempotency_uniq';

/**
 * Mirrors isOpenAssignmentConflict() in api/teacher/remediation/route.ts.
 * `@supabase/supabase-js` surfaces a Postgres unique-violation on `.insert()`
 * as an error object with `.code === '23505'` plus `.message` / `.details` /
 * `.hint` text naming the violated constraint — matching that here confirms
 * the 23505 came from THIS index and not some other constraint on the table.
 */
function isPlacementProbeDuplicate(error: {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}): boolean {
  const evidence = [error.message, error.details, error.hint].filter(Boolean).join(' ');
  return error.code === '23505' && evidence.includes(PLACEMENT_PROBE_IDEMPOTENCY_INDEX);
}

/** DECISIONS.md §7 — credit the moment the work happened, but never the future
 *  and never more than 48h back. */
const MAX_BACKFILL_MS = 48 * 60 * 60 * 1000;

function clampOccurredAt(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t) || t > now.getTime()) return now.toISOString();
  if (now.getTime() - t > MAX_BACKFILL_MS) return new Date(now.getTime() - MAX_BACKFILL_MS).toISOString();
  return new Date(t).toISOString();
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'study_plan.create', { requireStudentId: true });
  if (!auth.authorized || !auth.userId) return auth.errorResponse!;

  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId: auth.userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) return v2Error('Not found', 404, 'NOT_FOUND');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return v2Error('Malformed JSON body', 400, 'VALIDATION_ERROR');
  }

  const validation = validateBody(PlacementAnswerRequest, raw);
  if (!validation.success) return validation.error;
  const input = validation.data;

  // A probe either names an option or declares the topic unseen — never both,
  // never neither.
  if (input.unseen === (input.optionId !== null)) {
    return v2Error('unseen and optionId are mutually exclusive', 400, 'VALIDATION_ERROR');
  }

  try {
    const supabase = await createSupabaseServerClient();
    const now = new Date();

    // Fast path only — NOT the correctness guarantee (see file header). The
    // table is append-only, so a cheap look-before-write skips a second round
    // trip for the common case (client retries after a flaky ack).
    const { data: existing } = await supabase
      .from('learning_events')
      .select('id')
      .eq('event_type', 'placement_probe')
      .contains('context', { idempotencyKey: input.idempotencyKey })
      .limit(1);

    if (Array.isArray(existing) && existing.length > 0) {
      return v2Success({ accepted: true, duplicate: true });
    }

    // student_id is auth.uid() — required by the FK and the RLS insert policy.
    const { error } = await supabase.from('learning_events').insert({
      student_id: auth.userId,
      session_id: input.sessionId,
      event_type: 'placement_probe',
      topic_id: input.topicId,
      question_id: input.questionId,
      verb: input.unseen ? 'declared-unseen' : 'answered',
      object_type: 'placement_probe',
      result: { optionId: input.optionId, unseen: input.unseen },
      context: { source: 'placement', idempotencyKey: input.idempotencyKey },
      occurred_at: clampOccurredAt(input.occurredAt, now),
    });

    if (error) {
      // Lost the fast-path race to a concurrent identical retry: the DB-level
      // unique index is what actually prevented the duplicate row. Translate
      // it into the SAME benign response the fast path returns.
      if (isPlacementProbeDuplicate(error)) {
        return v2Success({ accepted: true, duplicate: true });
      }

      logger.error('v2_placement_answer_insert_failed', {
        error: new Error(error.message),
        route: '/api/v2/placement/answer',
      });
      return v2Error('Could not record answer', 500, 'INTERNAL_ERROR');
    }

    return v2Success({ accepted: true, duplicate: false });
  } catch (err) {
    logger.error('v2_placement_answer_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/placement/answer',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
