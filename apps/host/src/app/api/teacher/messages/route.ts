/**
 * POST /api/teacher/messages — Phase C.3
 *
 * Teacher sends a message to a parent on the teacher↔parent messaging
 * surface. Either:
 *   - `thread_id` is supplied → append message to that thread (after the
 *     RPC verifies ownership: the thread's `teacher_id` must resolve to the
 *     caller's `teachers` row);
 *   - or `{ guardian_id?, student_id }` is supplied → the RPC upserts the
 *     thread and appends the first message in one go. Starting a brand-new
 *     thread additionally requires the teacher to actively teach the student
 *     (active class_teachers ⋈ class_enrollments roster join) — otherwise a
 *     clean 403 (`not_authorized_for_student`).
 *
 * Auth: `class.manage` permission (route gate) + auth.uid()-anchored teacher
 * resolution inside the SECURITY DEFINER RPC (the session-anchored data
 * boundary that replaces the old RLS-bypassing service-role client).
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
 *   400 invalid body  · 401 unauthenticated  · 403 not teacher /
 *   thread-not-owned / not-authorized-for-student  · 404 thread missing /
 *   linked-guardian-student pair missing  · 500 db.
 *
 * Side effects (all performed atomically inside teacher_send_parent_message):
 *   1. Inserts row into `teacher_parent_messages` (trigger bumps
 *      `last_message_at`).
 *   2. Emits the `teacher.parent_message_sent` state event.
 *   3. Inserts an in-app `notifications` row for the guardian so the parent
 *      badge ticks.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';
import { logTeacherAudit } from '@alfanumrik/lib/audit';

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
    //   - student_id (the RPC resolves the primary guardian server-side)
    //   - (guardian_id + student_id) (explicit pair)
    (v) => Boolean(v.thread_id) || Boolean(v.student_id),
    'either thread_id or student_id is required',
  );

type TeacherMessageRpcResult = {
  success?: boolean;
  error_code?: string;
  error?: string;
  thread_id?: string;
  message_id?: string;
  is_new_thread?: boolean;
};

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function mapRpcError(result: TeacherMessageRpcResult): NextResponse {
  const message = result.error ?? 'Failed to send message';
  switch (result.error_code) {
    case 'unauthorized':
      return err(message, 401);
    case 'not_teacher':
    case 'thread_not_owned':
    case 'not_authorized_for_student':
      return err(message, 403);
    case 'thread_not_found':
    case 'not_linked':
      return err(message, 404);
    case 'invalid_input':
      return err(message, 400);
    default:
      return err('Failed to send message', 500);
  }
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

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('teacher_send_parent_message', {
    p_thread_id:   parsed.thread_id ?? null,
    p_guardian_id: parsed.guardian_id ?? null,
    p_student_id:  parsed.student_id ?? null,
    p_body:        parsed.body,
    p_subject:     parsed.subject ?? null,
  });

  if (error) {
    logger.error('teacher_messages_send_rpc_failed', {
      error: new Error(error.message),
      route: 'teacher/messages',
    });
    return err('Failed to send message', 500);
  }

  const result = (data ?? {}) as TeacherMessageRpcResult;
  if (result.success !== true) {
    return mapRpcError(result);
  }

  // Metadata only — message body is deliberately never logged (P13).
  void logTeacherAudit({
    teacherAuthUserId: auth.userId!,
    action: 'parent_message.sent',
    resourceType: 'teacher_parent_message_thread',
    resourceId: result.thread_id ?? null,
    details: { is_new_thread: result.is_new_thread === true },
    ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
  });

  return NextResponse.json({
    success: true,
    thread_id: result.thread_id,
    message_id: result.message_id,
    is_new_thread: result.is_new_thread === true,
  });
}
