/**
 * GET /api/teacher/classes/available?code=XXXX
 *
 * Track B, Feature 2 — a teacher PREVIEWS a class by its `class_code` before
 * joining. Returns minimal, non-PII class metadata (school name, class name,
 * grade, section) so the teacher can confirm they're joining the right class.
 *
 * Auth: authenticated teacher (class.manage — held by the teacher role).
 *
 * Tenant note: a class_code is the join secret; previewing it requires only
 * that the caller is a teacher. No student rosters, no PII, no school_id is
 * trusted from the caller — the school is whatever owns the code.
 *
 * Response: { success: true, data: { classId, name, grade, section,
 *             schoolName, alreadyJoined } }
 *           { success: false, error }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

const CodeSchema = z
  .string()
  .trim()
  .min(4, 'code is required')
  .max(64, 'code is too long')
  .regex(/^[a-zA-Z0-9\-_]+$/, 'code contains invalid characters');

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const url = new URL(request.url);
  let code: string;
  try {
    code = CodeSchema.parse(url.searchParams.get('code') ?? '');
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid code' : 'Invalid code';
    return err(msg, 400);
  }

  // Resolve the calling teacher (so we can report alreadyJoined).
  const { data: teacher, error: teacherErr } = await supabaseAdmin
    .from('teachers')
    .select('id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (teacherErr) {
    logger.error('teacher_classes_available_teacher_lookup_failed', {
      error: new Error(teacherErr.message),
      route: 'teacher/classes/available',
    });
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  // Look up the class by code. Active, non-deleted only.
  const { data: klass, error: classErr } = await supabaseAdmin
    .from('classes')
    .select('id, name, grade, section, school_id, is_active, deleted_at')
    .eq('class_code', code)
    .is('deleted_at', null)
    .eq('is_active', true)
    .maybeSingle();

  if (classErr) {
    logger.error('teacher_classes_available_lookup_failed', {
      error: new Error(classErr.message),
      route: 'teacher/classes/available',
    });
    return err('Failed to look up class', 500);
  }
  if (!klass) {
    // Generic 404 — never leak whether a code exists for another school.
    return err('No active class found for this code', 404);
  }

  // Resolve the owning school name (non-PII display metadata).
  let schoolName: string | null = null;
  if (klass.school_id) {
    const { data: school } = await supabaseAdmin
      .from('schools')
      .select('name')
      .eq('id', klass.school_id)
      .maybeSingle();
    schoolName = (school?.name as string | null) ?? null;
  }

  // Has this teacher already joined?
  const { data: existing } = await supabaseAdmin
    .from('class_teachers')
    .select('id')
    .eq('class_id', klass.id)
    .eq('teacher_id', teacher.id)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    data: {
      classId: klass.id,
      name: klass.name,
      grade: klass.grade, // P5: string
      section: klass.section,
      schoolName,
      alreadyJoined: !!existing,
    },
  });
}
