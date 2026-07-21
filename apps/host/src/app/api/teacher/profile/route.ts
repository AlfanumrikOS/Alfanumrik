/**
 * PATCH /api/teacher/profile
 *
 * Updates teacher profile: name, school_name.
 * Replaces direct anon-client write in teacher/profile/page.tsx.
 *
 * Auth (P9): authorizeRequest(request, 'profile.update_own'). That permission
 * is already granted to the `teacher` role in the RBAC matrix
 * (20260612123200_rbac_matrix_conformance.sql) — the same code the sibling
 * `parent`/`student` profile routes use — so NO new permission code is
 * introduced. This route previously bypassed authorizeRequest entirely with a
 * raw hand-rolled Bearer-token check via supabaseAdmin's auth client; it now
 * follows the same house pattern every other teacher route uses. authorizeRequest accepts both
 * the Bearer JWT this route previously parsed by hand AND the Supabase cookie
 * session, so existing callers keep working.
 *
 * Self-scope (no IDOR): the update target is the caller's OWN teacher row,
 * resolved from the authorizeRequest-verified auth.userId via
 * getTeacherByAuthUserId. No body-supplied id is ever used to select the row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { getTeacherByAuthUserId } from '@alfanumrik/lib/domains/identity';
import { logger } from '@alfanumrik/lib/logger';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function PATCH(request: NextRequest) {
  // P9: authenticated session + permission gate (granted to the teacher role).
  const auth = await authorizeRequest(request, 'profile.update_own');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const teacherResult = await getTeacherByAuthUserId(auth.userId!);
  if (!teacherResult.ok || !teacherResult.data) {
    return err('Teacher account not found', 404);
  }
  const teacherId = teacherResult.data.id;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return err('Invalid request body', 400); }

  const { name, school_name } = body;
  const updatePayload: Record<string, string> = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return err('name must be 2–100 characters', 400);
    }
    updatePayload.name = name.trim();
  }

  if (school_name !== undefined) {
    if (typeof school_name !== 'string' || school_name.trim().length > 200) {
      return err('school_name cannot exceed 200 characters', 400);
    }
    updatePayload.school_name = school_name.trim();
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ success: true, message: 'No changes' });
  }

  const { error } = await supabaseAdmin.from('teachers').update(updatePayload).eq('id', teacherId);
  if (error) {
    logger.error('teacher_profile_update_failed', { error: new Error(error.message), teacherId });
    return err('Failed to update profile', 500);
  }

  return NextResponse.json({ success: true });
}
