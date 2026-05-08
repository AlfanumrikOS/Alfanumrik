/**
 * /api/super-admin/reconciliation/[id]/reject
 *
 * PATCH — reject an offline payment submission. Either the submitter or a
 *         second admin can reject. Once rejected, the row stays as audit
 *         history; a new submission for the same invoice is allowed.
 *
 * Phase 3-B. Gated by `ff_offline_payment_reconciliation_v1`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { capture } from '@/lib/posthog/server';

export const runtime = 'nodejs';

const FLAG = 'ff_offline_payment_reconciliation_v1';

interface PatchBody {
  reason?: string;
}

function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  if (!(await isFeatureEnabled(FLAG, {
    userId: auth.userId,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  }))) {
    return err('Offline payment reconciliation is not enabled.', 403);
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return err('Invalid id');

  let body: PatchBody = {};
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    /* allow empty body */
  }
  const reason = (body.reason ?? '').trim();
  if (reason.length < 1 || reason.length > 500) {
    return err('reason must be 1..500 chars');
  }

  const supabase = getSupabaseAdmin();

  const { data: row, error: readErr } = await supabase
    .from('payment_reconciliation_queue')
    .select('id, status, submitted_by_user_id, school_id, invoice_id')
    .eq('id', id)
    .maybeSingle();
  if (readErr || !row) return err('Reconciliation row not found', 404);
  if (row.status !== 'pending' && row.status !== 'approved') {
    return err(`Cannot reject a row in status "${row.status}".`, 409);
  }

  const { error: updErr } = await supabase
    .from('payment_reconciliation_queue')
    .update({
      status: 'rejected',
      rejected_by_user_id: auth.userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq('id', id);

  if (updErr) {
    logger.error('reconciliation_reject_error', {
      error: new Error(updErr.message),
      route: '/api/super-admin/reconciliation/[id]/reject',
      reconciliationId: id,
    });
    return err('Failed to mark rejected', 500);
  }

  capture('reconciliation_rejected', auth.userId, {
    reconciliation_id: id,
    school_id: row.school_id,
    invoice_id: row.invoice_id,
    reason,
  });

  void logAdminAudit(
    auth,
    'reconciliation.reject',
    'payment_reconciliation_queue',
    id,
    {
      school_id: row.school_id,
      invoice_id: row.invoice_id,
      submitter_user_id: row.submitted_by_user_id,
      prior_status: row.status,
      reason,
    },
    request.headers.get('x-forwarded-for') ?? undefined,
  );

  return NextResponse.json({ success: true });
}
