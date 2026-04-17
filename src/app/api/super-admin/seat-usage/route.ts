import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { logger } from '@/lib/logger';

/**
 * GET /api/super-admin/seat-usage — Seat usage history for a school
 *
 * Query params:
 *   ?school_id= (required) — school UUID
 *   ?days=30    (optional)  — number of days of history (default 30, max 365)
 *
 * Returns daily snapshots from school_seat_usage table,
 * plus current active student count vs seats_purchased.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const schoolId = params.get('school_id');
    const days = Math.min(365, Math.max(1, parseInt(params.get('days') || '30')));

    if (!schoolId) {
      return NextResponse.json(
        { success: false, error: 'school_id query parameter is required' },
        { status: 400 }
      );
    }

    // Calculate date range
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0]; // YYYY-MM-DD

    // Fetch snapshots
    const snapshotQuery = [
      'select=id,school_id,snapshot_date,active_students,seats_purchased,utilization_pct',
      `school_id=eq.${encodeURIComponent(schoolId)}`,
      `snapshot_date=gte.${sinceStr}`,
      'order=snapshot_date.desc',
      'limit=365',
    ].join('&');

    const snapshotRes = await fetch(
      supabaseAdminUrl('school_seat_usage', snapshotQuery),
      { headers: supabaseAdminHeaders() }
    );

    if (!snapshotRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch seat usage' },
        { status: snapshotRes.status }
      );
    }

    const snapshots = await snapshotRes.json();

    // Fetch current counts: active students and school max_students (seats_purchased)
    const schoolRes = await fetch(
      supabaseAdminUrl('schools', `select=id,name,max_students,subscription_plan&id=eq.${encodeURIComponent(schoolId)}&limit=1`),
      { headers: supabaseAdminHeaders() }
    );

    let current = { active_students: 0, seats_purchased: 0, utilization_pct: 0, school_name: '' };

    if (schoolRes.ok) {
      const schools = await schoolRes.json();
      if (Array.isArray(schools) && schools.length > 0) {
        const school = schools[0];
        const seatsPurchased = school.max_students || 0;
        current.seats_purchased = seatsPurchased;
        current.school_name = school.name || '';

        // Count active students for this school
        const countRes = await fetch(
          supabaseAdminUrl('students', `select=id&school_id=eq.${encodeURIComponent(schoolId)}&is_active=eq.true`),
          { headers: supabaseAdminHeaders('count=exact') }
        );

        if (countRes.ok) {
          const contentRange = countRes.headers.get('content-range');
          if (contentRange) {
            current.active_students = parseInt(contentRange.split('/')[1]) || 0;
          }
        }

        current.utilization_pct = seatsPurchased > 0
          ? Math.round((current.active_students / seatsPurchased) * 100)
          : 0;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        current,
        snapshots: snapshots || [],
        days,
      },
    });
  } catch (err) {
    logger.error('super_admin_seat_usage_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/super-admin/seat-usage',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/super-admin/seat-usage — Record daily seat usage snapshot
 *
 * Body: { school_id?: string }
 *   - If school_id is provided, snapshot only that school
 *   - If null/omitted, snapshot ALL active schools
 *
 * For each school: counts active students, gets seats_purchased (max_students),
 * calculates utilization_pct, upserts into school_seat_usage (unique on school_id + snapshot_date).
 */
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is ok — means snapshot all schools
    }

    const targetSchoolId = (body.school_id as string) || null;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Fetch schools to snapshot
    let schoolQuery = 'select=id,name,max_students&is_active=eq.true';
    if (targetSchoolId) {
      schoolQuery += `&id=eq.${encodeURIComponent(targetSchoolId)}`;
    }
    schoolQuery += '&limit=500'; // reasonable upper bound

    const schoolRes = await fetch(
      supabaseAdminUrl('schools', schoolQuery),
      { headers: supabaseAdminHeaders() }
    );

    if (!schoolRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch schools' },
        { status: 500 }
      );
    }

    const schools = await schoolRes.json();
    if (!Array.isArray(schools) || schools.length === 0) {
      return NextResponse.json(
        { success: false, error: targetSchoolId ? 'School not found' : 'No active schools' },
        { status: 404 }
      );
    }

    const results: Array<{
      school_id: string;
      school_name: string;
      active_students: number;
      seats_purchased: number;
      utilization_pct: number;
    }> = [];

    let errors = 0;

    for (const school of schools) {
      try {
        // Count active students for this school
        const countRes = await fetch(
          supabaseAdminUrl('students', `select=id&school_id=eq.${encodeURIComponent(school.id)}&is_active=eq.true`),
          { headers: supabaseAdminHeaders('count=exact') }
        );

        let activeStudents = 0;
        if (countRes.ok) {
          const contentRange = countRes.headers.get('content-range');
          if (contentRange) {
            activeStudents = parseInt(contentRange.split('/')[1]) || 0;
          }
        }

        const seatsPurchased = school.max_students || 0;
        const utilizationPct = seatsPurchased > 0
          ? Math.round((activeStudents / seatsPurchased) * 100)
          : 0;

        // Upsert snapshot (unique on school_id + snapshot_date)
        const upsertRes = await fetch(supabaseAdminUrl('school_seat_usage'), {
          method: 'POST',
          headers: {
            ...supabaseAdminHeaders('return=representation,resolution=merge-duplicates'),
          },
          body: JSON.stringify({
            school_id: school.id,
            snapshot_date: today,
            active_students: activeStudents,
            seats_purchased: seatsPurchased,
            utilization_pct: utilizationPct,
          }),
        });

        if (upsertRes.ok) {
          results.push({
            school_id: school.id,
            school_name: school.name,
            active_students: activeStudents,
            seats_purchased: seatsPurchased,
            utilization_pct: utilizationPct,
          });
        } else {
          errors++;
          logger.error('seat_usage_snapshot_upsert_failed', {
            error: new Error(await upsertRes.text()),
            route: '/api/super-admin/seat-usage',
          });
        }
      } catch (e) {
        errors++;
        logger.error('seat_usage_snapshot_school_error', {
          error: e instanceof Error ? e : new Error(String(e)),
          route: '/api/super-admin/seat-usage',
        });
      }
    }

    await logAdminAudit(auth, 'seat_usage.snapshot', 'school_seat_usage', targetSchoolId || 'all', {
      schools_processed: results.length,
      errors,
      snapshot_date: today,
    });

    return NextResponse.json({
      success: true,
      data: {
        snapshot_date: today,
        schools_processed: results.length,
        errors,
        results,
      },
    }, { status: 201 });
  } catch (err) {
    logger.error('super_admin_seat_usage_post_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/super-admin/seat-usage',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
