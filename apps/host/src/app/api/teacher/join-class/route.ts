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
import { logger } from '@alfanumrik/lib/logger';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

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

interface JoinClassRpcResponse {
  success: boolean;
  status?: number;
  error?: string;
  data?: {
    classId: string;
    alreadyJoined: boolean;
    teacherId?: string;
    schoolId?: string | null;
  };
}

async function createRlsScopedClient(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const authHeader = request.headers.get('Authorization');
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // API route only needs the caller identity for the RLS-scoped RPC.
      },
    },
    ...(authHeader ? { global: { headers: { Authorization: authHeader } } } : {}),
  });
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

  const supabase = await createRlsScopedClient(request);
  const { data, error: rpcErr } = await supabase.rpc('teacher_join_class_by_code', {
    p_class_code: code,
  });

  if (rpcErr) {
    logger.error('teacher_join_class_rpc_failed', {
      error: new Error(rpcErr.message),
      route: 'teacher/join-class',
    });
    return err('Failed to join class', 500);
  }

  const result = data as JoinClassRpcResponse | null;
  if (!result?.success) {
    return err(result?.error ?? 'Failed to join class', result?.status ?? 500);
  }

  logger.info('teacher_joined_class', {
    route: 'teacher/join-class',
    teacherId: result.data?.teacherId ?? auth.userId ?? null,
    classId: result.data?.classId ?? null,
    schoolId: result.data?.schoolId ?? null,
  });

  return NextResponse.json({
    success: true,
    data: {
      classId: result.data!.classId,
      alreadyJoined: result.data!.alreadyJoined,
    },
  });
}
