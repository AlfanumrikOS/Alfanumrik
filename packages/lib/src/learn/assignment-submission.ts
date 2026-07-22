/**
 * Student-side assignment completion — the write-side counterpart of the
 * teacher grading surface (apps/host/src/app/teacher/submissions/page.tsx +
 * supabase/functions/teacher-dashboard get_assignment_submissions /
 * get_submission_detail). This module is the SINGLE place that maps an
 * already-graded `quiz_sessions` row onto an `assignment_submissions` row so
 * the two surfaces never drift.
 *
 * P1/P2/P4 boundary (assessment owns scoring/XP — this module does NOT
 * recompute either):
 *   - score / correct / total are read VERBATIM from the `quiz_sessions` row
 *     that `submitQuizResults()` already wrote via the atomic
 *     `atomic_quiz_profile_update` RPC. No `(correct/total)*100` math happens
 *     here — that would risk drifting from the P1 formula if either side
 *     changed independently.
 *   - `xp_earned` is intentionally NOT accepted from the client and is NOT
 *     re-derived here: `quiz_sessions` has no xp column, and the real XP
 *     ledger (`students.xp_total` / `student_learning_profiles`) is already
 *     the single source of truth, updated by the SAME RPC when the quiz was
 *     submitted. `assignment_submissions.xp_earned` is left at its column
 *     default (0) in this first cut — it is a display-only mirror, not a
 *     second XP grant. Deferred: thread a trustworthy per-session xp value
 *     through once quiz_sessions (or a join) can supply one (assessment call).
 *
 * P8/P9 boundary: the caller (API route) resolves `studentId` from
 * `authorizeRequest(..., { requireStudentId: true })` — never trusts a
 * client-supplied student id. This module additionally verifies:
 *   1. the assignment exists,
 *   2. the assignment's class_id is one the student is ACTIVELY enrolled in
 *      (class_students), independent of any RLS on assignment_submissions —
 *      the existing "Students can manage own submissions" RLS policy only
 *      checks student_id ownership, not class membership, so this class check
 *      is the actual defense against a student completing an assignment that
 *      was never issued to their class.
 *   3. the quiz_sessions row belongs to the SAME student and is completed —
 *      a session id cannot be borrowed from another student's history.
 *
 * ═══ MULTI-ATTEMPT (Master Action Plan Phase 3, item 3.8) ═══════════════════
 *
 * `assignment_submissions` is uniquely keyed on (assignment_id, student_id,
 * attempt_number) — MULTIPLE rows per (assignment, student) were always
 * schema-supported, but this module previously hardcoded `attempt_number: 1`
 * on every call, so a second genuine completion silently overwrote the
 * first's score/responses instead of recording a new attempt. Fixed: this
 * module now reads the student's PRIOR attempts for this assignment, computes
 * the next attempt number, and enforces `assignments.max_attempts` (default 3,
 * matching the column default) with a 409 (`max_attempts_reached`) once
 * exceeded.
 *
 * IDEMPOTENT REPLAY GUARD: without a `quiz_sessions.id` column on
 * `assignment_submissions` (schema change, out of scope for this module), the
 * only signal available to distinguish "the same completion request retried"
 * from "a genuine second attempt" is: the LATEST existing attempt's
 * (questions_total, questions_correct, score) match this session's derived
 * values EXACTLY, AND it was submitted within `REPLAY_DEDUPE_WINDOW_MS` of
 * now. A deliberate second attempt (the student re-takes the whole quiz) is
 * effectively never byte-identical AND within a few seconds of the first, so
 * this narrow window closes the "network retry burns an extra attempt" risk
 * without falsely collapsing two genuinely distinct attempts that happen to
 * score the same.
 *
 * GRADING SEMANTIC (product-policy default — assessment/ops may override):
 * each attempt is preserved as its OWN row (never collapsed/overwritten), so
 * no attempt's data is ever destroyed. This module additionally computes and
 * returns `bestScorePercent` (the MAX scorePercent across every one of this
 * student's attempts on this assignment, including the one just submitted) so
 * a caller can surface "best score" without any downstream system (teacher
 * dashboard, class analytics) needing to change — those can equally choose
 * `MAX(score)` or "latest row" semantics from the full attempt history this
 * module preserves. If assessment wants "best attempt is the official grade"
 * to become authoritative outside of what this function reports, that is a
 * downstream-consumer change, not a change to this write path.
 *
 * ═══ DUE-DATE LOCKOUT (Master Action Plan Phase 3, item 3.9) ════════════════
 *
 * Previously there was ZERO server-side check of `assignments.due_date` — the
 * "Overdue" UI badge was purely cosmetic (client-side only), so a student
 * could complete an assignment at any time with no record of lateness. Fixed:
 * if `now() > due_date`, this module checks the EXISTING
 * `assignments.allow_late_submission` column (default `true` — already
 * present in schema, not newly added):
 *   - `allow_late_submission === false` -> reject with `submission_closed`
 *     (409). A hard reject risks unfairly locking out a student with a
 *     legitimate late excuse, so this is opt-in per assignment, not the
 *     platform default.
 *   - otherwise (default) -> ACCEPT but flag `isLateSubmission: true` in the
 *     result. This is a product-policy DEFAULT (accept-and-flag over
 *     hard-reject), chosen because a hard reject-by-default could unfairly
 *     lock out a student with a legitimate late excuse; ops/assessment/
 *     teachers may want a stricter default later, or a richer per-assignment
 *     policy than the existing boolean column supports. Note this module
 *     does NOT persist a durable `is_late` flag on the row — there is no
 *     schema column for it (out of scope: no schema changes in this module),
 *     so lateness is reported to the caller/logs only, not stored.
 *
 * Idempotent: since `assignment_submissions` has no `quiz_sessions.id`
 * column, this module upserts on the table's real unique key
 * (assignment_id, student_id, attempt_number) — see the replay guard above
 * for how a retry of the SAME completion is distinguished from a genuine new
 * attempt without that column.
 *
 * A submission that a teacher has ALREADY graded (graded_at set) is never
 * silently overwritten — a replay of an already-graded attempt returns
 * { ok: false, reason: 'already_graded' } instead of a fresh 'submitted', so
 * a duplicate completion call can't clobber teacher feedback/score overrides.
 * A NEW (non-replay) attempt after a prior attempt was graded is allowed
 * (grading one attempt does not block the next attempt) as long as
 * max_attempts has not been reached.
 */

