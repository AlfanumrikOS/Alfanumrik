import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { logger } from '@/lib/logger';

/**
 * GET /api/super-admin/invoices — List invoices with filters
 *
 * Query params:
 *   ?school_id=  — filter by school UUID (optional)
 *   ?status=     — filter by status: generated | sent | paid | overdue (optional)
 *   ?page=       — page number (default 1)
 *   ?limit=      — items per page (default 25, max 100)
 *
 * Returns invoices joined with school name, ordered by created_at DESC.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, parseInt(params.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '25')));
    const offset = (page - 1) * limit;
    const schoolId = params.get('school_id');
    const status = params.get('status');

    // Validate status if provided
    const VALID_STATUSES = ['generated', 'sent', 'paid', 'overdue'];
    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    const queryParts = [
      'select=id,school_id,period_start,period_end,seats_used,amount_inr,status,pdf_url,razorpay_invoice_id,created_at,updated_at,schools(name)',
      'order=created_at.desc',
      `offset=${offset}`,
      `limit=${limit}`,
    ];

    if (schoolId) {
      queryParts.push(`school_id=eq.${encodeURIComponent(schoolId)}`);
    }
    if (status) {
      queryParts.push(`status=eq.${encodeURIComponent(status)}`);
    }

    const res = await fetch(supabaseAdminUrl('school_invoices', queryParts.join('&')), {
      method: 'GET',
      headers: supabaseAdminHeaders(),
    });

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch invoices' },
        { status: res.status }
      );
    }

    const data = await res.json();
    const range = res.headers.get('content-range');
    const total = range ? parseInt(range.split('/')[1]) || 0 : data.length;

    // Flatten school name from the join
    const invoices = (data || []).map((inv: Record<string, unknown>) => {
      const school = inv.schools as { name: string } | null;
      return {
        id: inv.id,
        school_id: inv.school_id,
        school_name: school?.name || 'Unknown',
        period_start: inv.period_start,
        period_end: inv.period_end,
        seats_used: inv.seats_used,
        amount_inr: inv.amount_inr,
        status: inv.status,
        pdf_url: inv.pdf_url,
        razorpay_invoice_id: inv.razorpay_invoice_id,
        created_at: inv.created_at,
        updated_at: inv.updated_at,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        invoices,
        pagination: { page, limit, total, total_pages: total ? Math.ceil(total / limit) : 0 },
      },
    });
  } catch (err) {
    logger.error('super_admin_invoices_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/super-admin/invoices',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/super-admin/invoices — Generate invoice for a school
 *
 * Body: { school_id: string, period_start: string, period_end: string }
 *
 * Auto-calculates: count active students in the period -> seats_used,
 * multiply by price_per_seat_monthly from school record -> amount_inr.
 * Sets status = 'generated'.
 */
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { school_id, period_start, period_end } = body as {
      school_id?: string;
      period_start?: string;
      period_end?: string;
    };

    if (!school_id || typeof school_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'school_id is required' },
        { status: 400 }
      );
    }
    if (!period_start || !period_end) {
      return NextResponse.json(
        { success: false, error: 'period_start and period_end are required (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(period_start) || !dateRegex.test(period_end)) {
      return NextResponse.json(
        { success: false, error: 'Dates must be in YYYY-MM-DD format' },
        { status: 400 }
      );
    }

    if (new Date(period_start) >= new Date(period_end)) {
      return NextResponse.json(
        { success: false, error: 'period_start must be before period_end' },
        { status: 400 }
      );
    }

    // Fetch school details (max_students as seats_purchased, subscription_plan)
    const schoolRes = await fetch(
      supabaseAdminUrl('schools', `select=id,name,max_students,subscription_plan&id=eq.${encodeURIComponent(school_id)}&limit=1`),
      { headers: supabaseAdminHeaders() }
    );

    if (!schoolRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch school' },
        { status: 500 }
      );
    }

    const schools = await schoolRes.json();
    if (!Array.isArray(schools) || schools.length === 0) {
      return NextResponse.json(
        { success: false, error: 'School not found' },
        { status: 404 }
      );
    }

    const school = schools[0];

    // Count active students for this school in the period
    // Students linked to the school via class enrollments or direct school_id
    const studentCountRes = await fetch(
      supabaseAdminUrl(
        'students',
        `select=id&school_id=eq.${encodeURIComponent(school_id)}&is_active=eq.true&created_at=lte.${encodeURIComponent(period_end)}`
      ),
      { headers: supabaseAdminHeaders('count=exact') }
    );

    let seatsUsed = 0;
    if (studentCountRes.ok) {
      const contentRange = studentCountRes.headers.get('content-range');
      if (contentRange) {
        const total = parseInt(contentRange.split('/')[1]) || 0;
        seatsUsed = total;
      }
    }

    // Calculate amount: use a default per-seat price based on school plan
    // B2B pricing tiers (INR per seat per month)
    const SEAT_PRICES: Record<string, number> = {
      basic: 99,
      standard: 199,
      premium: 399,
      enterprise: 599,
    };
    const plan = (school.subscription_plan || 'standard') as string;
    const pricePerSeat = SEAT_PRICES[plan.toLowerCase()] || 199;
    const amountInr = seatsUsed * pricePerSeat;

    // Create the invoice
    const createRes = await fetch(supabaseAdminUrl('school_invoices'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify({
        school_id,
        period_start,
        period_end,
        seats_used: seatsUsed,
        amount_inr: amountInr,
        status: 'generated',
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      logger.error('super_admin_invoice_create_failed', {
        error: new Error(text),
        route: '/api/super-admin/invoices',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to create invoice' },
        { status: 500 }
      );
    }

    const created = await createRes.json();
    const invoiceId = Array.isArray(created) ? created[0]?.id : created?.id;

    await logAdminAudit(auth, 'invoice.generated', 'school_invoice', invoiceId || '', {
      school_id,
      school_name: school.name,
      period_start,
      period_end,
      seats_used: seatsUsed,
      amount_inr: amountInr,
    });

    return NextResponse.json(
      { success: true, data: Array.isArray(created) ? created[0] : created },
      { status: 201 }
    );
  } catch (err) {
    logger.error('super_admin_invoices_post_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/super-admin/invoices',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/super-admin/invoices — Update invoice status
 *
 * Body: { id: string, status: string }
 *
 * Valid transitions:
 *   generated -> sent
 *   sent -> paid | overdue
 *   overdue -> paid
 */
export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { id, status } = body as { id?: string; status?: string };

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invoice id is required' },
        { status: 400 }
      );
    }

    const VALID_STATUSES = ['generated', 'sent', 'paid', 'overdue'];
    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    // Fetch current invoice to validate transition
    const currentRes = await fetch(
      supabaseAdminUrl('school_invoices', `select=id,status,school_id&id=eq.${encodeURIComponent(id)}&limit=1`),
      { headers: supabaseAdminHeaders() }
    );

    if (!currentRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch invoice' },
        { status: 500 }
      );
    }

    const invoices = await currentRes.json();
    if (!Array.isArray(invoices) || invoices.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invoice not found' },
        { status: 404 }
      );
    }

    const current = invoices[0];

    // Validate status transitions
    const VALID_TRANSITIONS: Record<string, string[]> = {
      generated: ['sent'],
      sent: ['paid', 'overdue'],
      overdue: ['paid'],
      paid: [], // terminal state
    };

    const allowed = VALID_TRANSITIONS[current.status] || [];
    if (!allowed.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Cannot transition from "${current.status}" to "${status}". Allowed: ${allowed.join(', ') || 'none (terminal state)'}` },
        { status: 400 }
      );
    }

    // Update the invoice
    const updateRes = await fetch(
      supabaseAdminUrl('school_invoices', `id=eq.${encodeURIComponent(id)}`),
      {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify({
          status,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!updateRes.ok) {
      const text = await updateRes.text();
      logger.error('super_admin_invoice_update_failed', {
        error: new Error(text),
        route: '/api/super-admin/invoices',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to update invoice' },
        { status: 500 }
      );
    }

    const updated = await updateRes.json();

    await logAdminAudit(auth, `invoice.${status}`, 'school_invoice', id, {
      school_id: current.school_id,
      from_status: current.status,
      to_status: status,
    });

    return NextResponse.json({
      success: true,
      data: Array.isArray(updated) ? updated[0] : updated,
    });
  } catch (err) {
    logger.error('super_admin_invoices_patch_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/super-admin/invoices',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
