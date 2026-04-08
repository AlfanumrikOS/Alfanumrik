/**
 * PATCH /api/student/profile
 *
 * Updates mutable student profile fields: name, board, preferred_language.
 * Replaces direct anon-client write in profile/page.tsx.
 *
 * WHY:
 *   - Client passed student.id from client state — no server-side ownership check
 *   - name_change_count was computed client-side and passed to DB — should be
 *     computed server-side to prevent replay attacks that reset the counter
 *   - board update guard ("hasQuizHistory") was client-side logic only
 *
 * FIELDS:
 *   preferred_language — always writable
 *   name              — writable max once (enforced server-side by DB value, not client counter)
 *   board             — writable only if student has no quiz history
 *
 * NOT WRITABLE via this route (system-managed):
 *   grade, xp_total, streak_days, subscription_plan, account_status
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const ALLOWED_LANGUAGES = ['en', 'hi'];
const ALLOWED_BOARDS = ['CBSE', 'ICSE', 'State Board'];

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function PATCH(request: NextRequest) {
  const auth = await authorizeRequest(request, 'student.profile.write', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const { preferred_language, name, board } = body;
  const studentId = auth.studentId!;

  // Fetch current student record server-side (never trust client state)
  const { data: student, error: fetchError } = await supabaseAdmin
    .from('students')
    .select('id, name, board, name_change_count')
    .eq('id', studentId)
    .single();

  if (fetchError || !student) {
    return err('Student not found', 404);
  }

  const updatePayload: Record<string, unknown> = {};

  // preferred_language — always allowed
  if (preferred_language !== undefined) {
    if (typeof preferred_language !== 'string' || !ALLOWED_LANGUAGES.includes(preferred_language)) {
      return err(`preferred_language must be one of: ${ALLOWED_LANGUAGES.join(', ')}`, 400);
    }
    updatePayload.preferred_language = preferred_language;
  }

  // name — max 1 change, enforced by server-side name_change_count
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return err('name cannot be empty', 400);
    if (name.trim().length > 100) return err('name cannot exceed 100 characters', 400);

    const trimmedName = name.trim();
    if (trimmedName !== student.name) {
      const changeCount = student.name_change_count ?? 0;
      if (changeCount >= 1) {
        return err('Name can only be changed once', 403);
      }
      updatePayload.name = trimmedName;
      updatePayload.name_change_count = changeCount + 1; // server-side increment
    }
  }

  // board — only if no quiz history (check server-side)
  if (board !== undefined && board !== student.board) {
    if (typeof board !== 'string' || !ALLOWED_BOARDS.includes(board)) {
      return err(`board must be one of: ${ALLOWED_BOARDS.join(', ')}`, 400);
    }

    const { count: quizCount } = await supabaseAdmin
      .from('quiz_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', studentId);

    if ((quizCount ?? 0) > 0) {
      return err('Board cannot be changed after quiz history exists', 403);
    }
    updatePayload.board = board;
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ success: true, message: 'No changes' });
  }

  const { error: updateError } = await supabaseAdmin
    .from('students')
    .update(updatePayload)
    .eq('id', studentId);

  if (updateError) {
    logger.error('student_profile_update_failed', {
      error: new Error(updateError.message),
      studentId,
    });
    return err('Failed to update profile', 500);
  }

  return NextResponse.json({ success: true });
}
