/**
 * POST /api/parent/messages — Phase C.3
 *
 * Guardian sends a message to a teacher on the teacher↔parent
 * messaging surface. Either:
 *   - `thread_id` → append to an existing owned thread; or
 *   - `{ teacher_id, student_id }` → upsert thread + first message.
 *
 * Auth: `child.view_progress` permission + guardian-row resolution.
 *
 * Body (Zod):
 *   {
 *     thread_id?: uuid,
 *     teacher_id?: uuid,
 *     student_id?: uuid,
 *     body: string (1–4000 chars),
 *     subject?: string
 *   }
 *
 * Response 200:
 *   { success: true, thread_id, message_id, is_new_thread }
 *
 * Side effects mirror the teacher route (state_event +
 * notifications row for the teacher).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { publishEvent } from '@/lib/state/events/publish';

// Shape-only UUID check (matches teacher route + registry rationale).
const uuidShape = () =>
  z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

const BodySchema = z
  .object({
    thread_id:  uuidShape().optional(),
    teacher_id: uuidShape().optional(),
    student_id: uuidShape().optional(),
    body:       z.string().trim().min(1).max(4000),
    subject:    z.string().trim().max(200).optional(),
  })
  .refine(
    (v) => Boolean(v.thread_id) || (Boolean(v.teacher_id) && Boolean(v.student_id)),
    'either thread_id or (teacher_id + student_id) is required',
  );

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'child.view_progress');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }
  const { thread_id, teacher_id, student_id, body, subject } = parsed;

  // Resolve guardian row.
  const { data: guardian, error: guardianErr } = await supabaseAdmin
    .from('guardians')
    .select('id, name')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (guardianErr) {
    logger.error('parent_messages_guardian_lookup_failed', {
      error: new Error(guardianErr.message),
      route: 'parent/messages',
    });
    return err('Failed to resolve guardian', 500);
  }
  if (!guardian) return err('Guardian account not found', 403);

  let threadId: string;
  let resolvedTeacherId: string;
  let resolvedGuardianId: string;
  let resolvedStudentId: string;
  let threadSchoolId: string | null = null;
  let isNewThread = false;

  if (thread_id) {
    const { data: thread, error: threadErr } = await supabaseAdmin
      .from('teacher_parent_threads')
      .select('id, teacher_id, guardian_id, student_id, school_id')
      .eq('id', thread_id)
      .maybeSingle();
    if (threadErr) {
      logger.error('parent_messages_thread_lookup_failed', {
        error: new Error(threadErr.message),
        route: 'parent/messages',
      });
      return err('Failed to resolve thread', 500);
    }
    if (!thread) return err('Thread not found', 404);
    if (thread.guardian_id !== guardian.id) {
      // Same status as cross-tenant rejection — never leak existence.
      return err('Thread not owned by caller', 403);
    }
    threadId = thread.id;
    resolvedTeacherId  = thread.teacher_id;
    resolvedGuardianId = thread.guardian_id;
    resolvedStudentId  = thread.student_id;
    threadSchoolId     = (thread as { school_id?: string | null }).school_id ?? null;
  } else {
    // Verify the guardian is actually linked to this student.
    const { data: link, error: linkErr } = await supabaseAdmin
      .from('guardian_student_links')
      .select('id, status')
      .eq('guardian_id', guardian.id)
      .eq('student_id',  student_id!)
      .in('status', ['approved', 'active'])
      .maybeSingle();
    if (linkErr) {
      logger.error('parent_messages_link_lookup_failed', {
        error: new Error(linkErr.message),
        route: 'parent/messages',
      });
      return err('Failed to verify guardian/student link', 500);
    }
    if (!link) return err('Child not linked to your account', 404);

    // Verify the teacher exists.
    const { data: teacherRow, error: teacherErr } = await supabaseAdmin
      .from('teachers')
      .select('id, school_id')
      .eq('id', teacher_id!)
      .maybeSingle();
    if (teacherErr) {
      logger.error('parent_messages_teacher_lookup_failed', {
        error: new Error(teacherErr.message),
        route: 'parent/messages',
      });
      return err('Failed to resolve teacher', 500);
    }
    if (!teacherRow) return err('Teacher not found', 404);
    threadSchoolId = (teacherRow as { school_id?: string | null }).school_id ?? null;

    // Try select first.
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('teacher_parent_threads')
      .select('id')
      .eq('teacher_id',  teacher_id!)
      .eq('guardian_id', guardian.id)
      .eq('student_id',  student_id!)
      .maybeSingle();
    if (existingErr) {
      logger.error('parent_messages_thread_select_failed', {
        error: new Error(existingErr.message),
        route: 'parent/messages',
      });
      return err('Failed to resolve thread', 500);
    }

    if (existing) {
      threadId = existing.id;
    } else {
      const { data: created, error: createErr } = await supabaseAdmin
        .from('teacher_parent_threads')
        .insert({
          teacher_id:  teacher_id!,
          guardian_id: guardian.id,
          student_id:  student_id!,
          school_id:   threadSchoolId,
          subject:     subject ?? null,
        })
        .select('id')
        .single();
      if (createErr || !created) {
        logger.error('parent_messages_thread_create_failed', {
          error: new Error(createErr?.message ?? 'no row returned'),
          route: 'parent/messages',
        });
        return err('Failed to create thread', 500);
      }
      threadId = created.id;
      isNewThread = true;
    }
    resolvedTeacherId  = teacher_id!;
    resolvedGuardianId = guardian.id;
    resolvedStudentId  = student_id!;
  }

  // Insert message.
  const { data: inserted, error: msgErr } = await supabaseAdmin
    .from('teacher_parent_messages')
    .insert({
      thread_id:           threadId,
      sender_role:         'guardian',
      sender_auth_user_id: auth.userId!,
      body,
    })
    .select('id, created_at')
    .single();
  if (msgErr || !inserted) {
    logger.error('parent_messages_insert_failed', {
      error: new Error(msgErr?.message ?? 'no row returned'),
      route: 'parent/messages',
    });
    return err('Failed to send message', 500);
  }

  // Spine event (best-effort).
  try {
    await publishEvent(supabaseAdmin, {
      kind: 'parent.teacher_message_sent',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: auth.userId!,
      tenantId: threadSchoolId,
      idempotencyKey: `parent_teacher_message_sent:${inserted.id}`,
      payload: {
        threadId,
        messageId:    inserted.id,
        teacherId:    resolvedTeacherId,
        guardianId:   resolvedGuardianId,
        studentId:    resolvedStudentId,
        bodyLength:   body.length,
        isNewThread,
      },
    });
  } catch (e) {
    logger.warn('parent_teacher_message_sent_publish_failed', {
      route: 'parent/messages',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Notification row for the teacher. Notifications are recipient-keyed
  // on `(recipient_type, recipient_id)`; teacher recipients use the
  // `teachers.id` value (parallel to `guardians.id` for the parent side).
  try {
    const notifBody = body.length > 200 ? `${body.slice(0, 200)}…` : body;
    const parentName = (guardian as { name?: string | null }).name ?? 'A parent';
    await supabaseAdmin.from('notifications').insert({
      recipient_id:   resolvedTeacherId,
      recipient_type: 'teacher',
      sender_id:      resolvedGuardianId,
      sender_type:    'guardian',
      type:           'parent_message',
      notification_type: 'parent_message',
      title:          `New message from ${parentName}`,
      message:        notifBody,
      body:           notifBody,
      data:           { thread_id: threadId, message_id: inserted.id, student_id: resolvedStudentId },
      is_read:        false,
      delivery_channel: 'in_app',
    });
  } catch (e) {
    logger.warn('parent_messages_notification_insert_failed', {
      route: 'parent/messages',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({
    success: true,
    thread_id: threadId,
    message_id: inserted.id,
    is_new_thread: isNewThread,
  });
}
