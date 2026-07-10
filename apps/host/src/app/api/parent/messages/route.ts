/**
 * POST /api/parent/messages — guardian sends a message to a teacher.
 *
 * The route keeps RBAC/body validation and delegates guardian resolution,
 * thread ownership, message insert, state-event, and notification writes to
 * the auth.uid()-anchored parent_send_teacher_message RPC.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { logger } from '@alfanumrik/lib/logger';

const uuidShape = () =>
  z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

const BodySchema = z
  .object({
    thread_id: uuidShape().optional(),
    teacher_id: uuidShape().optional(),
    student_id: uuidShape().optional(),
    body: z.string().trim().min(1).max(4000),
    subject: z.string().trim().max(200).optional(),
  })
  .refine(
    (value) => Boolean(value.thread_id) || (Boolean(value.teacher_id) && Boolean(value.student_id)),
    'either thread_id or (teacher_id + student_id) is required',
  );

type ParentMessageRpcResult = {
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

function mapRpcError(result: ParentMessageRpcResult): NextResponse {
  const message = result.error ?? 'Failed to send message';
  switch (result.error_code) {
    case 'no_guardian':
    case 'thread_not_owned':
      return err(message, 403);
    case 'thread_not_found':
    case 'not_linked':
    case 'teacher_not_found':
      return err(message, 404);
    case 'unauthorized':
      return err(message, 401);
    default:
      return err('Failed to send message', 500);
  }
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

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('parent_send_teacher_message', {
    p_thread_id: parsed.thread_id ?? null,
    p_teacher_id: parsed.teacher_id ?? null,
    p_student_id: parsed.student_id ?? null,
    p_body: parsed.body,
    p_subject: parsed.subject ?? null,
  });

  if (error) {
    logger.error('parent_messages_send_rpc_failed', {
      error: new Error(error.message),
      route: 'parent/messages',
    });
    return err('Failed to send message', 500);
  }

  const result = (data ?? {}) as ParentMessageRpcResult;
  if (result.success !== true) {
    return mapRpcError(result);
  }

  return NextResponse.json({
    success: true,
    thread_id: result.thread_id,
    message_id: result.message_id,
    is_new_thread: result.is_new_thread === true,
  });
}
