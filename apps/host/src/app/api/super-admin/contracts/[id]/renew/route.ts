/**
 * /api/super-admin/contracts/[id]/renew
 *
 * POST — chain a renewal: creates a NEW draft contract referencing this one
 *        as previous_contract_id. Carries forward seats, billing_cycle, and
 *        (optionally) value_inr; new start_date defaults to the previous
 *        contract's end_date + 1 day. The previous contract transitions to
 *        status='renewed' (only after the new one is created so that on
 *        failure the previous remains usable).
 *
 * Body (all fields optional; defaults from previous contract):
 *   { start_date?, end_date?, billing_cycle?, seats_purchased?, value_inr?, notes? }
 *
 * Phase 3-C. Gated by `ff_school_contracts_v1`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@alfanumrik/lib/admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { capture } from '@alfanumrik/lib/posthog/server';

export const runtime = 'nodejs';

const FLAG = 'ff_school_contracts_v1';

interface PostBody {
  start_date?:     string;
  end_date?:       string;
  billing_cycle?:  'monthly' | 'quarterly' | 'annual' | 'custom';
  seats_purchased?: number;
  value_inr?:      number;
  notes?:          string;
}

function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function financialYearForDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const startYear = m >= 4 ? y : y - 1;
  return `${String(startYear).slice(-2)}${String(startYear + 1).slice(-2)}`;
}

function addOneYearISO(iso: string): string {
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function plusDaysISO(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;
  if (!(await isFeatureEnabled(FLAG, { userId: auth.userId, environment: process.env.VERCEL_ENV || process.env.NODE_ENV }))) {
    return err('School contracts are not enabled.', 403);
  }

  const { id: prevId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(prevId)) return err('Invalid id');

  let body: PostBody = {};
  try {
    body = (await request.json()) as PostBody;
  } catch {
    /* body is optional */
  }

  const supabase = getSupabaseAdmin();

  // Read previous contract
  const { data: prev, error: readErr } = await supabase
    .from('school_contracts')
    .select('id, school_id, status, end_date, billing_cycle, seats_purchased, value_inr')
    .eq('id', prevId)
    .maybeSingle();
  if (readErr || !prev) return err('Previous contract not found', 404);
  if (prev.status === 'renewed' || prev.status === 'cancelled') {
    return err(`Cannot renew a contract in status "${prev.status}"`, 409);
  }

  // Resolve fields, falling back to previous
  const startDate = (body.start_date ?? plusDaysISO(prev.end_date, 1)).trim();
  const endDate = (body.end_date ?? addOneYearISO(startDate)).trim();
  const cycle = body.billing_cycle ?? prev.billing_cycle;
  const seats = body.seats_purchased ?? prev.seats_purchased;
  const valueInr = body.value_inr ?? Number(prev.value_inr);
  const notes = (body.notes ?? '').trim() || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return err('start_date must be YYYY-MM-DD');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return err('end_date must be YYYY-MM-DD');
  if (new Date(endDate) <= new Date(startDate)) return err('end_date must be after start_date');

  // Look up school for state code (drives contract_number sequence partition)
  const { data: school } = await supabase
    .from('schools')
    .select('state')
    .eq('id', prev.school_id)
    .maybeSingle();
  const stateCode = (school?.state ?? 'XX').toUpperCase().slice(0, 2);
  const finYear = financialYearForDate(new Date(startDate));

  const { data: nextNum, error: rpcErr } = await supabase.rpc('next_contract_number', {
    p_financial_year: finYear,
    p_state_code: stateCode,
  });
  if (rpcErr || typeof nextNum !== 'number') {
    logger.error('contracts_renew_seq_error', { error: rpcErr ? new Error(rpcErr.message) : new Error('non-numeric'), route: '/api/super-admin/contracts/[id]/renew' });
    return err('Failed to allocate contract number', 500);
  }
  const newContractNumber = `ALF-CTR/${finYear}/${stateCode}/${String(nextNum).padStart(5, '0')}`;

  // Insert new draft contract
  const { data: inserted, error: insErr } = await supabase
    .from('school_contracts')
    .insert({
      school_id: prev.school_id,
      previous_contract_id: prevId,
      contract_number: newContractNumber,
      start_date: startDate,
      end_date: endDate,
      billing_cycle: cycle,
      seats_purchased: seats,
      value_inr: valueInr,
      notes,
      status: 'draft',
    })
    .select('id, contract_number')
    .single();

  if (insErr) {
    logger.error('contracts_renew_insert_error', { error: new Error(insErr.message), route: '/api/super-admin/contracts/[id]/renew' });
    return err('Failed to create renewal contract', 500);
  }

  // Transition previous to renewed (only after new draft exists). If this
  // fails, the new draft survives as orphan-but-valid; operator can clean
  // up via the cancel route.
  const { error: prevUpdErr } = await supabase
    .from('school_contracts')
    .update({ status: 'renewed' })
    .eq('id', prevId)
    .in('status', ['active', 'expiring', 'expired']);
  if (prevUpdErr) {
    logger.error('contracts_renew_prev_update_error', { error: new Error(prevUpdErr.message), route: '/api/super-admin/contracts/[id]/renew' });
    // Non-fatal — the new contract is the source of truth from here.
  }

  capture('contract_renewed', auth.userId, {
    new_contract_id: inserted.id,
    previous_contract_id: prevId,
    school_id: prev.school_id,
    new_contract_number: inserted.contract_number,
  });

  void logAdminAudit(
    auth,
    'contract.renew',
    'school_contract',
    inserted.id,
    {
      previous_contract_id: prevId,
      school_id: prev.school_id,
      new_contract_number: inserted.contract_number,
      start_date: startDate,
      end_date: endDate,
      billing_cycle: cycle,
      seats_purchased: seats,
      value_inr: valueInr,
      previous_transition_failed: !!prevUpdErr,
    },
    request.headers.get('x-forwarded-for') ?? undefined,
  );

  return NextResponse.json({
    success: true,
    data: {
      id: inserted.id,
      contract_number: inserted.contract_number,
      previous_contract_id: prevId,
    },
  });
}
