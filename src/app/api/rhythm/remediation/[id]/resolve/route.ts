/**
 * POST /api/rhythm/remediation/[id]/resolve — Phase 3A (Teacher Command
 * Center) Wave A / A3. Completion-flip seam for a teacher-assigned remediation.
 *
 * The Today completion flow calls this when the student FINISHES the practice
 * surfaced by the `teacher_remediation` queue item (the item carries the
 * `assignmentId`; the frontend / A4 threads it here). It flips the assignment
 * `assigned|in_progress → resolved` (+ `resolved_at`).
 *
 * WHY A DEDICATED ENDPOINT (least-coupled seam):
 *   - The quiz-submit path (P1/P2/P3/P4 + the RPC + submit-side-effects) stays
 *     BYTE-IDENTICAL — this route touches none of it. The assigned task is
 *     graded as a NORMAL student quiz; we only close the assignment afterward.
 *   - The assignment keys on `chapter_id` (curriculum_topics UUID), but the
 *     quiz-submit path only carries (subject, chapter-integer). Matching a
 *     completed quiz back to an assignment at the submit seam would need a
 *     fragile reverse-join. The Today item ALREADY carries `assignmentId`, so
 *     the completion flow calls this with the id directly — no reverse-mapping.
 *
 * Identity (assessment rule 5): `student_id` is the INTERNAL `students.id`,
 * resolved from `auth.uid()` by authorizeRequest(requireStudentId) — NEVER
 * `auth.uid()`. The resolve write is scoped to the owning student so a forged
 * id cannot resolve another student's assignment.
 *
 * Idempotent: an already-`resolved`/`dismissed` row returns 200 (no error) so
 * a double-tap / retry from the completion flow never fails.
 *
 * Auth: `quiz.attempt` (the student is completing a practice) + requireStudentId.
 * NO scoring / XP / anti-cheat math here (P1/P2/P3 untouched). No PII in logs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { resolveTeacherRemediation } from '@/lib/state/learner-loop/resolve-next-action';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // 1. Auth — the student must hold quiz.attempt; requireStudentId resolves the
  //    internal students.id from auth.uid() (NEVER auth.uid()).
  const auth = await authorizeRequest(request, 'quiz.attempt', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;
  if (!auth.studentId) {
    return NextResponse.json(
      { success: false, error: 'No student profile linked to this account' },
      { status: 403 },
    );
  }

  // 2. Validate the assignment id from the path.
  const { id } = await context.params;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json(
      { success: false, error: 'Invalid assignment id' },
      { status: 400 },
    );
  }

  // 3. Flip the assignment to resolved (scoped to the owning student).
  const admin = getSupabaseAdmin();
  const result = await resolveTeacherRemediation(admin, id, auth.studentId);

  if (result.notFound) {
    return NextResponse.json(
      { success: false, error: 'Remediation assignment not found' },
      { status: 404 },
    );
  }
  if (!result.ok) {
    logger.error('rhythm_remediation_resolve_failed', {
      error: new Error('resolveTeacherRemediation returned not-ok'),
      route: 'rhythm/remediation/[id]/resolve',
    });
    return NextResponse.json(
      { success: false, error: 'Failed to resolve remediation assignment' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      success: true,
      status: 'resolved',
      idempotent: result.alreadyResolved === true,
    },
    { status: 200 },
  );
}
