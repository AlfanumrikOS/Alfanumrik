/**
 * PATCH /api/student/profile
 *
 * Updates mutable student profile fields.
 * Replaces direct anon-client write in profile/page.tsx.
 *
 * ALWAYS WRITABLE:
 *   preferred_language, preferred_subject, academic_goal,
 *   school_name, city, state, daily_study_hours,
 *   phone, parent_name, parent_phone
 *
 * CONDITIONAL:
 *   name  — writable max once (enforced server-side)
 *   board — writable only if student has no quiz history
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
const ALLOWED_GOALS = ['board_topper', 'school_topper', 'pass_comfortably', 'competitive_exam', 'olympiad', 'improve_basics'];
const ALLOWED_SUBJECTS = ['math', 'science', 'physics', 'chemistry', 'biology', 'english', 'hindi', 'social_studies', 'coding'];

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

  // academic_goal — always writable, must be a known value or null
  const { academic_goal, preferred_subject, school_name, city, state, daily_study_hours, phone, parent_name, parent_phone } = body;

  if (academic_goal !== undefined) {
    if (academic_goal === null || academic_goal === '') {
      updatePayload.academic_goal = null;
    } else if (typeof academic_goal === 'string' && ALLOWED_GOALS.includes(academic_goal)) {
      updatePayload.academic_goal = academic_goal;
    } else {
      return err(`academic_goal must be one of: ${ALLOWED_GOALS.join(', ')}`, 400);
    }
  }

  // preferred_subject — always writable
  if (preferred_subject !== undefined) {
    if (typeof preferred_subject === 'string' && ALLOWED_SUBJECTS.includes(preferred_subject)) {
      updatePayload.preferred_subject = preferred_subject;
    } else if (preferred_subject === null || preferred_subject === '') {
      updatePayload.preferred_subject = null;
    } else {
      return err(`preferred_subject must be one of: ${ALLOWED_SUBJECTS.join(', ')}`, 400);
    }
  }

  // Free-text profile fields — sanitize length
  if (school_name !== undefined) {
    updatePayload.school_name = typeof school_name === 'string' && school_name.trim() ? school_name.trim().slice(0, 100) : null;
  }
  if (city !== undefined) {
    updatePayload.city = typeof city === 'string' && city.trim() ? city.trim().slice(0, 50) : null;
  }
  if (state !== undefined) {
    updatePayload.state = typeof state === 'string' && state.trim() ? state.trim().slice(0, 50) : null;
  }
  if (daily_study_hours !== undefined) {
    const hours = typeof daily_study_hours === 'number' ? daily_study_hours : parseInt(String(daily_study_hours), 10);
    if (!isNaN(hours) && hours >= 1 && hours <= 16) {
      updatePayload.daily_study_hours = hours;
    }
  }
  if (phone !== undefined) {
    updatePayload.phone = typeof phone === 'string' && phone.trim() ? phone.trim().slice(0, 20) : null;
  }
  if (parent_name !== undefined) {
    updatePayload.parent_name = typeof parent_name === 'string' && parent_name.trim() ? parent_name.trim().slice(0, 100) : null;
  }
  if (parent_phone !== undefined) {
    updatePayload.parent_phone = typeof parent_phone === 'string' && parent_phone.trim() ? parent_phone.trim().slice(0, 20) : null;
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
