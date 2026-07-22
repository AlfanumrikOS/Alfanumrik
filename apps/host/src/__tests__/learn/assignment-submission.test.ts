/**
 * completeAssignmentFromSession — pure helper backing
 * POST /api/student/assignments/[id]/complete.
 *
 * Pins:
 *   1. assignment must exist.
 *   2. student must be an ACTIVE member of the assignment's class — this is
 *      the actual ownership boundary (RLS on assignment_submissions alone
 *      only checks student_id, not class membership).
 *   3. the quiz_sessions row must belong to the SAME student and be
 *      completed — a session id cannot be borrowed cross-student.
 *   4. score/correct/total are read VERBATIM from quiz_sessions — no
 *      (correct/total)*100 recomputation here (P1 boundary).
 *   5. an already-graded REPLAY is never clobbered; a NEW attempt after a
 *      graded one is allowed (up to max_attempts).
 *   6. happy path upserts on (assignment_id, student_id, attempt_number).
 *   7. multi-attempt (item 3.8): each genuine new attempt gets the NEXT
 *      attempt_number, capped by assignments.max_attempts (409 once exceeded).
 *   8. due-date lockout (item 3.9): past due_date -> accept-and-flag-late by
 *      default; allow_late_submission === false -> reject (409).
 *   9. idempotent replay: a retried request for the SAME completion (same
 *      scores, within the dedupe window) never burns an extra attempt.
 */
import { describe, it, expect, vi } from 'vitest';
import { completeAssignmentFromSession } from '@alfanumrik/lib/learn/assignment-submission';

const ASSIGNMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STUDENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_STUDENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLASS_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SESSION_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

/** Minimal chained-query fake matching the module's MinimalSupabaseClient shape. */
function makeAdmin(responses: {
  assignments?: { data: unknown; error: { message: string } | null };
  class_students?: { data: unknown; error: { message: string } | null };
  quiz_sessions?: { data: unknown; error: { message: string } | null };
  /** assignment_submissions history query (.order(), no .maybeSingle()) — an
   *  ARRAY of every prior attempt row for (assignment_id, student_id). */
  assignment_submissions_history?: { data: unknown[] | null; error: { message: string } | null };
  assignment_submissions_upsert?: { data: unknown; error: { message: string } | null };
}) {
  const upsertSpy = vi.fn().mockReturnValue({
    select: () => ({
      maybeSingle: async () =>
        responses.assignment_submissions_upsert ?? { data: { id: 'sub-1' }, error: null },
    }),
  });

  const from = vi.fn((table: string) => {
    if (table === 'assignments') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => responses.assignments ?? { data: null, error: null },
          }),
        }),
      };
    }
    if (table === 'class_students') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => responses.class_students ?? { data: null, error: null },
            }),
          }),
        }),
      };
    }
    if (table === 'quiz_sessions') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => responses.quiz_sessions ?? { data: null, error: null },
            }),
          }),
        }),
      };
    }
    if (table === 'assignment_submissions') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: async () => responses.assignment_submissions_history ?? { data: [], error: null },
            }),
          }),
        }),
        upsert: upsertSpy,
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { from, __upsertSpy: upsertSpy } as unknown as Parameters<typeof completeAssignmentFromSession>[0] & {
    __upsertSpy: typeof upsertSpy;
  };
}

