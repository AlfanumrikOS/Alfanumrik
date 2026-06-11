/**
 * /api/super-admin/contracts
 *
 * GET  — list contracts with filters (school_id, status, page, limit)
 * POST — create a draft contract for a school
 *
 * Phase 3-C of the May 2026 upgrade. Gated by `ff_school_contracts_v1`.
 *
 * Auth: super-admin via authorizeAdmin. service_role used for DB.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { capture } from '@/lib/posthog/server';

export const runtime = 'nodejs';

const FLAG = 'ff_school_contracts_v1';

const VALID_STATUS = new Set(['draft', 'active', 'expiring', 'expired', 'cancelled', 'renewed']);
const VALID_BILLING_CYCLES = new Set(['monthly', 'quarterly', 'annual', 'custom']);

interface PostBody {
  school_id?: string;
  start_date?: string;
  end_date?: string;
  billing_cycle?: string;
  seats_purchased?: number;
  value_inr?: number;
  notes?: string;
}

function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// Indian financial year for a date — Apr 1 → Mar 31; "2526" = FY2025-26.
function financialYearForDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const startYear = m >= 4 ? y : y - 1;
  return `${String(startYear).slice(-2)}${String(startYear + 1).slice(-2)}`;
}

async function flagOn(userId: string): Promise<boolean> {
  return isFeatureEnabled(FLAG, {
    userId,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
}

// ─── GET ────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  if (!(await flagOn(auth.userId))) return err('School contracts are not enabled.', 403);

  try {
    const { searchParams } = new URL(request.url);
    const schoolId = searchParams.get('school_id');
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
    const offset = (page - 1) * limit;

    if (status && !VALID_STATUS.has(status)) {
      return err(`Invalid status. Must be one of: ${Array.from(VALID_STATUS).join(', ')}`);
    }

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from('school_contracts')
      .select(
        'id, school_id, previous_contract_id, contract_number, start_date, end_date, billing_cycle, seats_purchased, value_inr, pdf_url, signed_at, status, reminders_sent, notes, created_at, updated_at, schools(name)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (schoolId) query = query.eq('school_id', schoolId);
    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) {
      logger.error('contracts_list_error', { error: new Error(error.message), route: '/api/super-admin/contracts' });
      return err('Failed to fetch contracts', 500);
    }

    return NextResponse.json({ success: true, data: { rows: data ?? [], total: count ?? 0, page, limit } });
  } catch (e) {
    logger.error('contracts_list_unexpected', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: '/api/super-admin/contracts',
    });
    return err('Internal server error', 500);
  }
}

// ─── POST — create draft contract ───────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  if (!(await flagOn(auth.userId))) return err('School contracts are not enabled.', 403);

  try {
    const body = (await request.json()) as PostBody;
    const schoolId = (body.school_id ?? '').trim();
    const startDate = (body.start_date ?? '').trim();
    const endDate = (body.end_date ?? '').trim();
    const cycle = (body.billing_cycle ?? '').trim();
    const seats = Number(body.seats_purchased);
    const valueInr = Number(body.value_inr);
    const notes = (body.notes ?? '').trim() || null;

    if (!/^[0-9a-f-]{36}$/i.test(schoolId)) return err('school_id must be a UUID');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return err('start_date must be YYYY-MM-DD');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return err('end_date must be YYYY-MM-DD');
    if (new Date(endDate) <= new Date(startDate)) return err('end_date must be after start_date');
    if (!VALID_BILLING_CYCLES.has(cycle)) return err(`billing_cycle must be one of: ${Array.from(VALID_BILLING_CYCLES).join(', ')}`);
    if (!Number.isInteger(seats) || seats < 1 || seats > 100_000) return err('seats_purchased must be 1..100000');
    if (!Number.isFinite(valueInr) || valueInr <= 0) return err('value_inr must be > 0');

    const supabase = getSupabaseAdmin();

    // Verify school exists
    const { data: school, error: schoolErr } = await supabase
      .from('schools')
      .select('id, state')
      .eq('id', schoolId)
      .maybeSingle();
    if (schoolErr || !school) return err('School not found', 404);

    // Allocate contract number for the start_date's financial year + school state
    const finYear = financialYearForDate(new Date(startDate));
    const stateCode = (school.state ?? 'XX').toUpperCase().slice(0, 2);

    const { data: nextNum, error: rpcErr } = await supabase.rpc('next_contract_number', {
      p_financial_year: finYear,
      p_state_code: stateCode,
    });
    if (rpcErr || typeof nextNum !== 'number') {
      logger.error('contracts_seq_error', { error: rpcErr ? new Error(rpcErr.message) : new Error('non-numeric'), route: '/api/super-admin/contracts' });
      return err('Failed to allocate contract number', 500);
    }
    const contractNumber = `ALF-CTR/${finYear}/${stateCode}/${String(nextNum).padStart(5, '0')}`;

    const { data: inserted, error: insErr } = await supabase
      .from('school_contracts')
      .insert({
        school_id: schoolId,
        contract_number: contractNumber,
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
      logger.error('contracts_insert_error', { error: new Error(insErr.message), route: '/api/super-admin/contracts' });
      return err('Failed to create contract', 500);
    }

    capture('contract_drafted', auth.userId, {
      contract_id: inserted.id,
      school_id: schoolId,
      contract_number: inserted.contract_number,
      start_date: startDate,
      end_date: endDate,
      billing_cycle: cycle as 'monthly' | 'quarterly' | 'annual' | 'custom',
      seats_purchased: seats,
      value_inr: valueInr,
    });

    // B2B contracts are legal documents — every create/sign/cancel/renew
    // must hit admin_audit_log so we have a defensible operator trail
    // beyond PostHog analytics. Fire-and-forget; never block the response.
    void logAdminAudit(
      auth,
      'contract.create',
      'school_contract',
      inserted.id,
      {
        school_id: schoolId,
        contract_number: inserted.contract_number,
        start_date: startDate,
        end_date: endDate,
        billing_cycle: cycle,
        seats_purchased: seats,
        value_inr: valueInr,
      },
      request.headers.get('x-forwarded-for') ?? undefined,
    );

    return NextResponse.json({
      success: true,
      data: { id: inserted.id, contract_number: inserted.contract_number },
    });
  } catch (e) {
    logger.error('contracts_create_unexpected', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: '/api/super-admin/contracts',
    });
    return err('Internal server error', 500);
  }
}
