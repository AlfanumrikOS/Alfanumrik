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
 *   5. an already-graded submission is never clobbered.
 *   6. happy path upserts on (assignment_id, student_id, attempt_number).
 */
import { describe, it, expect, vi } from 'vitest';
import { completeAssignmentFromSession } from '@alfanumrik/lib/learn/assignment-submission';

const ASSIGNMENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STUDENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_STUDENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLASS_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SESSION_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

interface FakeTable {
  select: () => { eq: (c: string, v: unknown) => unknown };
  upsert: (row: Record<string, unknown>, opts: unknown) => unknown;
}

/** Minimal chained-query fake matching the module's MinimalSupabaseClient shape. */
function makeAdmin(responses: {
  assignments?: { data: unknown; error: { message: string } | null };
  class_students?: { data: unknown; error: { message: string } | null };
  quiz_sessions?: { data: unknown; error: { message: string } | null };
  assignment_submissions_select?: { data: unknown; error: { message: string } | null };
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
              maybeSingle: async () =>
                responses.assignment_submissions_select ?? { data: null, error: null },
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

  it('already_graded refuses to clobber a teacher-reviewed submission', async () => {
    const admin = makeAdmin({
      assignments: { data: { id: ASSIGNMENT_ID, class_id: CLASS_ID }, error: null },
      class_students: { data: { id: 'link-1' }, error: null },
      quiz_sessions: {
        data: { id: SESSION_ID, student_id: STUDENT_ID, total_questions: 10, correct_answers: 8, score_percent: 80, time_spent_seconds: 300, time_taken_seconds: 300, is_completed: true },
        error: null,
      },
      assignment_submissions_select: { data: { id: 'sub-1', graded_at: '2026-07-20T00:00:00.000Z' }, error: null },
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({ ok: false, reason: 'already_graded' });
    expect((admin as unknown as { __upsertSpy: ReturnType<typeof vi.fn> }).__upsertSpy).not.toHaveBeenCalled();
  });

  it('happy path: upserts score/correct/total VERBATIM from quiz_sessions (no recompute) on (assignment_id, student_id, attempt_number)', async () => {
    const admin = makeAdmin({
      assignments: { data: { id: ASSIGNMENT_ID, class_id: CLASS_ID }, error: null },
      class_students: { data: { id: 'link-1' }, error: null },
      quiz_sessions: {
        data: { id: SESSION_ID, student_id: STUDENT_ID, total_questions: 10, correct_answers: 7, score_percent: 70, time_spent_seconds: 420, time_taken_seconds: 420, is_completed: true },
        error: null,
      },
      assignment_submissions_select: { data: null, error: null },
      assignment_submissions_upsert: { data: { id: 'sub-new' }, error: null },
    });
    const res = await completeAssignmentFromSession(admin, {
      assignmentId: ASSIGNMENT_ID, studentId: STUDENT_ID, sessionId: SESSION_ID,
    });
    expect(res).toEqual({ ok: true, submissionId: 'sub-new', status: 'submitted', scorePercent: 70 });

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
