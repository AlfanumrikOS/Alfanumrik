import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '@/lib/admin-auth';

// ─── GET — billing details for a school ─────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const schoolId = params.get('school_id');

    if (!schoolId) {
      return NextResponse.json(
        { success: false, error: 'school_id query parameter is required.' },
        { status: 400 },
      );
    }

    // Parallel fetch: subscription details + student count for seat usage
    const [subRes, studentsRes, schoolRes] = await Promise.all([
      fetch(
        supabaseAdminUrl(
          'school_subscriptions',
          `select=id,school_id,plan,billing_cycle,seats_purchased,price_per_seat_monthly,status,razorpay_subscription_id,current_period_start,current_period_end,created_at,updated_at&school_id=eq.${encodeURIComponent(schoolId)}&order=created_at.desc&limit=1`,
        ),
        { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
      ),
      // Count active students for seat usage
      fetch(
        supabaseAdminUrl(
          'students',
          `select=id&school_id=eq.${encodeURIComponent(schoolId)}&is_active=eq.true`,
        ),
        { method: 'HEAD', headers: supabaseAdminHeaders() },
      ),
      // School basic info for billing context
      fetch(
        supabaseAdminUrl(
          'schools',
          `select=id,name,slug,billing_email&id=eq.${encodeURIComponent(schoolId)}&limit=1`,
        ),
        { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
      ),
    ]);

    // Parse subscription
    let subscription = null;
    if (subRes.ok) {
      const subData = await subRes.json();
      subscription = Array.isArray(subData) && subData.length > 0 ? subData[0] : null;
    }

    // Parse student count from content-range header
    let activeStudents = 0;
    if (studentsRes.ok) {
      const range = studentsRes.headers.get('content-range');
      activeStudents = range ? parseInt(range.split('/')[1]) || 0 : 0;
    }

    // Parse school info
    let school = null;
    if (schoolRes.ok) {
      const schoolData = await schoolRes.json();
      school = Array.isArray(schoolData) && schoolData.length > 0 ? schoolData[0] : null;
    }

    if (!school) {
      return NextResponse.json(
        { success: false, error: 'School not found.' },
        { status: 404 },
      );
    }

    // Compute billing summary
    const seatsPurchased = subscription?.seats_purchased || 0;
    const pricePerSeat = subscription?.price_per_seat_monthly || 0;
    const monthlyTotal = seatsPurchased * pricePerSeat;
    const seatUtilization = seatsPurchased > 0
      ? Math.round((activeStudents / seatsPurchased) * 100)
      : 0;

    return NextResponse.json({
      success: true,
      data: {
        school: {
          id: school.id,
          name: school.name,
          slug: school.slug,
          billing_email: school.billing_email,
        },
        subscription: subscription
          ? {
              id: subscription.id,
              plan: subscription.plan,
              billing_cycle: subscription.billing_cycle,
              seats_purchased: subscription.seats_purchased,
              price_per_seat_monthly: subscription.price_per_seat_monthly,
              status: subscription.status,
              razorpay_subscription_id: subscription.razorpay_subscription_id,
              current_period_start: subscription.current_period_start,
              current_period_end: subscription.current_period_end,
            }
          : null,
        seat_usage: {
          purchased: seatsPurchased,
          active_students: activeStudents,
          utilization_percent: seatUtilization,
          available: Math.max(0, seatsPurchased - activeStudents),
        },
        billing_summary: {
          monthly_total: monthlyTotal,
          price_per_seat: pricePerSeat,
          currency: 'INR',
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ─── PATCH — update billing details ─────────────────────────────

export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { school_id, seats_purchased, price_per_seat_monthly, plan, status } = body;

    if (!school_id || typeof school_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'school_id is required.' },
        { status: 400 },
      );
    }

    // Validate status if provided
    const validStatuses = ['active', 'trial', 'expired', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    // Validate seats if provided
    if (seats_purchased !== undefined && (typeof seats_purchased !== 'number' || seats_purchased < 1)) {
      return NextResponse.json(
        { success: false, error: 'seats_purchased must be a positive number.' },
        { status: 400 },
      );
    }

    // Validate price if provided
    if (price_per_seat_monthly !== undefined && (typeof price_per_seat_monthly !== 'number' || price_per_seat_monthly < 0)) {
      return NextResponse.json(
        { success: false, error: 'price_per_seat_monthly must be a non-negative number.' },
        { status: 400 },
      );
    }

    // Build update payload — only include provided fields
    const updates: Record<string, unknown> = {};
    if (seats_purchased !== undefined) updates.seats_purchased = seats_purchased;
    if (price_per_seat_monthly !== undefined) updates.price_per_seat_monthly = price_per_seat_monthly;
    if (plan !== undefined) updates.plan = plan;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update.' },
        { status: 400 },
      );
    }

    // Update subscription
    const updateRes = await fetch(
      supabaseAdminUrl(
        'school_subscriptions',
        `school_id=eq.${encodeURIComponent(school_id)}&order=created_at.desc&limit=1`,
      ),
      {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify(updates),
      },
    );

    if (!updateRes.ok) {
      const text = await updateRes.text();
      return NextResponse.json(
        { success: false, error: `Update failed: ${text}` },
        { status: updateRes.status },
      );
    }

    const updated = await updateRes.json();
    if (Array.isArray(updated) && updated.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No subscription found for this school.' },
        { status: 404 },
      );
    }

    // Audit trail (no PII per P13)
    await logAdminAudit(
      auth,
      'school.billing_updated',
      'school_subscription',
      school_id,
      { fields_updated: Object.keys(updates) },
      request.headers.get('x-forwarded-for') || undefined,
    );

    const sub = Array.isArray(updated) ? updated[0] : updated;
    return NextResponse.json({
      success: true,
      data: {
        id: sub.id,
        school_id: sub.school_id,
        plan: sub.plan,
        billing_cycle: sub.billing_cycle,
        seats_purchased: sub.seats_purchased,
        price_per_seat_monthly: sub.price_per_seat_monthly,
        status: sub.status,
        current_period_start: sub.current_period_start,
        current_period_end: sub.current_period_end,
        updated_at: sub.updated_at,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
