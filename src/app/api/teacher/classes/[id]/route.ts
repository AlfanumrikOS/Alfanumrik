/**
 * PATCH /api/teacher/classes/[id]
 *
 * Phase B.5 (ADR-005). Updates the editable fields on a class the
 * authenticated teacher owns. Replaces the direct
 * `supabase.from('classes').update(...)` write in
 * src/app/teacher/classes/page.tsx (handleSaveEdit).
 *
 * Ownership: the teacher must appear in `class_teachers` for the given
 * class id. We do not allow super-admins to drive this route — they have
 * their own school-admin surfaces for cross-school edits.
 *
 * Body: { name?: string, section?: string | null }
 *
 * The route emits `teacher.classroom_updated` and falls back to a direct
 * UPDATE of the `classes` row. `classes` is a route-owned operational
 * table (not on the no-canonical-write-outside-projector allowlist), so
 * inline writes here are intentional under ADR-005's "route-owned
 * operational/log tables" carve-out.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { publishEvent } from '@/lib/state/events/publish';

const BodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'name must be 2–100 characters')
      .max(100, 'name must be 2–100 characters')
      .regex(/^[a-zA-Z0-9\s\-_().]+$/, 'name contains invalid characters')
      .optional(),
    section: z.string().trim().max(4).nullable().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.section !== undefined,
    'At least one of name or section must be provided',
  );

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { id: classId } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(classId)) return err('Invalid class id', 400);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }

  // Resolve teacher id from auth user.
  const { data: teacher, error: teacherErr } = await supabaseAdmin
    .from('teachers')
    .select('id, school_id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (teacherErr) {
    logger.error('teacher_classes_patch_teacher_lookup_failed', {
      error: new Error(teacherErr.message),
      route: 'teacher/classes/[id]',
    });
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  // Ownership check — caller must be a teacher of this class.
  const { data: link, error: linkErr } = await supabaseAdmin
    .from('class_teachers')
    .select('class_id')
    .eq('class_id', classId)
    .eq('teacher_id', teacher.id)
    .maybeSingle();
  if (linkErr) {
    logger.error('teacher_classes_patch_link_lookup_failed', {
      error: new Error(linkErr.message),
      route: 'teacher/classes/[id]',
    });
    return err('Failed to verify class ownership', 500);
  }
  if (!link) return err('You do not own this class', 403);

  // Build the update patch and the event payload patch in lockstep so
  // the bus and the DB agree on what changed.
  const updatePatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const eventPatch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    updatePatch.name = body.name;
    eventPatch.name = body.name;
  }
  if (body.section !== undefined) {
    const sec = body.section === '' ? null : body.section;
    updatePatch.section = sec;
    eventPatch.section = sec;
  }

  // Emit the event BEFORE the write so a bus failure surfaces in logs
  // even if the DB write happens to succeed. The event is gated by
  // ff_event_bus_v1 so production with the flag OFF still works.
  try {
    await publishEvent(supabaseAdmin, {
      kind: 'teacher.classroom_updated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: auth.userId!,
      tenantId: (teacher as { school_id?: string | null }).school_id ?? null,
      idempotencyKey: `classroom_updated:${classId}:${Date.now()}`,
      payload: {
        classId,
        teacherId: teacher.id,
        patch: eventPatch,
      },
    });
  } catch (e) {
    logger.warn('teacher_classroom_updated_publish_failed', {
      route: 'teacher/classes/[id]',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // TODO: extract to projector subscriber once a multi-source class-edit
  // path emerges. `classes` is route-owned operational state today.
  const { error: updateErr } = await supabaseAdmin
    .from('classes')
    .update(updatePatch)
    .eq('id', classId);
  if (updateErr) {
    logger.error('teacher_classes_patch_update_failed', {
      error: new Error(updateErr.message),
      route: 'teacher/classes/[id]',
    });
    return err('Failed to update class', 500);
  }

  return NextResponse.json({ success: true });
}