describe('completeAssignmentFromSession', () => {
  it('assignment_not_found when the assignment row does not exist', async () => {
    const admin = makeAdmin({ assignments: { data: null, error: null } });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({ ok: false, reason: 'assignment_not_found' });
  });

  it('not_enrolled when the student is not an active member of the class (cross-student/class boundary)', async () => {
    const admin = makeAdmin({
      assignments: { data: { id: ASSIGNMENT_ID, class_id: CLASS_ID }, error: null },
      class_students: { data: null, error: null }, // no active enrollment row
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: OTHER_STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({ ok: false, reason: 'not_enrolled' });
  });

  it('session_not_found when the session does not belong to this student', async () => {
    const admin = makeAdmin({
      assignments: { data: { id: ASSIGNMENT_ID, class_id: CLASS_ID }, error: null },
      class_students: { data: { id: 'link-1' }, error: null },
      quiz_sessions: { data: null, error: null }, // query filters student_id=studentId — a foreign session id returns null
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({ ok: false, reason: 'session_not_found' });
  });

  it('session_incomplete when the session has not finished', async () => {
    const admin = makeAdmin({
      assignments: { data: { id: ASSIGNMENT_ID, class_id: CLASS_ID }, error: null },
      class_students: { data: { id: 'link-1' }, error: null },
      quiz_sessions: {
        data: { id: SESSION_ID, student_id: STUDENT_ID, total_questions: 10, correct_answers: 0, score_percent: 0, time_spent_seconds: 0, time_taken_seconds: 0, is_completed: false },
        error: null,
      },
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({ ok: false, reason: 'session_incomplete' });
  });

  it('already_graded refuses to clobber a REPLAYED (byte-identical, in-window) teacher-reviewed submission', async () => {
    const nowIso = new Date().toISOString(); // within the replay dedupe window
    const admin = makeAdmin({
      assignments: { data: { id: ASSIGNMENT_ID, class_id: CLASS_ID }, error: null },
      class_students: { data: { id: 'link-1' }, error: null },
      quiz_sessions: {
        data: { id: SESSION_ID, student_id: STUDENT_ID, total_questions: 10, correct_answers: 8, score_percent: 80, time_spent_seconds: 300, time_taken_seconds: 300, is_completed: true },
        error: null,
      },
      assignment_submissions_history: {
        data: [{
          id: 'sub-1', attempt_number: 1, questions_total: 10, questions_correct: 8, score: 80,
          graded_at: '2026-07-20T00:00:00.000Z', submitted_at: nowIso,
        }],
        error: null,
      },
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({ ok: false, reason: 'already_graded' });
    expect((admin as unknown as { __upsertSpy: ReturnType<typeof vi.fn> }).__upsertSpy).not.toHaveBeenCalled();
  });

  it('happy path: upserts score/correct/total VERBATIM from quiz_sessions (no recompute) as attempt 1 when there is no history', async () => {
    const admin = makeAdmin({
      assignments: { data: { id: ASSIGNMENT_ID, class_id: CLASS_ID }, error: null },
      class_students: { data: { id: 'link-1' }, error: null },
      quiz_sessions: {
        data: { id: SESSION_ID, student_id: STUDENT_ID, total_questions: 10, correct_answers: 7, score_percent: 70, time_spent_seconds: 420, time_taken_seconds: 420, is_completed: true },
        error: null,
      },
      assignment_submissions_history: { data: [], error: null },
      assignment_submissions_upsert: { data: { id: 'sub-new' }, error: null },
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({
      ok: true, submissionId: 'sub-new', status: 'submitted', scorePercent: 70,
      attemptNumber: 1, bestScorePercent: 70, isLateSubmission: false,
    });

    const upsertSpy = (admin as unknown as { __upsertSpy: ReturnType<typeof vi.fn> }).__upsertSpy;
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        assignment_id: ASSIGNMENT_ID,
        student_id: STUDENT_ID,
        attempt_number: 1,
        questions_total: 10,
        questions_correct: 7,
        score: 70,
        status: 'submitted',
      }),
      { onConflict: 'assignment_id,student_id,attempt_number' },
    );
  });

  it('multi-attempt (item 3.8): a genuinely DIFFERENT second attempt gets attempt_number=2 and reports the best score across both', async () => {
    const admin = makeAdmin({
      assignments: { data: { id: ASSIGNMENT_ID, class_id: CLASS_ID, max_attempts: 3 }, error: null },
      class_students: { data: { id: 'link-1' }, error: null },
      quiz_sessions: {
        data: { id: SESSION_ID, student_id: STUDENT_ID, total_questions: 10, correct_answers: 9, score_percent: 90, time_spent_seconds: 200, time_taken_seconds: 200, is_completed: true },
        error: null,
      },
      // Prior attempt 1 scored 70 (different total/correct/score AND far outside
      // the replay window) — this is a genuine second attempt, not a replay.
      assignment_submissions_history: {
        data: [{
          id: 'sub-1', attempt_number: 1, questions_total: 10, questions_correct: 7, score: 70,
          graded_at: null, submitted_at: new Date(Date.now() - 60_000).toISOString(),
        }],
        error: null,
      },
      assignment_submissions_upsert: { data: { id: 'sub-2' }, error: null },
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({
      ok: true, submissionId: 'sub-2', status: 'submitted', scorePercent: 90,
      attemptNumber: 2, bestScorePercent: 90, isLateSubmission: false,
    });
    const upsertSpy = (admin as unknown as { __upsertSpy: ReturnType<typeof vi.fn> }).__upsertSpy;
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ attempt_number: 2, score: 90 }),
      { onConflict: 'assignment_id,student_id,attempt_number' },
    );
  });

  it('max_attempts_reached (item 3.8): the next attempt would exceed assignments.max_attempts', async () => {
    const admin = makeAdmin({
      assignments: { data: { id: ASSIGNMENT_ID, class_id: CLASS_ID, max_attempts: 2 }, error: null },
      class_students: { data: { id: 'link-1' }, error: null },
      quiz_sessions: {
        data: { id: SESSION_ID, student_id: STUDENT_ID, total_questions: 10, correct_answers: 5, score_percent: 50, time_spent_seconds: 100, time_taken_seconds: 100, is_completed: true },
        error: null,
      },
      // Already 2 attempts on record (the cap) — a genuinely new 3rd attempt
      // (different scores, outside the replay window) must be rejected.
      assignment_submissions_history: {
        data: [
          { id: 'sub-1', attempt_number: 1, questions_total: 10, questions_correct: 6, score: 60, graded_at: null, submitted_at: new Date(Date.now() - 120_000).toISOString() },
          { id: 'sub-2', attempt_number: 2, questions_total: 10, questions_correct: 7, score: 70, graded_at: null, submitted_at: new Date(Date.now() - 60_000).toISOString() },
        ],
        error: null,
      },
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({ ok: false, reason: 'max_attempts_reached' });
    expect((admin as unknown as { __upsertSpy: ReturnType<typeof vi.fn> }).__upsertSpy).not.toHaveBeenCalled();
  });

  it('due-date lockout (item 3.9): past due_date + allow_late_submission=false -> submission_closed (409)', async () => {
    const admin = makeAdmin({
      assignments: {
        data: {
          id: ASSIGNMENT_ID, class_id: CLASS_ID,
          due_date: new Date(Date.now() - 24 * 3_600_000).toISOString(), // yesterday
          allow_late_submission: false,
        },
        error: null,
      },
      class_students: { data: { id: 'link-1' }, error: null },
      quiz_sessions: {
        data: { id: SESSION_ID, student_id: STUDENT_ID, total_questions: 10, correct_answers: 7, score_percent: 70, time_spent_seconds: 420, time_taken_seconds: 420, is_completed: true },
        error: null,
      },
      assignment_submissions_history: { data: [], error: null },
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({ ok: false, reason: 'submission_closed' });
    expect((admin as unknown as { __upsertSpy: ReturnType<typeof vi.fn> }).__upsertSpy).not.toHaveBeenCalled();
  });

  it('due-date lockout (item 3.9): past due_date + allow_late_submission left at the schema default (true) -> ACCEPTS and flags isLateSubmission', async () => {
    const admin = makeAdmin({
      assignments: {
        data: {
          id: ASSIGNMENT_ID, class_id: CLASS_ID,
          due_date: new Date(Date.now() - 24 * 3_600_000).toISOString(), // yesterday
          allow_late_submission: true,
        },
        error: null,
      },
      class_students: { data: { id: 'link-1' }, error: null },
      quiz_sessions: {
        data: { id: SESSION_ID, student_id: STUDENT_ID, total_questions: 10, correct_answers: 7, score_percent: 70, time_spent_seconds: 420, time_taken_seconds: 420, is_completed: true },
        error: null,
      },
      assignment_submissions_history: { data: [], error: null },
      assignment_submissions_upsert: { data: { id: 'sub-late' }, error: null },
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({
      ok: true, submissionId: 'sub-late', status: 'submitted', scorePercent: 70,
      attemptNumber: 1, bestScorePercent: 70, isLateSubmission: true,
    });
  });

  it('idempotent replay: a retry of the SAME completion (identical scores, within the dedupe window) does NOT burn a second attempt slot', async () => {
    const admin = makeAdmin({
      assignments: { data: { id: ASSIGNMENT_ID, class_id: CLASS_ID, max_attempts: 3 }, error: null },
      class_students: { data: { id: 'link-1' }, error: null },
      quiz_sessions: {
        data: { id: SESSION_ID, student_id: STUDENT_ID, total_questions: 10, correct_answers: 7, score_percent: 70, time_spent_seconds: 420, time_taken_seconds: 420, is_completed: true },
        error: null,
      },
      // Prior attempt 1: SAME total/correct/score, submitted 2s ago (well
      // within REPLAY_DEDUPE_WINDOW_MS) and NOT graded — a replay.
      assignment_submissions_history: {
        data: [{
          id: 'sub-1', attempt_number: 1, questions_total: 10, questions_correct: 7, score: 70,
          graded_at: null, submitted_at: new Date(Date.now() - 2_000).toISOString(),
        }],
        error: null,
      },
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({
      ok: true, submissionId: 'sub-1', status: 'submitted', scorePercent: 70,
      attemptNumber: 1, bestScorePercent: 70, isLateSubmission: false,
    });
    // No new row was written — the replay is a no-op read, not a write.
    expect((admin as unknown as { __upsertSpy: ReturnType<typeof vi.fn> }).__upsertSpy).not.toHaveBeenCalled();
  });

  it('db_error surfaces the underlying message without throwing', async () => {
    const admin = makeAdmin({
      assignments: { data: null, error: { message: 'connection reset' } },
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({ ok: false, reason: 'db_error', message: 'connection reset' });
  });
});