/** DB column default for `assignments.max_attempts` — used only when the
 *  fetched row's value is null/undefined (should not happen in practice). */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Idempotent-replay detection window (ms). A retried request for the SAME
 *  completion arrives within seconds; a genuine second attempt requires
 *  re-taking the whole quiz and essentially never lands this fast. */
const REPLAY_DEDUPE_WINDOW_MS = 15_000;

export interface AssignmentCompletionInput {
  assignmentId: string;
  studentId: string;
  sessionId: string;
}

export type AssignmentCompletionResult =
  | {
      ok: true;
      submissionId: string;
      status: 'submitted';
      scorePercent: number;
      /** The attempt number this call recorded (or replayed). */
      attemptNumber: number;
      /** MAX(scorePercent) across every one of this student's attempts on
       *  this assignment, including this one — see the grading-semantic note
       *  in the module header. */
      bestScorePercent: number;
      /** true when this attempt was recorded after `assignments.due_date`
       *  (and `allow_late_submission` was not explicitly false). Reported for
       *  the caller/logs only — not persisted (no schema column). */
      isLateSubmission: boolean;
    }
  | { ok: false; reason: 'assignment_not_found' }
  | { ok: false; reason: 'not_enrolled' }
  | { ok: false; reason: 'session_not_found' }
  | { ok: false; reason: 'session_incomplete' }
  | { ok: false; reason: 'already_graded' }
  | { ok: false; reason: 'max_attempts_reached' }
  | { ok: false; reason: 'submission_closed' }
  | { ok: false; reason: 'db_error'; message: string };

