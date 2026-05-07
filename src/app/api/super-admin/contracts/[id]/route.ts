/**
 * /api/super-admin/contracts/[id]
 *
 * GET   — read a single contract.
 * PATCH — update a contract. Body { action: 'sign' | 'cancel', ...fields }.
 *
 * action: 'sign' transitions draft → active when:
 *   - pdf_url provided OR already set
 *   - records signed_at + signed_by_internal_user_id (caller).
 *   Refuses if school already has an active contract (UNIQUE INDEX).
 *
 * action: 'cancel' transitions any non-final status to cancelled.
 *
 * Phase 3-C. Gated by `ff_school_contracts_v1`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { capture } from '@/lib/posthog/server';

export const runtime = 'nodejs';

const FLAG = 'ff_school_contracts_v1';

interface PatchBody {
  action?: 'sign' | 'cancel';
  pdf_url?: string;
  signed_by_school_user_id?: string;
  reason?: string;
}

function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// ─── GET ────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;
  if (!(await isFeatureEnabled(FLAG, { userId: auth.userId, environment: process.env.VERCEL_ENV || process.env.NODE_ENV }))) {
    return err('School contracts are not enabled.', 403);
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return err('Invalid id');

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('school_contracts')
    .select('*, schools(name, state)')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logger.error('contracts_get_error', { error: new Error(error.message), route: '/api/super-admin/contracts/[id]' });
    return err('Failed to fetch contract', 500);
  }
  if (!data) return err('Contract not found', 404);

  return NextResponse.json({ success: true, data });
}

// ─── PATCH ──────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;
  if (!(await isFeatureEnabled(FLAG, { userId: auth.userId, environment: process.env.VERCEL_ENV || process.env.NODE_ENV }))) {
    return err('School contracts are not enabled.', 403);
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return err('Invalid id');

  let body: PatchBody = {};
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return err('Invalid JSON');
  }
  const action = body.action;
  if (action !== 'sign' && action !== 'cancel') {
    return err('action must be "sign" or "cancel"');
  }

  const supabase = getSupabaseAdmin();

  const { data: row, error: readErr } = await supabase
    .from('school_contracts')
    .select('id, school_id, status, pdf_url, contract_number')
    .eq('id', id)
    .maybeSingle();
  if (readErr || !row) return err('Contract not found', 404);

  if (action === 'sign') {
    if (row.status !== 'draft') {
      return err(`Can only sign a draft contract (current: ${row.status})`, 409);
    }
    const pdfUrl = (body.pdf_url ?? '').trim() || row.pdf_url;
    if (!pdfUrl) return err('pdf_url required to sign (attach the signed PDF first)');

    const signedBySchoolUserId = (body.signed_by_school_user_id ?? '').trim() || null;
    if (signedBySchoolUserId && !/^[0-9a-f-]{36}$/i.test(signedBySchoolUserId)) {
      return err('signed_by_school_user_id must be a UUID');
    }

    const { error: updErr } = await supabase
      .from('school_contracts')
      .update({
        status: 'active',
        pdf_url: pdfUrl,
        signed_at: new Date().toISOString(),
        signed_by_internal_user_id: auth.userId,
        signed_by_school_user_id: signedBySchoolUserId,
      })
      .eq('id', id)
      .eq('status', 'draft'); // optimistic concurrency

    if (updErr) {
      const code = (updErr as { code?: string }).code;
      if (code === '23505') {
        return err('This school already has an active contract. Cancel or expire it first.', 409);
      }
      logger.error('contracts_sign_error', { error: new Error(updErr.message), route: '/api/super-admin/contracts/[id]' });
      return err('Failed to sign contract', 500);
    }

    capture('contract_signed', auth.userId, {
      contract_id: id,
      school_id: row.school_id,
      contract_number: row.contract_number,
      signed_pdf_attached: Boolean(pdfUrl),
    });

    return NextResponse.json({ success: true, data: { id, status: 'active' } });
  }

  // action === 'cancel'
  if (row.status === 'cancelled' || row.status === 'expired' || row.status === 'renewed') {
    return err(`Cannot cancel a contract in status "${row.status}"`, 409);
  }
  const reason = (body.reason ?? '').trim() || null;

  const { error: updErr } = await supabase
    .from('school_contracts')
    .update({ status: 'cancelled', notes: reason })
    .eq('id', id);

  if (updErr) {
    logger.error('contracts_cancel_error', { error: new Error(updErr.message), route: '/api/super-admin/contracts/[id]' });
    return err('Failed to cancel contract', 500);
  }

  capture('contract_cancelled', auth.userId, {
    contract_id: id,
    school_id: row.school_id,
    prior_status: row.status,
    reason: reason ?? undefined,
  });

  return NextResponse.json({ success: true, data: { id, status: 'cancelled' } });
}
