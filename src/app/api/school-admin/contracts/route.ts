/**
 * /api/school-admin/contracts
 *
 * GET — list this school's contracts (read-only). RLS-scoped via the
 *       `school_admin_can_read_own_contracts` policy on school_contracts.
 *
 * No mutations: contract creation/sign/renew/cancel is super-admin-only
 * (CS-driven workflow). School admins can only view + download.
 *
 * Phase 3-C. Gated by `ff_school_contracts_v1`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/feature-flags';

export const runtime = 'nodejs';

const FLAG = 'ff_school_contracts_v1';

const VALID_STATUS = new Set(['draft', 'active', 'expiring', 'expired', 'cancelled', 'renewed']);

function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage');
    if (!auth.authorized) return auth.errorResponse;

    if (!(await isFeatureEnabled(FLAG, {
      userId: auth.userId ?? undefined,
      institutionId: auth.schoolId ?? undefined,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    }))) {
      return err('School contracts are not enabled.', 403);
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
    const offset = (page - 1) * limit;

    if (status && !VALID_STATUS.has(status)) {
      return err(`Invalid status. Must be one of: ${Array.from(VALID_STATUS).join(', ')}`);
    }

    // Use service-role client; the explicit .eq('school_id', auth.schoolId)
    // matches the RLS policy semantics. Belt-and-suspenders: even if the
    // RLS were ever loosened, this route only ever returns this school's
    // rows.
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from('school_contracts')
      .select(
        'id, contract_number, start_date, end_date, billing_cycle, seats_purchased, value_inr, pdf_url, signed_at, status, previous_contract_id, created_at, updated_at',
        { count: 'exact' },
      )
      .eq('school_id', auth.schoolId)
      .order('start_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;
    if (error) {
      logger.error('school_admin_contracts_list_error', {
        error: new Error(error.message),
        route: '/api/school-admin/contracts',
        schoolId: auth.schoolId,
      });
      return err('Failed to fetch contracts', 500);
    }

    return NextResponse.json({
      success: true,
      data: { rows: data ?? [], total: count ?? 0, page, limit },
    });
  } catch (e) {
    logger.error('school_admin_contracts_list_unexpected', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: '/api/school-admin/contracts',
    });
    return err('Internal server error', 500);
  }
}
