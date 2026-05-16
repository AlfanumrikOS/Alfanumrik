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
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { auditLog } from '@/lib/audit';
import { publishEvent } from '@/lib/state/events/publish';
import { deliverEmail } from '@/lib/email-delivery';

const GRACE_DAYS = 7;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

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

  // 1. Resolve guardian row from auth user.
  const { data: guardian, error: gErr } = await supabaseAdmin
    .from('guardians')
    .select('id, email')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (gErr) {
    logger.error('request_erasure_guardian_lookup_failed', {
      error: new Error(gErr.message),
      route: 'parent/children/request-erasure',
    });
    return err('Failed to resolve guardian', 500);
  }
  if (!guardian) return err('Guardian account not found', 403);

  // 2. Strict ownership: there MUST be an active link between guardian and student.
  const { data: link, error: lErr } = await supabaseAdmin
    .from('guardian_student_links')
    .select('id, status')
    .eq('guardian_id', guardian.id)
    .eq('student_id', studentId)
    .in('status', ['approved', 'active'])
    .maybeSingle();
  if (lErr) {
    logger.error('request_erasure_link_lookup_failed', {
      error: new Error(lErr.message),
      route: 'parent/children/request-erasure',
    });
    return err('Failed to verify guardian/student link', 500);
  }
  if (!link) return err('Child not linked to your account', 403);

  // 3. Resolve school_id (tenant scope for RLS + event tenantId).
  const { data: student, error: sErr } = await supabaseAdmin
    .from('students')
    .select('school_id, name')
    .eq('id', studentId)
    .maybeSingle();
  if (sErr) {
    logger.error('request_erasure_student_lookup_failed', {
      error: new Error(sErr.message),
      route: 'parent/children/request-erasure',
    });
    return err('Failed to resolve student', 500);
  }
  if (!student) return err('Child not found', 404);
  const schoolId = (student as { school_id: string | null }).school_id;

  // 4. Idempotency: if a `pending` row already exists for this
  // (guardian, student), return it rather than creating a duplicate.
  // We deliberately do NOT collapse a previously-cancelled or failed
  // row — the guardian can re-request.
  const { data: existing } = await supabaseAdmin
    .from('data_erasure_requests')
    .select('id, purge_at')
    .eq('guardian_id', guardian.id)
    .eq('student_id', studentId)
    .eq('status', 'pending')
    .maybeSingle();
  if (existing) {
    return NextResponse.json({
      success: true,
      request_id: (existing as { id: string }).id,
      purge_at: (existing as { purge_at: string }).purge_at,
      already_pending: true,
    });
  }

  // 5. Create the pending row.
  const now = new Date();
  const purgeAt = new Date(now.getTime() + GRACE_MS);
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('data_erasure_requests')
    .insert({
      guardian_id: guardian.id,
      student_id: studentId,
      school_id: schoolId,
      status: 'pending',
      reason: body.reason ?? null,
      requested_at: now.toISOString(),
      purge_at: purgeAt.toISOString(),
    })
    .select('id, purge_at')
    .single();
  if (insErr || !inserted) {
    logger.error('request_erasure_insert_failed', {
      error: new Error(insErr?.message ?? 'no row returned'),
      route: 'parent/children/request-erasure',
    });
    return err('Failed to create erasure request', 500);
  }

  // 6. Audit (best-effort).
  await auditLog({
    actor_id: auth.userId!,
    action: 'data_erasure.requested',
    target_entity: 'student',
    target_id: studentId,
    metadata: {
      request_id: (inserted as { id: string }).id,
      guardian_id: guardian.id,
      school_id: schoolId,
      purge_at: (inserted as { purge_at: string }).purge_at,
      has_reason: Boolean(body.reason),
    },
    request,
  }).catch(() => {
    /* audit failures must never break the request */
  });

  // 7. Spine event (best-effort).
  try {
    await publishEvent(supabaseAdmin, {
      kind: 'parent.child_erasure_requested',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorAuthUserId: auth.userId!,
      tenantId: schoolId,
      idempotencyKey: `child_erasure_requested:${(inserted as { id: string }).id}`,
      payload: {
        requestId: (inserted as { id: string }).id,
        guardianId: guardian.id,
        studentId,
        purgeAt: (inserted as { purge_at: string }).purge_at,
        hasReason: Boolean(body.reason),
      },
    });
  } catch (e) {
    logger.warn('child_erasure_requested_publish_failed', {
      route: 'parent/children/request-erasure',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 8. Confirmation email (fire-and-forget). The email-delivery layer
  // already enforces idempotency by template + a stable key. We pass
  // request_id as the idempotency key so a retry doesn't double-send.
  const guardianEmail = (guardian as { email: string | null }).email;
  if (guardianEmail) {
    void deliverEmail({
      template: 'school-trial-provisioned', // closest existing template; future PR adds a dedicated one
      to: guardianEmail,
      params: {
        idempotency_key: `child_erasure_requested:${(inserted as { id: string }).id}`,
        expires_at: (inserted as { purge_at: string }).purge_at,
        recipient_name: (student as { name?: string | null }).name ?? 'your child',
      },
    }).catch(() => { /* email failures must not affect the response */ });
  }

  return NextResponse.json({
    success: true,
    request_id: (inserted as { id: string }).id,
    purge_at: (inserted as { purge_at: string }).purge_at,
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

  const { data: guardian, error: gErr } = await supabaseAdmin
    .from('guardians')
    .select('id')
    .eq('auth_user_id', auth.userId!)
    .maybeSingle();
  if (gErr) {
    logger.error('cancel_erasure_guardian_lookup_failed', {
      error: new Error(gErr.message),
      route: 'parent/children/request-erasure',
    });
    return err('Failed to resolve guardian', 500);
  }
  if (!guardian) return err('Guardian account not found', 403);

  const { data: row, error: rErr } = await supabaseAdmin
    .from('data_erasure_requests')
    .select('id, status, requested_at, purge_at, school_id')
    .eq('guardian_id', guardian.id)
    .eq('student_id', studentId)
    .in('status', ['pending', 'purging', 'completed', 'failed'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rErr) {
    logger.error('cancel_erasure_lookup_failed', {
      error: new Error(rErr.message),
      route: 'parent/children/request-erasure',
    });
    return err('Failed to look up erasure request', 500);
  }
  if (!row) return err('No erasure request found', 404);

  const status = (row as { status: string }).status;
  if (status === 'cancelled' || status === 'completed' || status === 'failed' || status === 'purging') {
    return err(
      status === 'completed' || status === 'purging'
        ? 'Erasure has already started and can no longer be cancelled'
        : `Request is already in terminal state: ${status}`,
      410,
      { status },
    );
  }
  // status === 'pending' — verify we're still inside the grace window.
  const purgeAt = new Date((row as { purge_at: string }).purge_at);
  if (purgeAt.getTime() <= Date.now()) {
    return err('Grace window has elapsed; erasure is in progress', 410);
  }

  const { error: uErr } = await supabaseAdmin
    .from('data_erasure_requests')
    .update({ status: 'cancelled', processed_at: new Date().toISOString() })
    .eq('id', (row as { id: string }).id)
    .eq('status', 'pending'); // optimistic — cron must not have flipped to purging
  if (uErr) {
    logger.error('cancel_erasure_update_failed', {
      error: new Error(uErr.message),
      route: 'parent/children/request-erasure',
    });
    return err('Failed to cancel erasure request', 500);
  }

  await auditLog({
    actor_id: auth.userId!,
    action: 'data_erasure.cancelled',
    target_entity: 'student',
    target_id: studentId,
    metadata: {
      request_id: (row as { id: string }).id,
      guardian_id: guardian.id,
    },
    request,
  }).catch(() => { /* audit failures must never break the request */ });

  // Spine event (best-effort).
  try {
    const requestedAt = new Date((row as { requested_at: string }).requested_at).getTime();
    const elapsedSec = Number.isFinite(requestedAt)
      ? Math.max(0, Math.floor((Date.now() - requestedAt) / 1000))
      : null;
    await publishEvent(supabaseAdmin, {
      kind: 'parent.child_erasure_cancelled',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorAuthUserId: auth.userId!,
      tenantId: (row as { school_id: string | null }).school_id,
      idempotencyKey: `child_erasure_cancelled:${(row as { id: string }).id}`,
      payload: {
        requestId: (row as { id: string }).id,
        guardianId: guardian.id,
        studentId,
        elapsedSec,
      },
    });
  } catch (e) {
    logger.warn('child_erasure_cancelled_publish_failed', {
      route: 'parent/children/request-erasure',
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({ success: true, status: 'cancelled' });
}
