/**
 * POST /api/teacher/classes/[id]/archive
 *
 * Phase B.5 (ADR-005). Archives (soft-deletes) a class by setting
 * `is_active = false`. Replaces the direct UPDATE in
 * src/app/teacher/classes/page.tsx (handleArchive).
 *
 * Ownership is verified against `class_teachers` (the teacher must own
 * the class). Emits `teacher.classroom_archived`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { publishEvent } from '@/lib/state/events/publish';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { id: classId } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(classId)) return err('Invalid class id', 400);

  // Resolve teacher row.
  const { data: teacher, error: teacherErr } = await supabaseAdmin
    .from('teachers')
    .select('id, school_id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (teacherErr) {
    logger.error('teacher_classes_archive_teacher_lookup_failed', {
      error: new Error(teacherErr.message),
      route: 'teacher/classes/[id]/archive',
    });
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  // Ownership check.
  const { data: link, error: linkErr } = await supabaseAdmin
    .from('class_teachers')
    .select('class_id')
    .eq('class_id', classId)
    .eq('teacher_id', teacher.id)
    .maybeSingle();
  if (linkErr) {
    logger.error('teacher_classes_archive_link_lookup_failed', {
      error: new Error(linkErr.message),
      route: 'teacher/classes/[id]/archive',
    });
    return err('Failed to verify class ownership', 500);
  }
  if (!link) return err('You do not own this class', 403);

  // Emit event first — bus failure should be visible in logs whether or
  // not the DB write succeeds afterwards.
  try {
    await publishEvent(supabaseAdmin, {
      kind: 'teacher.classroom_archived',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: auth.userId!,
      tenantId: (teacher as { school_id?: string | null }).school_id ?? null,
      idempotencyKey: `classroom_archived:${classId}`,
      payload: {
        classId,
        teacherId: teacher.id,
      },
    });
  } catch (e) {
    logger.warn('teacher_classroom_archived_publish_failed', {
      route: 'teacher/classes/[id]/archive',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // TODO: extract to projector subscriber. `classes.is_active` is a
  // route-owned operational column under ADR-005's carve-out.
  const { error: updateErr } = await supabaseAdmin
    .from('classes')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', classId);
  if (updateErr) {
    logger.error('teacher_classes_archive_update_failed', {
      error: new Error(updateErr.message),
      route: 'teacher/classes/[id]/archive',
    });
    return err('Failed to archive class', 500);
  }

  return NextResponse.json({ success: true });
}
