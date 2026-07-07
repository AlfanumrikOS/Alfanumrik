/**
 * POST /api/teacher/join-class
 *
 * Track B, Feature 2 — a teacher JOINS a class by its `class_code`. Inserts a
 * `class_teachers` link row and, if the teacher has no school yet, adopts the
 * class's owning school. Completes the teacher onboarding funnel (P15).
 *
 * Auth: authenticated teacher (class.manage — held by the teacher role).
 *
 * Tenant safety: the school is ALWAYS derived from the class the code resolves
 * to — NEVER from a body-supplied school_id (none is accepted). A teacher can
 * only ever attach to the school that owns the code they hold.
 *
 * Idempotent: class_teachers has a UNIQUE (class_id, teacher_id) constraint.
 * An already-joined teacher returns 200 (alreadyJoined: true) without error.
 *
 * Seat/role rule: the teacher joins with role 'teacher'. Class capacity
 * (`max_students`) governs STUDENT enrolment, not co-teachers, so it is not a
 * gate here.
 *
 * Body: { class_code: string }
 *
 * Response: { success: true, data: { classId, alreadyJoined } }
 *           { success: false, error }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

const BodySchema = z.object({
  class_code: z
    .string()
    .trim()
    .min(4, 'class_code is required')
    .max(64, 'class_code is too long')
    .regex(/^[a-zA-Z0-9\-_]+$/, 'class_code contains invalid characters'),
});

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  // Validate body. NOTE: no school_id is accepted from the body — tenant is
  // derived from the class the code resolves to.
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }
  const code = parsed.class_code;

  // Resolve the calling teacher.
  const { data: teacher, error: teacherErr } = await supabaseAdmin
    .from('teachers')
    .select('id, school_id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (teacherErr) {
    logger.error('teacher_join_class_teacher_lookup_failed', {
      error: new Error(teacherErr.message),
      route: 'teacher/join-class',
    });
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  // Resolve the class by code (active, non-deleted only).
  const { data: klass, error: classErr } = await supabaseAdmin
    .from('classes')
    .select('id, school_id, is_active, deleted_at')
    .eq('class_code', code)
    .is('deleted_at', null)
    .eq('is_active', true)
    .maybeSingle();
  if (classErr) {
    logger.error('teacher_join_class_lookup_failed', {
      error: new Error(classErr.message),
      route: 'teacher/join-class',
    });
    return err('Failed to look up class', 500);
  }
  if (!klass) {
    // Generic 404 — never leak whether a code exists for another school.
    return err('No active class found for this code', 404);
  }

  // Idempotency: already a member?
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('class_teachers')
    .select('id')
    .eq('class_id', klass.id)
    .eq('teacher_id', teacher.id)
    .maybeSingle();
  if (existingErr) {
    logger.error('teacher_join_class_membership_check_failed', {
      error: new Error(existingErr.message),
      route: 'teacher/join-class',
    });
    return err('Failed to verify membership', 500);
  }

  if (existing) {
    // Already joined — idempotent 200. Still backfill school_id if missing.
    await adoptClassSchool(teacher, klass);
    return NextResponse.json({
      success: true,
      data: { classId: klass.id, alreadyJoined: true },
    });
  }

  // Insert the membership row. Tenant is the class's school — body cannot
  // influence it. Race-safe against the UNIQUE (class_id, teacher_id) index.
  const { error: insertErr } = await supabaseAdmin.from('class_teachers').insert({
    class_id: klass.id,
    teacher_id: teacher.id,
    role: 'teacher',
    is_active: true,
  });

  if (insertErr) {
    // Unique-violation = a concurrent join won the race → idempotent success.
    const isUniqueViolation =
      (insertErr as { code?: string }).code === '23505' ||
      /duplicate key|unique/i.test(insertErr.message);
    if (isUniqueViolation) {
      await adoptClassSchool(teacher, klass);
      return NextResponse.json({
        success: true,
        data: { classId: klass.id, alreadyJoined: true },
      });
    }
    logger.error('teacher_join_class_insert_failed', {
      error: new Error(insertErr.message),
      route: 'teacher/join-class',
    });
    return err('Failed to join class', 500);
  }

  // Adopt the class's school for a teacher who hasn't got one yet.
  await adoptClassSchool(teacher, klass);

  logger.info('teacher_joined_class', {
    route: 'teacher/join-class',
    teacherId: teacher.id,
    classId: klass.id,
    schoolId: klass.school_id ?? null,
  });

  return NextResponse.json({
    success: true,
    data: { classId: klass.id, alreadyJoined: false },
  });
}

/**
 * Link the teacher's school_id to the class's school IF the teacher has none
 * yet. Tenant-safe: only ever sets the school the joined class belongs to, and
 * never overwrites an existing membership. Best-effort — never blocks the join.
 */
async function adoptClassSchool(
  teacher: { id: string; school_id: string | null },
  klass: { school_id: string | null },
): Promise<void> {
  if (teacher.school_id || !klass.school_id) return;
  try {
    await supabaseAdmin
      .from('teachers')
      .update({ school_id: klass.school_id, updated_at: new Date().toISOString() })
      .eq('id', teacher.id)
      .is('school_id', null); // guard: only when still unset (race-safe)
  } catch (e) {
    logger.warn('teacher_join_class_school_adopt_failed', {
      route: 'teacher/join-class',
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}
