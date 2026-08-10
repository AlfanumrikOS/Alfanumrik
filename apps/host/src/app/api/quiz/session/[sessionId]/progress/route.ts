/**
 * /api/quiz/session/[sessionId]/progress — the quiz RESUME substrate.
 *
 *   POST → persist ONE confirmed answer, immediately, first-write-wins.
 *   GET  → return everything needed to rebuild an interrupted session,
 *          and NOTHING that reveals the answer key.
 *
 * ─── Why this route exists instead of a migration ─────────────────────────
 *
 * Migration `20260802130000_check_quiz_answer_rpc.sql` already added the
 * durability columns this route reads and writes
 * (`quiz_session_shuffles.student_selected_displayed_index` /
 * `student_time_spent_seconds` / `student_answered_at`) and already ships a
 * writer — `check_quiz_answer()`. But that writer is DARK on the live path:
 * its only product caller is `confirmAnswerPracticeV2`, reachable solely from
 * the `practiceV2On && quizMode === 'practice' && isQuestionMCQ` render branch,
 * and `practiceV2On` is `ff_quiz_v2`, seeded `is_enabled=FALSE, rollout=0`
 * (`20260802150000_seed_ff_quiz_v2.sql`). Nothing writes those columns today.
 *
 * The fix must NOT be "ramp ff_quiz_v2": that flag turns on immediate
 * per-question correctness, which is (a) a pedagogy change owned by
 * assessment, and (b) precisely the combination that makes resume unsafe
 * (see the interlock in the GET handler). So the always-on writer is this
 * route: it persists the SAME three columns and returns NO correctness, which
 * makes it a pure durability upgrade available on every mode with the flag
 * still OFF. It writes through the service-role client because
 * `quiz_session_shuffles` has SELECT-only RLS policies for students — with an
 * explicit `student_id` ownership check standing in for the missing policy.
 *
 * ─── Invariants this route must not break ─────────────────────────────────
 *
 * P1/P2/P4: writes NOTHING to `quiz_sessions`, `quiz_responses`, `students`,
 *   `xp_transactions`, or any mastery table. Scoring and XP remain
 *   exclusively `submit_quiz_results_v2`'s job, called once, at final submit.
 *   The persisted columns are a side-channel, never a scoring input — exactly
 *   the boundary migration 20260802130000 drew.
 * P3: per-question time is clamped to [0, 3600] before persisting and is
 *   first-write-wins, so a resumed session cannot inflate its way past the
 *   3s/question floor; and because the resume payload restores real on-task
 *   time (never wall clock), an honest resumer is not falsely flagged either.
 *   Full reasoning on `buildQuizResumePayload`.
 * P8: service-role use is server-only and guarded by an explicit ownership
 *   check against the caller's `students.id`.
 * P13: logs carry session/question UUIDs and counts only — never option text,
 *   never correctness, never student-identifying data.
 *
 * Response shapes (house `{ success, data?, error? }`):
 *   200 → { success: true, data: … }
 *   400 → { success: false, error: 'invalid_session_id' | 'invalid_body' |
 *          'invalid_question_id' | 'invalid_selected_index' |
 *          'invalid_time_spent' | 'invalid_mode' }
 *   401 → from authorizeRequest
 *   403 → { success: false, error: 'student_profile_required' | 'forbidden' }
 *   404 → { success: false, error: 'not_found' }
 *   500 → { success: false, error: 'internal_server_error' }
 *
 * A NON-resumable session is a 200 with `{ resumable: false, reason }`, not an
 * error — the client falls soft to the setup screen. Reasons: 'not_found',
 * 'not_started', 'already_submitted', 'expired', 'corrupt',
 * 'blocked_immediate_feedback', 'exam_not_resumable', 'mode_unknown'.
 * EVERY one of these is ALSO checked by `resolveResumableQuiz`
 * (packages/lib/src/state/student-state-builder.ts) before `/today` offers the
 * "Continue where you stopped" card, so a refusal here should be unreachable
 * from the CTA. This route is the enforcement boundary; that is the promise
 * boundary. Adding a reason here without adding it there re-creates the
 * "the CTA said resume and started over" defect for that case.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import {
  SHUFFLE_RESUME_COLUMNS,
  QUESTION_BANK_RESUME_COLUMNS,
  MAX_QUESTION_SECONDS,
  buildQuizResumePayload,
  isResumeExpired,
  type QuestionBankResumeRow,
  type QuizResumeBlockedReason,
  type QuizResumeResult,
  type QuizSessionMode,
  type ShuffleResumeRow,
} from '@alfanumrik/lib/quiz/resume';
import { isResumeBlockedByImmediateFeedback } from '@alfanumrik/lib/quiz/resume-gate';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

const ROUTE = '/api/quiz/session/[sessionId]/progress';

/** The closed set of instruments `/quiz` runs; mirrors the DB CHECK (20260814000015). */
const VALID_MODES: readonly QuizSessionMode[] = ['practice', 'cognitive', 'exam'];

