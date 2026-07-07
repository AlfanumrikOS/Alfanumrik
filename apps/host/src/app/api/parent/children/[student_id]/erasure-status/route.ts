/**
 * GET /api/parent/children/[student_id]/erasure-status — Phase D.3.
 *
 * Returns the current erasure request (if any) for the (caller, student)
 * pair. Used by the parent dashboard to render the "Erasure scheduled for
 * X — cancel?" banner.
 *
 * Strict guardian-ownership: the caller MUST be the guardian linked to the
 * student. Cross-guardian reads return 403.
 *
 * Response:
 *   200 { success: true, request: null }                          — no request
 *   200 { success: true, request: {                                — exists
 *     id, status, requested_at, purge_at, processed_at,
 *     reason: 'foo' | null, error_message: '...' | null
 *   } }
 *   403 { success: false, error: 'Child not linked to your account' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

const uuidShape = () =>
  z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

interface RouteCtx {
  params: Promise<{ student_id: string }>;
}

export async function GET(request: NextRequest, ctx: RouteCtx) {
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
    logger.error('erasure_status_guardian_lookup_failed', {
      error: new Error(gErr.message),
      route: 'parent/children/erasure-status',
    });
    return err('Failed to resolve guardian', 500);
  }
  if (!guardian) return err('Guardian account not found', 403);

  // Strict ownership — guardian MUST be linked.
  const { data: link, error: lErr } = await supabaseAdmin
    .from('guardian_student_links')
    .select('id')
    .eq('guardian_id', guardian.id)
    .eq('student_id', studentId)
    .in('status', ['approved', 'active'])
    .maybeSingle();
  if (lErr) {
    logger.error('erasure_status_link_lookup_failed', {
      error: new Error(lErr.message),
      route: 'parent/children/erasure-status',
    });
    return err('Failed to verify guardian/student link', 500);
  }
  if (!link) return err('Child not linked to your account', 403);

  // Return the most recent request (pending takes priority but we sort
  // by requested_at DESC and return whatever the freshest row says).
  const { data: rows, error: rErr } = await supabaseAdmin
    .from('data_erasure_requests')
    .select('id, status, requested_at, purge_at, processed_at, reason, error_message')
    .eq('guardian_id', guardian.id)
    .eq('student_id', studentId)
    .order('requested_at', { ascending: false })
    .limit(1);
  if (rErr) {
    logger.error('erasure_status_lookup_failed', {
      error: new Error(rErr.message),
      route: 'parent/children/erasure-status',
    });
    return err('Failed to look up erasure status', 500);
  }
  const row = (rows ?? [])[0] ?? null;
  return NextResponse.json({ success: true, request: row });
}
