import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/school-admin/invoices — List invoices for the authenticated school
 *
 * Permission: institution.manage
 * Scoped to auth.schoolId (school admin can only see their own invoices).
 *
 * Query params:
 *   ?status= — filter by status: generated | sent | paid | overdue (optional)
 *   ?page=   — page number (default 1)
 *   ?limit=  — items per page (default 25, max 100)
 *
 * Returns invoices ordered by period_start DESC.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.manage');
    if (!auth.authorized) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
    const offset = (page - 1) * limit;

    // Validate status if provided
    const VALID_STATUSES = ['generated', 'sent', 'paid', 'overdue'];
    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('school_invoices')
      .select('id, school_id, period_start, period_end, seats_used, amount_inr, status, pdf_url, razorpay_invoice_id, created_at, updated_at', { count: 'exact' })
      .eq('school_id', auth.schoolId)
      .order('period_start', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: invoices, error, count } = await query;

    if (error) {
      logger.error('school_admin_invoices_list_error', {
        error: new Error(error.message),
        route: '/api/school-admin/invoices',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch invoices' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        invoices: invoices || [],
        pagination: {
          page,
          limit,
          total: count ?? 0,
          total_pages: count ? Math.ceil(count / limit) : 0,
        },
      },
    });
  } catch (err) {
    logger.error('school_admin_invoices_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/invoices',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
