/**
 * PUT /api/teacher/students/[id]/notes
 *
 * Phase B.5 (ADR-005). Upserts a teacher's note and custom goal for a
 * student in the teacher's class set. Replaces the direct
 * `supabase.from('teacher_student_notes').upsert(...)` call in
 * src/app/teacher/students/page.tsx (saveNote).
 *
 * Auth: `class.manage` permission AND `canAccessStudent(authUserId, studentId)`
 * — the student must be in one of the teacher's active classes (verified
 * via the `is_teacher_of_student` RPC inside the RBAC helper).
 *
 * Body: { note?: string, customGoal?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorizeRequest, canAccessStudent } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { publishEvent } from '@/lib/state/events/publish';

const BodySchema = z.object({
  note: z.string().max(4000).optional(),
  customGoal: z.string().max(2000).optional(),
});

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { id: studentId } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(studentId)) return err('Invalid student id', 400);

  // Body
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }

  // Cross-tenant guard: the student must be in this teacher's resolved
  // set. canAccessStudent traverses class_teachers + class_enrollments
  // via the existing RBAC helper.
  const canAccess = await canAccessStudent(auth.userId!, studentId);
  if (!canAccess) return err('Forbidden', 403);

  // Resolve teacher id.
  const { data: teacher, error: teacherErr } = await supabaseAdmin
    .from('teachers')
    .select('id, school_id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (teacherErr) {
    logger.error('teacher_student_notes_teacher_lookup_failed', {
      error: new Error(teacherErr.message),
      route: 'teacher/students/[id]/notes',
    });
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  const note = body.note ?? '';
  const customGoal = body.customGoal ?? '';

  // Emit event first.
  try {
    await publishEvent(supabaseAdmin, {
      kind: 'teacher.student_note_set',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: auth.userId!,
      tenantId: (teacher as { school_id?: string | null }).school_id ?? null,
      idempotencyKey: `teacher_student_note:${teacher.id}:${studentId}:${Date.now()}`,
      payload: {
        teacherId: teacher.id,
        studentId,
        hasNote: note.trim().length > 0,
        hasGoal: customGoal.trim().length > 0,
      },
    });
  } catch (e) {
    logger.warn('teacher_student_note_publish_failed', {
      route: 'teacher/students/[id]/notes',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // TODO: extract to projector subscriber. `teacher_student_notes` is
  // a route-owned per-pair scratchpad today — small payload, low write
  // volume.
  const { error: upsertErr } = await supabaseAdmin
    .from('teacher_student_notes')
    .upsert(
      {
        teacher_id: teacher.id,
        student_id: studentId,
        note,
        custom_goal: customGoal,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'teacher_id,student_id' },
    );
  if (upsertErr) {
    logger.error('teacher_student_notes_upsert_failed', {
      error: new Error(upsertErr.message),
      route: 'teacher/students/[id]/notes',
    });
    return err('Failed to save note', 500);
  }

  return NextResponse.json({ success: true });
}
