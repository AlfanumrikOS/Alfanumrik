/**
 * PATCH /api/teacher/profile
 *
 * Updates teacher profile: name, school_name.
 * Replaces direct anon-client write in teacher/profile/page.tsx.
 *
 * Auth: JWT → auth_user_id → teachers.auth_user_id lookup (ownership enforced server-side)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function resolveTeacherId(authUserId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('teachers')
    .select('id')
    .eq('auth_user_id', authUserId)
    .single();
  return data?.id ?? null;
}

export async function PATCH(request: NextRequest) {
  // Resolve auth user from JWT
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return err('Unauthorized', 401);
  const token = authHeader.slice(7);

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return err('Invalid or expired token', 401);

  const teacherId = await resolveTeacherId(user.id);
  if (!teacherId) return err('Teacher account not found', 404);

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
