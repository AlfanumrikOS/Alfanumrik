/**
 * POST /api/teacher/messages — Phase C.3
 *
 * Teacher sends a message to a parent on the teacher↔parent messaging
 * surface. Either:
 *   - `thread_id` is supplied → append message to that thread (after
 *     verifying ownership: the thread's `teacher_id` must resolve to the
 *     caller's `teachers` row);
 *   - or `{ guardian_id, student_id }` is supplied → upsert the thread
 *     and append the first message in one go.
 *
 * Auth: `class.manage` permission + teacher-row resolution.
 *
 * Body (Zod):
 *   {
 *     thread_id?: uuid,
 *     guardian_id?: uuid,
 *     student_id?: uuid,
 *     body: string (1–4000 chars after trim),
 *     subject?: string  // optional thread subject when creating
 *   }
 *
 * Response 200:
 *   { success: true, thread_id, message_id, is_new_thread }
 *
 * Errors:
 *   400 invalid body  · 401 auth  · 403 not teacher / cross-tenant ·
 *   404 thread missing / linked-guardian-student pair missing  · 500 db.
 *
 * Side effects:
 *   1. Inserts row into `teacher_parent_messages` (trigger bumps
 *      `last_message_at`).
 *   2. Emits `teacher.parent_message_sent` via publishEvent (no-op if
 *      ff_event_bus_v1 is off).
 *   3. Inserts an in-app `notifications` row for the guardian — minimal
 *      surface so the parent badge ticks. Rich email/WhatsApp delivery
 *      stays in Phase D.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { publishEvent } from '@alfanumrik/lib/state/events/publish';

// Shape-only UUID check (matches src/lib/state/events/registry.ts) —
// Zod v4's strict .uuid() rejects fixture UUIDs used in tests and is
// stricter than the column type warrants for an identifier we'll hand
// straight to Supabase (Postgres uuid input validates fully on insert).
const uuidShape = () =>
  z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

const BodySchema = z
  .object({
    thread_id:   uuidShape().optional(),
    guardian_id: uuidShape().optional(),
    student_id:  uuidShape().optional(),
    body:        z.string().trim().min(1).max(4000),
    subject:     z.string().trim().max(200).optional(),
  })
  .refine(
    // Accept either:
    //   - thread_id (append)
    //   - student_id (we will resolve the primary guardian server-side)
    //   - (guardian_id + student_id) (explicit pair)
    (v) => Boolean(v.thread_id) || Boolean(v.student_id),
    'either thread_id or student_id is required',
  );

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }
  const { thread_id, guardian_id, student_id, body, subject } = parsed;

  // Resolve the caller's teacher row.
  const { data: teacher, error: teacherErr } = await supabaseAdmin
    .from('teachers')
    .select('id, school_id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (teacherErr) {
    logger.error('teacher_messages_teacher_lookup_failed', {
      error: new Error(teacherErr.message),
      route: 'teacher/messages',
    });
    return err('Failed to resolve teacher', 500);
  }
  if (!teacher) return err('Teacher account not found', 403);

  // ── Resolve / create the thread ──
  let threadId: string;
  let resolvedTeacherId: string;
  let resolvedGuardianId: string;
  let resolvedStudentId: string;
  let isNewThread = false;

  if (thread_id) {
    // Append path: thread must already exist and belong to this teacher.
    const { data: thread, error: threadErr } = await supabaseAdmin
      .from('teacher_parent_threads')
      .select('id, teacher_id, guardian_id, student_id, school_id')
      .eq('id', thread_id)
      .maybeSingle();
    if (threadErr) {
      logger.error('teacher_messages_thread_lookup_failed', {
        error: new Error(threadErr.message),
        route: 'teacher/messages',
      });
      return err('Failed to resolve thread', 500);
    }
    if (!thread) return err('Thread not found', 404);
    if (thread.teacher_id !== teacher.id) {
      // 403 (not 404) is deliberate — same status as cross-tenant
      // ownership rejection in C.1/C.2.
      return err('Thread not owned by caller', 403);
    }
    threadId = thread.id;
    resolvedTeacherId = thread.teacher_id;
    resolvedGuardianId = thread.guardian_id;
    resolvedStudentId = thread.student_id;
  } else {
    // Upsert path. If guardian_id was supplied, verify the link directly;
    // otherwise resolve the student's primary approved guardian. This lets
    // the /teacher/students CTA pass student_id only.
    let effectiveGuardianId = guardian_id ?? null;
    if (!effectiveGuardianId) {
      const { data: link, error: linkErr } = await supabaseAdmin
        .from('guardian_student_links')
        .select('guardian_id, status, created_at')
        .eq('student_id', student_id!)
        .in('status', ['approved', 'active'])
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (linkErr) {
        logger.error('teacher_messages_link_lookup_failed', {
          error: new Error(linkErr.message),
          route: 'teacher/messages',
        });
        return err('Failed to verify guardian/student link', 500);
      }
      if (!link) return err('No approved guardian linked to this student', 404);
      effectiveGuardianId = (link as { guardian_id: string }).guardian_id;
    } else {
      // Explicit pair: verify the link.
      const { data: link, error: linkErr } = await supabaseAdmin
        .from('guardian_student_links')
        .select('id, status')
        .eq('guardian_id', effectiveGuardianId)
        .eq('student_id', student_id!)
        .in('status', ['approved', 'active'])
        .maybeSingle();
      if (linkErr) {
        logger.error('teacher_messages_link_lookup_failed', {
          error: new Error(linkErr.message),
          route: 'teacher/messages',
        });
        return err('Failed to verify guardian/student link', 500);
      }
      if (!link) return err('No approved guardian/student link', 404);
    }

    // Try select first (cheap path for repeat conversations).
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('teacher_parent_threads')
      .select('id, school_id')
      .eq('teacher_id',  teacher.id)
      .eq('guardian_id', effectiveGuardianId!)
      .eq('student_id',  student_id!)
      .maybeSingle();
    if (existingErr) {
      logger.error('teacher_messages_thread_select_failed', {
        error: new Error(existingErr.message),
        route: 'teacher/messages',
      });
      return err('Failed to resolve thread', 500);
    }

    if (existing) {
      threadId = existing.id;
    } else {
      const { data: created, error: createErr } = await supabaseAdmin
        .from('teacher_parent_threads')
        .insert({
          teacher_id:  teacher.id,
          guardian_id: effectiveGuardianId!,
          student_id:  student_id!,
          school_id:   teacher.school_id ?? null,
          subject:     subject ?? null,
        })
        .select('id')
        .single();
      if (createErr || !created) {
        logger.error('teacher_messages_thread_create_failed', {
          error: new Error(createErr?.message ?? 'no row returned'),
          route: 'teacher/messages',
        });
        return err('Failed to create thread', 500);
      }
      threadId = created.id;
      isNewThread = true;
    }
    resolvedTeacherId  = teacher.id;
    resolvedGuardianId = effectiveGuardianId!;
    resolvedStudentId  = student_id!;
  }

  // ── Insert the message ──
  const { data: inserted, error: msgErr } = await supabaseAdmin
    .from('teacher_parent_messages')
    .insert({
      thread_id:           threadId,
      sender_role:         'teacher',
      sender_auth_user_id: auth.userId!,
      body,
    })
    .select('id, created_at')
    .single();
  if (msgErr || !inserted) {
    logger.error('teacher_messages_insert_failed', {
      error: new Error(msgErr?.message ?? 'no row returned'),
      route: 'teacher/messages',
    });
    return err('Failed to send message', 500);
  }

  // ── Emit spine event (best-effort) ──
  try {
    await publishEvent(supabaseAdmin, {
      kind: 'teacher.parent_message_sent',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: auth.userId!,
      tenantId: (teacher as { school_id?: string | null }).school_id ?? null,
      idempotencyKey: `teacher_parent_message_sent:${inserted.id}`,
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
    logger.warn('teacher_parent_message_sent_publish_failed', {
      route: 'teacher/messages',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // ── In-app notification row for the guardian ──
  // Minimal: just enough to make the parent badge tick. Email / WhatsApp
  // delivery stays in Phase D.
  try {
    const notifBody = body.length > 200 ? `${body.slice(0, 200)}…` : body;
    await supabaseAdmin.from('notifications').insert({
      recipient_id:   resolvedGuardianId,
      recipient_type: 'guardian',
      sender_id:      resolvedTeacherId,
      sender_type:    'teacher',
      type:           'teacher_message',
      notification_type: 'teacher_message',
      title:          'New message from teacher',
      message:        notifBody,
      body:           notifBody,
      data:           { thread_id: threadId, message_id: inserted.id, student_id: resolvedStudentId },
      is_read:        false,
      delivery_channel: 'in_app',
    });
  } catch (e) {
    logger.warn('teacher_messages_notification_insert_failed', {
      route: 'teacher/messages',
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
