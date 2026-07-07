/**
 * POST /api/teacher/classes
 *
 * Phase B.5 (ADR-005). Replaces the direct `supabase.rpc('teacher_create_class', …)`
 * call in src/app/teacher/classes/page.tsx. The route:
 *   1. Authorizes the caller with `class.manage`.
 *   2. Resolves the authenticated teacher row from `auth_user_id`.
 *   3. Invokes the legacy `teacher_create_class(...)` RPC (which inserts the
 *      `classes` row AND the `class_teachers` link row in one SECURITY DEFINER
 *      transaction).
 *   4. Emits a `teacher.classroom_created` `state_event` so downstream
 *      subscribers (audit, analytics, notifications) can react.
 *
 * Body:
 *   { name: string, grade: string, section?: string, subject?: string }
 *
 * Response 200:
 *   { success: true, classId: string, classCode: string }
 *
 * Errors:
 *   400 invalid body  · 401 unauthenticated  · 403 missing permission /
 *   teacher row not found  · 500 db error
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { publishEvent } from '@alfanumrik/lib/state/events/publish';

const BodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'name must be 2–100 characters')
    .max(100, 'name must be 2–100 characters')
    .regex(/^[a-zA-Z0-9\s\-_().]+$/, 'name contains invalid characters'),
  grade: z.string().trim().min(1).max(4),
  section: z.string().trim().max(4).nullable().optional(),
  subject: z.string().trim().max(64).nullable().optional(),
});

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  // Parse + validate body.
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }
  const { name, grade, section, subject } = parsed;

  // Resolve teacher id from auth user.
  const { data: teacher, error: teacherErr } = await supabaseAdmin
    .from('teachers')
    .select('id, school_id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (teacherErr) {
    logger.error('teacher_classes_teacher_lookup_failed', {
      error: new Error(teacherErr.message),
      route: 'teacher/classes',
    });
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  // Call the existing SECURITY DEFINER RPC — it remains the canonical
  // INSERT for now (the legacy class_teachers fan-out + class_code
  // generation already live inside it). Future work: extract into a
  // projector once a non-teacher creator path emerges.
  const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('teacher_create_class', {
    p_teacher_id: teacher.id,
    p_name: name,
    p_grade: grade,
    p_section: section ?? null,
    p_subject: subject ?? null,
  });
  if (rpcErr) {
    logger.error('teacher_create_class_rpc_failed', {
      error: new Error(rpcErr.message),
      route: 'teacher/classes',
    });
    return err('Failed to create class', 500);
  }

  const classId = (rpcData as { class_id?: string } | null)?.class_id;
  const classCode = (rpcData as { class_code?: string } | null)?.class_code;
  if (!classId || !classCode) {
    logger.error('teacher_create_class_rpc_bad_response', {
      error: new Error('rpc returned no class_id / class_code'),
      route: 'teacher/classes',
    });
    return err('Failed to create class', 500);
  }

  // Emit `teacher.classroom_created`. Gated by ff_event_bus_v1 inside
  // publishEvent — never blocks the response.
  try {
    await publishEvent(supabaseAdmin, {
      kind: 'teacher.classroom_created',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: auth.userId!,
      tenantId: (teacher as { school_id?: string | null }).school_id ?? null,
      idempotencyKey: `classroom_created:${classId}`,
      payload: {
        classId,
        teacherId: teacher.id,
        name,
        grade,
        section: section ?? null,
        subjectCode: subject ?? null,
        classCode,
      },
    });
  } catch (e) {
    logger.warn('teacher_classroom_created_publish_failed', {
      route: 'teacher/classes',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({ success: true, classId, classCode });
}
