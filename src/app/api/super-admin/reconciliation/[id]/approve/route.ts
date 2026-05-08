/**
 * /api/super-admin/reconciliation/[id]/approve
 *
 * PATCH — approve an offline payment submitted by another super-admin.
 *         Two-person rule enforced: caller must NOT be the submitter.
 *         On success, calls reconcile_payment() RPC which atomically marks
 *         the invoice paid and extends the school's subscription period.
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

  const supabase = getSupabaseAdmin();

  // Re-read the row, enforce two-person rule and current state
  const { data: row, error: readErr } = await supabase
    .from('payment_reconciliation_queue')
    .select('id, status, submitted_by_user_id, school_id, invoice_id, received_amount_inr')
    .eq('id', id)
    .maybeSingle();
  if (readErr || !row) return err('Reconciliation row not found', 404);
  if (row.status !== 'pending') {
    return err(`Cannot approve a row in status "${row.status}".`, 409);
  }
  if (row.submitted_by_user_id === auth.userId) {
    // Defense-in-depth alongside the CHECK constraint
    return err('Two-person rule: you cannot approve a reconciliation you submitted.', 403);
  }

  // Flip to approved (atomic with the approver fields). The RPC below
  // re-reads under FOR UPDATE so a race between approve and an immediate
  // reconcile_payment is serialised by the DB lock.
  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from('payment_reconciliation_queue')
    .update({
      status: 'approved',
      approved_by_user_id: auth.userId,
      approved_at: now,
    })
    .eq('id', id)
    .eq('status', 'pending'); // optimistic: blocks a racing second approver

  if (updErr) {
    const code = (updErr as { code?: string }).code;
    if (code === '23514') {
      // CHECK constraint violation — same user attempted submit+approve
      return err('Two-person rule violated.', 403);
    }
    logger.error('reconciliation_approve_update_error', {
      error: new Error(updErr.message),
      route: '/api/super-admin/reconciliation/[id]/approve',
      reconciliationId: id,
    });
    return err('Failed to mark approved', 500);
  }

  // Call the atomic reconciliation RPC
  const { data: rpcOut, error: rpcErr } = await supabase.rpc('reconcile_payment', {
    p_reconciliation_id: id,
  });
  if (rpcErr) {
    logger.error('reconciliation_rpc_error', {
      error: new Error(rpcErr.message),
      route: '/api/super-admin/reconciliation/[id]/approve',
      reconciliationId: id,
    });
    // Roll back the approval flip so the operator can retry / investigate.
    // We deliberately do NOT auto-rollback the invoice/subscription state —
    // if the RPC partially completed before failing, an operator must inspect
    // and decide. The RPC is wrapped in a single transaction so partial
    // completion is not expected, but the safety note remains.
    await supabase
      .from('payment_reconciliation_queue')
      .update({ status: 'pending', approved_by_user_id: null, approved_at: null })
      .eq('id', id)
      .eq('status', 'approved');
    return err('Reconciliation RPC failed; row reverted to pending.', 500);
  }

  capture('reconciliation_approved', auth.userId, {
    reconciliation_id: id,
    school_id: row.school_id,
    invoice_id: row.invoice_id,
    received_amount_inr: row.received_amount_inr,
    rpc_result: rpcOut,
  });

  // Two-person reconciliation approval is the moment money actually moves
  // (invoice marked paid + subscription extended). Must hit admin_audit_log
  // so compliance can prove WHO approved each offline payment, when.
  void logAdminAudit(
    auth,
    'reconciliation.approve',
    'payment_reconciliation_queue',
    id,
    {
      school_id: row.school_id,
      invoice_id: row.invoice_id,
      received_amount_inr: row.received_amount_inr,
      submitter_user_id: row.submitted_by_user_id,
      rpc_result: rpcOut,
    },
    request.headers.get('x-forwarded-for') ?? undefined,
  );

  return NextResponse.json({ success: true, data: rpcOut ?? null });
}
