/**
 * POST /api/parent/children/[student_id]/request-erasure
 * DELETE /api/parent/children/[student_id]/request-erasure
 *
 * Phase D.3 — DPDP §15 right to erasure. Two-stage design.
 *
 * Stage 1 (this route):
 *   - POST creates a `pending` row in `data_erasure_requests` with
 *     `purge_at = now() + 7 days`.
 *   - DELETE flips a pending row to `cancelled` during the grace window.
 *   - Both routes are guardian-ownership-strict: the guardian MUST be
 *     linked to the student (active link).
 *
 * Stage 2 lives in `supabase/functions/data-erasure-purger/index.ts` —
 * a pg_cron-driven Edge Function that processes due rows every 6 hours.
 *
 * Hard rules:
 *   - NEVER an immediate delete from this route. The cron is the only
 *     producer of `status='completed'`.
 *   - The 7-day grace is a constant — don't accept it as a parameter.
 *   - On post-purge_at DELETE attempts, return 410 Gone.
 *
 * Response codes:
 *   POST 200 { success: true, request_id, purge_at }
 *   POST 200 { success: true, request_id, purge_at, already_pending: true }  ← idempotent
 *   POST 403 { success: false, error: 'Child not linked to your account' }
 *   POST 500 on DB error
 *
 *   DELETE 200 { success: true, status: 'cancelled' }
 *   DELETE 404 if no row exists
 *   DELETE 410 if purge_at has elapsed (no longer cancellable)
 *   DELETE 409 if status is already terminal
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';
import { auditLog } from '@alfanumrik/lib/audit';
import { deliverEmail } from '@alfanumrik/lib/email-delivery';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const uuidShape = () =>
  z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

const BodySchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

function err(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, error: message, ...(extra ?? {}) }, { status });
}

interface RouteCtx {
  params: Promise<{ student_id: string }>;
}

interface ErasureRpcResponse {
  success: boolean;
  status?: number;
  error?: string;
  data?: {
    requestId: string;
    purgeAt?: string;
    guardianId: string;
    guardianEmail?: string | null;
    schoolId?: string | null;
    studentName?: string | null;
    requestedAt?: string;
    alreadyPending?: boolean;
    created?: boolean;
    status?: string;
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
        // RLS-scoped erasure RPC calls only; this route does not mutate auth cookies.
      },
    },
    ...(authHeader ? { global: { headers: { Authorization: authHeader } } } : {}),
  });
}

// ── POST — create a pending erasure request ──────────────────────────

export async function POST(request: NextRequest, ctx: RouteCtx) {
  const auth = await authorizeRequest(request, 'child.view_progress');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { student_id: studentIdRaw } = await ctx.params;
  const studentIdParse = uuidShape().safeParse(studentIdRaw);
  if (!studentIdParse.success) return err('Invalid student_id', 400);
  const studentId = studentIdParse.data;

  let body: z.infer<typeof BodySchema> = {};
  try {
    const raw = await request.json().catch(() => ({}));
    body = BodySchema.parse(raw ?? {});
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message ?? 'Invalid body' : 'Invalid body';
    return err(msg, 400);
  }

  const rpcClient = await createRlsScopedClient(request);
  const { data: rpcData, error: rpcErr } = await rpcClient.rpc('parent_request_child_erasure', {
    p_student_id: studentId,
    p_reason: body.reason ?? null,
  });
  if (rpcErr) {
    logger.error('request_erasure_rpc_failed', {
      error: new Error(rpcErr.message),
      route: 'parent/children/request-erasure',
    });
    return err('Failed to create erasure request', 500);
  }

  const result = rpcData as ErasureRpcResponse | null;
  if (!result?.success) {
    return err(result?.error ?? 'Failed to create erasure request', result?.status ?? 500);
  }

  const data = result.data!;
  const schoolId = data.schoolId ?? null;

  if (data.alreadyPending) {
    return NextResponse.json({
      success: true,
      request_id: data.requestId,
      purge_at: data.purgeAt,
      already_pending: true,
    });
  }
  if (!data.purgeAt) {
    logger.error('request_erasure_rpc_missing_purge_at', {
      route: 'parent/children/request-erasure',
      error: new Error('parent_request_child_erasure returned success without purgeAt'),
    });
    return err('Failed to create erasure request', 500);
  }

  const now = new Date();

  // 6. Audit (best-effort).
  await auditLog({
    actor_id: auth.userId!,
    action: 'data_erasure.requested',
    target_entity: 'student',
    target_id: studentId,
    metadata: {
      request_id: data.requestId,
      guardian_id: data.guardianId,
      school_id: schoolId,
      purge_at: data.purgeAt,
      has_reason: Boolean(body.reason),
    },
    request,
  }).catch(() => {
    /* audit failures must never break the request */
  });

  // 7. Spine event (best-effort).
  try {
    const { error: eventErr } = await rpcClient.rpc('parent_publish_child_state_event', {
      p_kind: 'parent.child_erasure_requested',
      p_student_id: studentId,
      p_event_id: randomUUID(),
      p_occurred_at: now.toISOString(),
      p_actor_auth_user_id: auth.userId!,
      p_tenant_id: schoolId,
      p_idempotency_key: `child_erasure_requested:${data.requestId}`,
      p_payload: {
        requestId: data.requestId,
        guardianId: data.guardianId,
        studentId,
        purgeAt: data.purgeAt,
        hasReason: Boolean(body.reason),
      },
    });
    if (eventErr) throw new Error(eventErr.message);
  } catch (e) {
    logger.warn('child_erasure_requested_publish_failed', {
      route: 'parent/children/request-erasure',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 8. Confirmation email (fire-and-forget). The email-delivery layer
  // already enforces idempotency by template + a stable key. We pass
  // request_id as the idempotency key so a retry doesn't double-send.
  const guardianEmail = data.guardianEmail ?? null;
  if (guardianEmail) {
    void deliverEmail({
      template: 'school-trial-provisioned', // closest existing template; future PR adds a dedicated one
      to: guardianEmail,
      params: {
        idempotency_key: `child_erasure_requested:${data.requestId}`,
        expires_at: data.purgeAt,
        recipient_name: data.studentName ?? 'your child',
      },
    }).catch(() => { /* email failures must not affect the response */ });
  }

  return NextResponse.json({
    success: true,
    request_id: data.requestId,
    purge_at: data.purgeAt,
  });
}

// ── DELETE — cancel a pending erasure during the grace window ────────

export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  const auth = await authorizeRequest(request, 'child.view_progress');
  if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

  const { student_id: studentIdRaw } = await ctx.params;
  const studentIdParse = uuidShape().safeParse(studentIdRaw);
  if (!studentIdParse.success) return err('Invalid student_id', 400);
  const studentId = studentIdParse.data;

  const rpcClient = await createRlsScopedClient(request);
  const { data: rpcData, error: rpcErr } = await rpcClient.rpc('parent_cancel_child_erasure', {
    p_student_id: studentId,
  });
  if (rpcErr) {
    logger.error('cancel_erasure_rpc_failed', {
      error: new Error(rpcErr.message),
      route: 'parent/children/request-erasure',
    });
    return err('Failed to cancel erasure request', 500);
  }

  const result = rpcData as ErasureRpcResponse | null;
  if (!result?.success) {
    return err(
      result?.error ?? 'Failed to cancel erasure request',
      result?.status ?? 500,
      result?.data?.status ? { status: result.data.status } : undefined,
    );
  }

  const data = result.data!;

  await auditLog({
    actor_id: auth.userId!,
    action: 'data_erasure.cancelled',
    target_entity: 'student',
    target_id: studentId,
    metadata: {
      request_id: data.requestId,
      guardian_id: data.guardianId,
    },
    request,
  }).catch(() => { /* audit failures must never break the request */ });

  // Spine event (best-effort).
  try {
    const requestedAt = new Date(data.requestedAt ?? '').getTime();
    const elapsedSec = Number.isFinite(requestedAt)
      ? Math.max(0, Math.floor((Date.now() - requestedAt) / 1000))
      : null;
    const { error: eventErr } = await rpcClient.rpc('parent_publish_child_state_event', {
      p_kind: 'parent.child_erasure_cancelled',
      p_student_id: studentId,
      p_event_id: randomUUID(),
      p_occurred_at: new Date().toISOString(),
      p_actor_auth_user_id: auth.userId!,
      p_tenant_id: data.schoolId ?? null,
      p_idempotency_key: `child_erasure_cancelled:${data.requestId}`,
      p_payload: {
        requestId: data.requestId,
        guardianId: data.guardianId,
        studentId,
        elapsedSec,
      },
    });
    if (eventErr) throw new Error(eventErr.message);
  } catch (e) {
    logger.warn('child_erasure_cancelled_publish_failed', {
      route: 'parent/children/request-erasure',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({ success: true, status: 'cancelled' });
}