interface MinimalSupabaseClient {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): {
        eq(col: string, val: unknown): {
          maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
          order(
            col: string,
            opts: { ascending: boolean },
          ): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        };
        maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
    upsert(
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ): {
      select(cols: string): {
        maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
}

interface AssignmentSubmissionHistoryRow {
  id: string;
  attempt_number: number | null;
  questions_total: number | null;
  questions_correct: number | null;
  score: number | null;
  graded_at: string | null;
  submitted_at: string | null;
}

export async function completeAssignmentFromSession(
  admin: MinimalSupabaseClient,
  input: AssignmentCompletionInput,
): Promise<AssignmentCompletionResult> {
  const { assignmentId, studentId, sessionId } = input;

  // 1. Assignment must exist. Also read due_date/max_attempts/
  //    allow_late_submission — all pre-existing columns (items 3.8/3.9).
  const { data: assignmentRaw, error: assignmentErr } = await admin
    .from('assignments')
    .select('id, class_id, due_date, max_attempts, allow_late_submission')
    .eq('id', assignmentId)
    .maybeSingle();
  if (assignmentErr) return { ok: false, reason: 'db_error', message: assignmentErr.message };
  const assignment = assignmentRaw as {
    id: string;
    class_id: string | null;
    due_date: string | null;
    max_attempts: number | null;
    allow_late_submission: boolean | null;
  } | null;
  if (!assignment) return { ok: false, reason: 'assignment_not_found' };

  // 2. Student must be an ACTIVE member of the assignment's class — this is
  //    the actual ownership boundary (assignment_submissions RLS alone does
  //    not check class membership).
  if (!assignment.class_id) return { ok: false, reason: 'assignment_not_found' };
  const { data: enrollmentRaw, error: enrollmentErr } = await admin
    .from('class_students')
    .select('id')
    .eq('class_id', assignment.class_id)
    .eq('student_id', studentId)
    .maybeSingle();
  if (enrollmentErr) return { ok: false, reason: 'db_error', message: enrollmentErr.message };
  if (!enrollmentRaw) return { ok: false, reason: 'not_enrolled' };

  // 3. The quiz session must belong to THIS student and be completed. Score
  //    values are read verbatim from here — no recomputation (P1).
  const { data: sessionRaw, error: sessionErr } = await admin
    .from('quiz_sessions')
    .select('id, student_id, total_questions, correct_answers, score_percent, time_spent_seconds, time_taken_seconds, is_completed')
    .eq('id', sessionId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (sessionErr) return { ok: false, reason: 'db_error', message: sessionErr.message };
  const session = sessionRaw as {
    id: string;
    student_id: string;
    total_questions: number | null;
    correct_answers: number | null;
    score_percent: number | null;
    time_spent_seconds: number | null;
    time_taken_seconds: number | null;
    is_completed: boolean | null;
  } | null;
  if (!session) return { ok: false, reason: 'session_not_found' };
  if (session.is_completed !== true) return { ok: false, reason: 'session_incomplete' };

  const total = session.total_questions ?? 0;
  const correct = session.correct_answers ?? 0;
  // P1: score_percent already computed as Math.round((correct/total)*100) by
  // the atomic_quiz_profile_update RPC — round defensively in case of a
  // double-precision fractional carry, never re-derive from correct/total.
  const scorePercent = Math.round(session.score_percent ?? 0);
  const timeSpent = session.time_spent_seconds ?? session.time_taken_seconds ?? 0;

  // 4. Load this student's FULL attempt history for this assignment (bounded
  //    by max_attempts — a handful of rows at most). Replaces the old
  //    single-row "already graded?" lookup: the same query now also drives
  //    next-attempt-number allocation and the idempotent-replay guard.
  const { data: historyRaw, error: historyErr } = await admin
    .from('assignment_submissions')
    .select('id, attempt_number, questions_total, questions_correct, score, graded_at, submitted_at')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .order('attempt_number', { ascending: true });
  if (historyErr) return { ok: false, reason: 'db_error', message: historyErr.message };
  const history = (historyRaw ?? []) as AssignmentSubmissionHistoryRow[];

  const latest = history.length > 0 ? history[history.length - 1] : null;
  const maxExistingAttempt = history.reduce(
    (max, r) => Math.max(max, typeof r.attempt_number === 'number' ? r.attempt_number : 0),
    0,
  );

  // 4a. Idempotent-replay guard: the LATEST attempt is byte-identical AND was
  //     submitted within the dedupe window -> this is the SAME completion
  //     request retried (e.g. a network retry), not a genuine new attempt.
  //     Never burn an attempt slot on a replay.
  if (
    latest &&
    latest.questions_total === total &&
    latest.questions_correct === correct &&
    latest.score === scorePercent &&
    latest.submitted_at &&
    Date.now() - Date.parse(latest.submitted_at) >= 0 &&
    Date.now() - Date.parse(latest.submitted_at) <= REPLAY_DEDUPE_WINDOW_MS
  ) {
    if (latest.graded_at) return { ok: false, reason: 'already_graded' };
    const bestScorePercent = Math.max(
      scorePercent,
      ...history.map((r) => (typeof r.score === 'number' ? r.score : -Infinity)),
    );
    return {
      ok: true,
      submissionId: latest.id,
      status: 'submitted',
      scorePercent,
      attemptNumber: typeof latest.attempt_number === 'number' ? latest.attempt_number : 1,
      bestScorePercent,
      isLateSubmission: isPastDue(assignment.due_date),
    };
  }

  // 4b. A genuinely NEW attempt: never clobber the record of a graded attempt
  //     — but grading one attempt does NOT block a subsequent one; only the
  //     max_attempts cap does (checked next).
  const nextAttempt = maxExistingAttempt + 1;
  const maxAttempts =
    typeof assignment.max_attempts === 'number' && assignment.max_attempts > 0
      ? assignment.max_attempts
      : DEFAULT_MAX_ATTEMPTS;
  if (nextAttempt > maxAttempts) {
    return { ok: false, reason: 'max_attempts_reached' };
  }

  // 5. Due-date lockout (item 3.9). Product-policy default: ACCEPT + flag
  //    late, unless the assignment explicitly disallows late submission.
  const isLate = isPastDue(assignment.due_date);
  if (isLate && assignment.allow_late_submission === false) {
    return { ok: false, reason: 'submission_closed' };
  }

  const nowIso = new Date().toISOString();
  const { data: upserted, error: upsertErr } = await admin
    .from('assignment_submissions')
    .upsert(
      {
        assignment_id: assignmentId,
        student_id: studentId,
        attempt_number: nextAttempt,
        questions_total: total,
        questions_correct: correct,
        score: scorePercent,
        time_spent_seconds: timeSpent,
        status: 'submitted',
        submitted_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'assignment_id,student_id,attempt_number' },
    )
    .select('id')
    .maybeSingle();
  if (upsertErr) return { ok: false, reason: 'db_error', message: upsertErr.message };
  const row = upserted as { id: string } | null;

  const bestScorePercent = Math.max(
    scorePercent,
    ...history.map((r) => (typeof r.score === 'number' ? r.score : -Infinity)),
  );

  return {
    ok: true,
    submissionId: row?.id ?? '',
    status: 'submitted',
    scorePercent,
    attemptNumber: nextAttempt,
    bestScorePercent,
    isLateSubmission: isLate,
  };
}

/** `now() > due_date`. A null/unparseable due_date means "no deadline" — never late. */
function isPastDue(dueDateIso: string | null): boolean {
  if (!dueDateIso) return false;
  const dueDateMs = Date.parse(dueDateIso);
  if (!Number.isFinite(dueDateMs)) return false;
  return Date.now() > dueDateMs;
}
