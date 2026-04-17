import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/school-admin/subscription
 *
 * Return subscription details + seat usage for the admin's school.
 * Permission: school.manage_billing
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     subscription: { plan, seats_purchased, price_per_seat_monthly, status, ... } | null,
 *     seatsUsed: number  (count of active students)
 *   }
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_billing');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    // Run both queries in parallel, both scoped to schoolId
    const [subscriptionResult, seatCountResult] = await Promise.all([
      // School subscription record
      supabase
        .from('school_subscriptions')
        .select('id, school_id, plan, seats_purchased, price_per_seat_monthly, status, current_period_start, current_period_end, created_at, updated_at')
        .eq('school_id', schoolId)
        .maybeSingle(),

      // Count of active students = seats used
      supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .eq('is_active', true),
    ]);

    if (subscriptionResult.error) {
      logger.error('school_admin_subscription_fetch_failed', {
        error: new Error(subscriptionResult.error.message),
        route: '/api/school-admin/subscription',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch subscription' },
        { status: 500 }
      );
    }

    if (seatCountResult.error) {
      logger.error('school_admin_seat_count_failed', {
        error: new Error(seatCountResult.error.message),
        route: '/api/school-admin/subscription',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to count seats' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        subscription: subscriptionResult.data ?? null,
        seatsUsed: seatCountResult.count ?? 0,
      },
    });
  } catch (err) {
    logger.error('school_admin_subscription_get_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/subscription',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
