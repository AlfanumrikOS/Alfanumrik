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
 * Idempotent: since `assignment_submissions` has no `quiz_sessions.id`
 * column, this module upserts on the table's real unique key
 * (assignment_id, student_id, attempt_number). Attempt tracking beyond a
 * single attempt (attempt_number=1) is deferred — `max_attempts` on
 * `assignments` is read but not yet enforced here (first-cut).
 *
 * A submission that a teacher has ALREADY graded (graded_at set) is never
 * silently overwritten — this returns { alreadyGraded: true } instead so a
 * duplicate completion call can't clobber teacher feedback/score overrides.
 */

export interface AssignmentCompletionInput {
  assignmentId: string;
  studentId: string;
  sessionId: string;
}

export type AssignmentCompletionResult =
  | { ok: true; submissionId: string; status: 'submitted'; scorePercent: number }
  | { ok: false; reason: 'assignment_not_found' }
  | { ok: false; reason: 'not_enrolled' }
  | { ok: false; reason: 'session_not_found' }
  | { ok: false; reason: 'session_incomplete' }
  | { ok: false; reason: 'already_graded' }
  | { ok: false; reason: 'db_error'; message: string };

interface MinimalSupabaseClient {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): {
        eq(col: string, val: unknown): {
          maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
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

export async function completeAssignmentFromSession(
  admin: MinimalSupabaseClient,
  input: AssignmentCompletionInput,
): Promise<AssignmentCompletionResult> {
  const { assignmentId, studentId, sessionId } = input;

  // 1. Assignment must exist.
  const { data: assignmentRaw, error: assignmentErr } = await admin
    .from('assignments')
    .select('id, class_id')
    .eq('id', assignmentId)
    .maybeSingle();
  if (assignmentErr) return { ok: false, reason: 'db_error', message: assignmentErr.message };
  const assignment = assignmentRaw as { id: string; class_id: string | null } | null;
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

  // 4. Never clobber an already-graded submission.
  const { data: existingRaw, error: existingErr } = await admin
    .from('assignment_submissions')
    .select('id, graded_at')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (existingErr) return { ok: false, reason: 'db_error', message: existingErr.message };
  const existing = existingRaw as { id: string; graded_at: string | null } | null;
  if (existing?.graded_at) return { ok: false, reason: 'already_graded' };

  const nowIso = new Date().toISOString();
  const { data: upserted, error: upsertErr } = await admin
    .from('assignment_submissions')
    .upsert(
      {
        assignment_id: assignmentId,
        student_id: studentId,
        attempt_number: 1,
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

  return {
    ok: true,
    submissionId: row?.id ?? existing?.id ?? '',
    status: 'submitted',
    scorePercent,
  };
}
