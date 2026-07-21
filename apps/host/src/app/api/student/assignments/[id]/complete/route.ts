/**
 * POST /api/student/assignments/[id]/complete
 *
 * Student-side completion seam for a teacher-created assignment. Mirrors the
 * existing /api/rhythm/remediation/[id]/resolve pattern: the assignment is
 * completed as a NORMAL student quiz (P1/P2/P3/P4 scoring/XP path untouched),
 * and this route only records that already-graded quiz_sessions row into
 * assignment_submissions so the teacher's existing grading UI
 * (apps/host/src/app/teacher/submissions/page.tsx via the teacher-dashboard
 * Edge Function) sees it.
 *
 * Body: { session_id: string } — the quiz_sessions.id returned by
 * submitQuizResults() for the just-completed quiz.
 *
 * Auth: `quiz.attempt` + requireStudentId (student's internal students.id is
 * resolved from auth.uid() server-side — never trusted from the client).
 *
 * All ownership/business logic lives in the pure, unit-tested helper
 * `completeAssignmentFromSession` (@alfanumrik/lib/learn/assignment-submission)
 * so this route stays a thin wire-up, same shape as the remediation-resolve
 * route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { completeAssignmentFromSession } from '@alfanumrik/lib/learn/assignment-submission';
import { logger } from '@alfanumrik/lib/logger';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeRequest(request, 'quiz.attempt', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;
  if (!auth.studentId) return err('No student profile linked to this account', 403);

  const { id: assignmentId } = await context.params;
  if (!assignmentId || !UUID_RE.test(assignmentId)) return err('Invalid assignment id', 400);

  let sessionId: string;
  try {
    const body = await request.json();
    sessionId = String(body?.session_id ?? '');
  } catch {
    return err('Invalid body', 400);
  }
  if (!sessionId || !UUID_RE.test(sessionId)) return err('session_id required', 400);

  const admin = getSupabaseAdmin();
  const result = await completeAssignmentFromSession(admin as never, {
    assignmentId,
    studentId: auth.studentId,
    sessionId,
  });

  if (result.ok) {
    return NextResponse.json({
      success: true,
      status: result.status,
      submissionId: result.submissionId,
      scorePercent: result.scorePercent,
    });
  }

  switch (result.reason) {
    case 'assignment_not_found':
      return err('Assignment not found', 404);
    case 'not_enrolled':
      return err('This assignment is not assigned to you', 403);
    case 'session_not_found':
      return err('Quiz session not found', 404);
    case 'session_incomplete':
      return err('Quiz session is not complete', 400);
    case 'already_graded':
      // Idempotent-friendly: the teacher already reviewed this submission —
      // treat as a soft success rather than an error banner for the student.
      return NextResponse.json({ success: true, status: 'already_graded' });
    case 'db_error':
      logger.error('student_assignment_complete_failed', {
        error: new Error(result.message),
        route: 'student/assignments/[id]/complete',
      });
      return err('Failed to record assignment completion', 500);
    default:
      return err('Failed to record assignment completion', 500);
  }
}