interface OwnershipProbe {
  ok: true;
  studentId: string;
  userId: string;
  /** The caller's REAL roles, for flag scoping. Never a hardcoded guess. */
  roles: string[];
}
interface OwnershipDenied {
  ok: false;
  response: NextResponse;
}

/**
 * Authenticate, resolve the caller's student row, and confirm the session's
 * snapshot rows belong to that student. This is the ONLY authorization
 * boundary on both verbs — `quiz_session_shuffles` has no student INSERT /
 * UPDATE policy, so the service-role client bypasses RLS entirely here.
 */
async function requireOwnedSession(
  request: NextRequest,
  sessionId: string,
): Promise<OwnershipProbe | OwnershipDenied> {
  const auth = await authorizeRequest(request, 'quiz.attempt');
  if (!auth.authorized) {
    return { ok: false, response: auth.errorResponse as unknown as NextResponse };
  }

  const studentId = auth.studentId;
  if (!studentId) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'student_profile_required' },
        { status: 403 },
      ),
    };
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('quiz_session_shuffles')
    .select('student_id')
    .eq('session_id', sessionId)
    .limit(1);

  if (error) {
    logger.error(`${ROUTE}: ownership probe failed`, {
      error: new Error(error.message),
      sessionId,
    });
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'internal_server_error' },
        { status: 500 },
      ),
    };
  }

  const owner = (data ?? [])[0]?.student_id as string | undefined;
  if (!owner) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'not_found' }, { status: 404 }),
    };
  }
  if (owner !== studentId) {
    // Same shape as "not found" would be tempting, but a 403 is the honest
    // signal and leaks nothing (the caller already supplied the id).
    logger.warn(`${ROUTE}: session ownership mismatch`, { sessionId });
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 }),
    };
  }

  return {
    ok: true,
    studentId,
    userId: auth.userId ?? '',
    roles: (auth.roles ?? []).map(r => String(r)),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// POST — persist one confirmed answer (always on, every quiz mode)
// ─────────────────────────────────────────────────────────────────────────

interface ProgressBody {
  questionId: string;
  selectedDisplayedIndex: number;
  timeSpentSeconds: number;
  /**
   * The instrument this session is running as. Optional ONLY so an older cached
   * client bundle still persists its answers; a session whose rows never get a
   * mode is simply refused at resume time (`mode_unknown`) rather than assumed
   * to be untimed.
   */
  mode: QuizSessionMode | null;
}

function parseBody(raw: unknown): ProgressBody | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'invalid_body' };
  const o = raw as Record<string, unknown>;

  if (!isUuid(o.questionId)) return { error: 'invalid_question_id' };

  const idx = o.selectedDisplayedIndex;
  if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx > 3) {
    return { error: 'invalid_selected_index' };
  }

  const t = o.timeSpentSeconds;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
    return { error: 'invalid_time_spent' };
  }

  // A present-but-unrecognised mode is a client contract violation, not
  // something to coerce — the DB CHECK would reject it anyway, and silently
  // dropping it would leave the session looking like an older client's.
  const m = o.mode;
  if (m !== undefined && m !== null && !VALID_MODES.includes(m as QuizSessionMode)) {
    return { error: 'invalid_mode' };
  }

  return {
    questionId: o.questionId,
    selectedDisplayedIndex: idx,
    // P3: clamp before it can ever influence a reconstructed total time.
    timeSpentSeconds: Math.min(Math.floor(t), MAX_QUESTION_SECONDS),
    mode: (m as QuizSessionMode | undefined) ?? null,
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    if (!isUuid(sessionId)) {
      return NextResponse.json(
        { success: false, error: 'invalid_session_id' },
        { status: 400 },
      );
    }

    const owned = await requireOwnedSession(request, sessionId);
    if (!owned.ok) return owned.response;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 });
    }
    const parsed = parseBody(raw);
    if ('error' in parsed) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // FIRST-WRITE-WINS. The `.is(...IS NULL)` predicate is the whole
    // immutability guarantee: once a student has confirmed an answer for a
    // (session, question) pair, no later call — from a retry, a resumed tab,
    // or a hand-crafted request — can change what is on record. It mirrors
    // the identical replay-lock `check_quiz_answer()` applies, so the two
    // writers are mutually safe in any interleaving: whichever lands first
    // wins and the other is a no-op.
    //
    // `session_mode` (migration 20260814000015) rides this SAME statement, so
    // the instrument is recorded ATOMICALLY WITH THE FIRST PERSISTED ANSWER.
    // Because a session only becomes resumable once it has ≥ 1 persisted
    // answer, there is no interleaving in which a session is resumable but its
    // instrument is unknown. It inherits the same first-write-wins
    // immutability: the `.is(...)` predicate means a later request cannot
    // relabel an in-flight attempt as a different instrument.
    const update: Record<string, unknown> = {
      student_selected_displayed_index: parsed.selectedDisplayedIndex,
      student_time_spent_seconds: parsed.timeSpentSeconds,
      student_answered_at: new Date().toISOString(),
    };
    if (parsed.mode !== null) update.session_mode = parsed.mode;

    const { data, error } = await admin
      .from('quiz_session_shuffles')
      .update(update)
      .eq('session_id', sessionId)
      .eq('question_id', parsed.questionId)
      .is('student_selected_displayed_index', null)
      .select('question_id');

    if (error) {
      logger.error(`${ROUTE}: persist failed`, {
        error: new Error(error.message),
        sessionId,
        questionId: parsed.questionId,
      });
      return NextResponse.json(
        { success: false, error: 'internal_server_error' },
        { status: 500 },
      );
    }

    // `saved: false` means "already answered" — a benign, expected outcome on
    // a double-tap or a network retry, not an error.
    return NextResponse.json({
      success: true,
      data: { saved: (data ?? []).length > 0 },
    });
  } catch (err) {
    logger.error(`${ROUTE}: unexpected POST failure`, {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'internal_server_error' },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET — the resume payload
// ─────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    if (!isUuid(sessionId)) {
      return NextResponse.json(
        { success: false, error: 'invalid_session_id' },
        { status: 400 },
      );
    }

    const owned = await requireOwnedSession(request, sessionId);
    if (!owned.ok) return owned.response;
    const studentId = owned.studentId;

    const blocked = (reason: QuizResumeBlockedReason) =>
      NextResponse.json(
        { success: true, data: { resumable: false, reason } satisfies QuizResumeResult },
        { headers: { 'Cache-Control': 'no-store' } },
      );

    // ── INTERLOCK (defence in depth) ─────────────────────────────────────
    // Resume is refused while `ff_quiz_v2` is ON for this caller.
    //
    // `submit_quiz_results_v2` grades from the CLIENT-supplied responses, not
    // from the persisted columns — an explicit, documented non-goal of
    // migration 20260802130000. That is harmless today because the live path
    // never tells a student whether an answer was right before submit, so
    // re-answering after a resume is an information-free coin flip. It stops
    // being harmless the moment `ff_quiz_v2` reveals per-question correctness
    // mid-quiz: "answer, see it's wrong, refresh, resume, answer again" would
    // become a real exploit, defeating P1/P2.
    //
    // This is deliberately a mechanical gate rather than a doc note, so the
    // unsafe combination cannot be reached by flipping one flag in the admin
    // console. Removing it requires `submit_quiz_results_v2` to prefer
    // `student_selected_displayed_index` when non-NULL — an assessment +
    // architect change to a P1 surface, not something this route may assume.
    //
    // TWO CORRECTIONS live in `isResumeBlockedByImmediateFeedback`:
    //
    //   1. This is now the SECOND line of defence, not the only one.
    //      `resolveResumableQuiz` (student-state-builder) consults the same
    //      gate where the `/today` "Continue where you stopped" card is
    //      PRODUCED. Previously the card was offered unconditionally and only
    //      refused here, and the client's fail-soft path shows no message —
    //      so a flagged student tapped "continue" and silently landed on the
    //      setup screen with their progress apparently gone. Never promise
    //      what you will refuse.
    //
    //   2. The read FAILS CLOSED. `isFeatureEnabled` returns `false` for a
    //      missing flag, a malformed payload, a failed fetch or missing env —
    //      and `false` here means ALLOW RESUME. An unreachable flag service
    //      therefore re-opened the exploit silently. Only a positive,
    //      successfully-read "off" now permits resume; the caller's REAL roles
    //      are used for scoping instead of a hardcoded `'student'`.
    const immediateFeedbackOn = await isResumeBlockedByImmediateFeedback({
      userId: owned.userId || undefined,
      roles: owned.roles,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    });
    if (immediateFeedbackOn) return blocked('blocked_immediate_feedback');

    const admin = getSupabaseAdmin();

    // ALREADY-SUBMITTED GATE. `submitQuizResults` passes the server session id
    // as `p_idempotency_key`, and `submit_quiz_results_v2` persists it on the
    // graded `quiz_sessions` row (unique per student, migration
    // 20260504100200). Its presence therefore means "this session has already
    // been graded" — the single strongest guard against a resumed session
    // producing a second submission or a second XP award. (Note the graded
    // row's `id` is a NEW uuid, unrelated to the shuffle session id, so the
    // idempotency key is the only usable link.)
    const { data: gradedRows, error: gradedErr } = await admin
      .from('quiz_sessions')
      .select('id')
      .eq('student_id', studentId)
      .eq('idempotency_key', sessionId)
      .limit(1);

    if (gradedErr) {
      logger.error(`${ROUTE}: submitted-check failed`, {
        error: new Error(gradedErr.message),
        sessionId,
      });
      return NextResponse.json(
        { success: false, error: 'internal_server_error' },
        { status: 500 },
      );
    }
    if ((gradedRows ?? []).length > 0) return blocked('already_submitted');

    // ── Snapshot rows. NOTE THE SELECT LIST ──────────────────────────────
    // SHUFFLE_RESUME_COLUMNS does not contain
    // `correct_answer_index_snapshot`, so the answer key never leaves
    // Postgres on this path — not into this process, not into a log, not
    // into the response. That is layer 1 of 3; see packages/lib/src/quiz/
    // resume.ts for the other two.
    const { data: shuffleRows, error: shuffleErr } = await admin
      .from('quiz_session_shuffles')
      .select(SHUFFLE_RESUME_COLUMNS)
      .eq('session_id', sessionId)
      .eq('student_id', studentId);

    if (shuffleErr) {
      logger.error(`${ROUTE}: snapshot read failed`, {
        error: new Error(shuffleErr.message),
        sessionId,
      });
      return NextResponse.json(
        { success: false, error: 'internal_server_error' },
        { status: 500 },
      );
    }

    const rows = (shuffleRows ?? []) as unknown as ShuffleResumeRow[];
    if (rows.length === 0) return blocked('not_found');

    if (isResumeExpired(rows[0]?.created_at ?? null, new Date())) {
      return blocked('expired');
    }

    // Question metadata — again without `correct_answer_index`.
    const { data: qRows, error: qErr } = await admin
      .from('question_bank')
      .select(QUESTION_BANK_RESUME_COLUMNS)
      .in('id', rows.map(r => r.question_id));

    if (qErr) {
      logger.error(`${ROUTE}: question metadata read failed`, {
        error: new Error(qErr.message),
        sessionId,
      });
      return NextResponse.json(
        { success: false, error: 'internal_server_error' },
        { status: 500 },
      );
    }

    const byId = new Map<string, QuestionBankResumeRow>(
      ((qRows ?? []) as unknown as QuestionBankResumeRow[]).map(q => [q.id, q]),
    );

    const payload = buildQuizResumePayload(sessionId, rows, byId);

    logger.info(`${ROUTE}: resume resolved`, {
      sessionId,
      resumable: payload.resumable,
      total: payload.resumable ? payload.total_questions : 0,
      answered: payload.resumable ? payload.answered_count : 0,
    });

    return NextResponse.json(
      { success: true, data: payload },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    logger.error(`${ROUTE}: unexpected GET failure`, {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'internal_server_error' },
      { status: 500 },
    );
  }
}
