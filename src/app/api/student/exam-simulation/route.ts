/**
 * POST /api/student/exam-simulation
 *
 * Records a completed exam simulation. Replaces the direct client-side insert
 * in quiz/page.tsx that used the anon key with no auth check.
 *
 * WHY this API route:
 *   - Direct anon insert has no auth: any authenticated user could insert
 *     exam records for any student_id
 *   - No audit trail on direct client writes
 *   - supabaseAdmin (service role) bypasses RLS; ownership is enforced here
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'quiz.attempt', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const {
    subject,
    grade,
    exam_format,
    total_marks,
    obtained_marks,
    percentage,
    time_taken_seconds,
    time_limit_seconds,
    session_id,
  } = body;

  // Input validation
  if (typeof subject !== 'string' || !subject.trim()) return err('subject required', 400);
  if (typeof grade !== 'string' || !grade.trim()) return err('grade required', 400);
  if (typeof total_marks !== 'number' || total_marks < 0) return err('total_marks must be non-negative number', 400);
  if (typeof obtained_marks !== 'number' || obtained_marks < 0) return err('obtained_marks must be non-negative number', 400);
  if (obtained_marks > total_marks) return err('obtained_marks cannot exceed total_marks', 400);
  if (typeof time_taken_seconds !== 'number' || time_taken_seconds < 0) return err('time_taken_seconds must be non-negative number', 400);

  const studentId = auth.studentId!;

  const { error } = await supabaseAdmin.from('exam_simulations').insert({
    student_id: studentId,                                     // always from auth, never from body
    subject,
    grade,
    exam_format: typeof exam_format === 'string' ? exam_format : 'cbse',
    total_marks,
    obtained_marks,
    percentage: typeof percentage === 'number' ? percentage : (total_marks > 0 ? Math.round((obtained_marks / total_marks) * 10000) / 100 : 0),
    time_taken_seconds,
    time_limit_seconds: typeof time_limit_seconds === 'number' ? time_limit_seconds : null,
    quiz_session_id: typeof session_id === 'string' ? session_id : null,
    is_completed: true,
    completed_at: new Date().toISOString(),
  });

  if (error) {
    logger.error('exam_simulation_insert_failed', {
      error: new Error(error.message),
      studentId,
      subject,
    });
    return err('Failed to record exam simulation', 500);
  }

  return NextResponse.json({ success: true });
}
