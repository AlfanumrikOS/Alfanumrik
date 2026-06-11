/**
 * /api/super-admin/reconciliation
 *
 * GET  — list reconciliation queue rows (filterable by status / school_id)
 * POST — submit a new offline payment for an existing school_invoices row
 *
 * Phase 3-B of the May 2026 upgrade. Gated by
 * `ff_offline_payment_reconciliation_v1` (default OFF).
 *
 * Auth: super-admin via `authorizeAdmin(request)`. service-role used for
 *       all DB calls (RLS bypass) since the queue is service-role-only by
 *       design (school admins must NOT see this surface).
 *
 * Two-person rule: enforced at row level by the CHECK constraint on
 * `payment_reconciliation_queue.submitted_by_user_id != approved_by_user_id`,
 * and re-checked in the /approve sub-route below. POST does not approve;
 * it only submits with status = 'pending'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { capture } from '@/lib/posthog/server';

export const runtime = 'nodejs';

const FLAG = 'ff_offline_payment_reconciliation_v1';

const VALID_METHODS = new Set(['po', 'bank_transfer', 'cheque', 'upi_offline']);
const VALID_STATUSES = new Set(['pending', 'approved', 'reconciled', 'rejected']);
const AMOUNT_TOLERANCE_INR = 1; // received_amount must match expected within ₹1

interface PostBody {
  invoice_id?: string;
  received_amount_inr?: number;
  payment_method?: string;
  reference_number?: string;
  receipt_document_url?: string;
  notes?: string;
}

function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function flagEnabled(authUserId: string): Promise<boolean> {
  return isFeatureEnabled(FLAG, {
    userId: authUserId,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
}

// ─── GET ────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  if (!(await flagEnabled(auth.userId))) {
    return err('Offline payment reconciliation is not enabled.', 403);
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const schoolId = searchParams.get('school_id');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
    const offset = (page - 1) * limit;

    if (status && !VALID_STATUSES.has(status)) {
      return err(`Invalid status. Must be one of: ${Array.from(VALID_STATUSES).join(', ')}`);
    }

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from('payment_reconciliation_queue')
      .select(
        'id, invoice_id, school_id, expected_amount_inr, received_amount_inr, payment_method, reference_number, receipt_document_url, submitted_by_user_id, submitted_at, approved_by_user_id, approved_at, rejected_by_user_id, rejected_at, rejection_reason, status, notes, created_at, updated_at, schools(name), school_invoices(invoice_number, financial_year, amount_inr)',
        { count: 'exact' },
      )
      .order('submitted_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (schoolId) query = query.eq('school_id', schoolId);

    const { data, error, count } = await query;
    if (error) {
      logger.error('reconciliation_list_error', {
        error: new Error(error.message),
        route: '/api/super-admin/reconciliation',
      });
      return err('Failed to fetch reconciliation queue', 500);
    }

    return NextResponse.json({
      success: true,
      data: {
        rows: data ?? [],
        total: count ?? 0,
        page,
        limit,
      },
    });
  } catch (e) {
    logger.error('reconciliation_list_unexpected', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: '/api/super-admin/reconciliation',
    });
    return err('Internal server error', 500);
  }
}

// ─── POST — submit a new offline payment ────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  if (!(await flagEnabled(auth.userId))) {
    return err('Offline payment reconciliation is not enabled.', 403);
  }

  try {
    const body = (await request.json()) as PostBody;

    const invoiceId = (body.invoice_id ?? '').trim();
    const received = Number(body.received_amount_inr);
    const method = (body.payment_method ?? '').trim();
    const reference = (body.reference_number ?? '').trim();
    const receiptUrl = (body.receipt_document_url ?? '').trim() || null;
    const notes = (body.notes ?? '').trim() || null;

    if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return err('invoice_id must be a UUID');
    if (!Number.isFinite(received) || received <= 0) return err('received_amount_inr must be > 0');
    if (!VALID_METHODS.has(method)) return err(`payment_method must be one of: ${Array.from(VALID_METHODS).join(', ')}`);
    if (reference.length < 1 || reference.length > 200) return err('reference_number must be 1..200 chars');

    const supabase = getSupabaseAdmin();

    // Look up invoice; capture school_id and expected amount
    const { data: invoice, error: invErr } = await supabase
      .from('school_invoices')
      .select('id, school_id, amount_inr, status')
      .eq('id', invoiceId)
      .maybeSingle();
    if (invErr || !invoice) return err('Invoice not found', 404);
    if (invoice.status === 'paid' || invoice.status === 'cancelled') {
      return err(`Invoice is ${invoice.status}; cannot reconcile.`);
    }

    const expected = Number(invoice.amount_inr);
    if (Math.abs(expected - received) > AMOUNT_TOLERANCE_INR) {
      return err(
        `Received amount ₹${received.toFixed(2)} differs from expected ₹${expected.toFixed(2)} by more than ₹${AMOUNT_TOLERANCE_INR}. Add a note if intentional and resubmit.`,
      );
    }

    // Insert pending row. UNIQUE INDEX on (invoice_id) WHERE status='pending'
    // means a duplicate submission for the same invoice is rejected by the DB.
    const { data: inserted, error: insErr } = await supabase
      .from('payment_reconciliation_queue')
      .insert({
        invoice_id: invoiceId,
        school_id: invoice.school_id,
        expected_amount_inr: expected,
        received_amount_inr: received,
        payment_method: method,
        reference_number: reference,
        receipt_document_url: receiptUrl,
        submitted_by_user_id: auth.userId,
        notes,
        status: 'pending',
      })
      .select('id')
      .single();

    if (insErr) {
      // 23505 = unique_violation -> duplicate pending row for this invoice
      const code = (insErr as { code?: string }).code;
      if (code === '23505') {
        return err('A pending reconciliation already exists for this invoice. Approve or reject it first.', 409);
      }
      logger.error('reconciliation_insert_error', {
        error: new Error(insErr.message),
        route: '/api/super-admin/reconciliation',
      });
      return err('Failed to record reconciliation', 500);
    }

    capture('reconciliation_submitted', auth.userId, {
      reconciliation_id: inserted.id,
      invoice_id: invoiceId,
      school_id: invoice.school_id,
      payment_method: method as 'po' | 'bank_transfer' | 'cheque' | 'upi_offline',
      amount_inr: received,
    });

    // Offline payment submission needs an audit trail beyond PostHog —
    // financial reconciliation under the two-person rule must be queryable
    // from admin_audit_log for compliance.
    void logAdminAudit(
      auth,
      'reconciliation.submit',
      'payment_reconciliation_queue',
      inserted.id,
      {
        invoice_id: invoiceId,
        school_id: invoice.school_id,
        payment_method: method,
        received_amount_inr: received,
      },
      request.headers.get('x-forwarded-for') ?? undefined,
    );

    return NextResponse.json({ success: true, data: { id: inserted.id } });
  } catch (e) {
    logger.error('reconciliation_submit_unexpected', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: '/api/super-admin/reconciliation',
    });
    return err('Internal server error', 500);
  }
}
