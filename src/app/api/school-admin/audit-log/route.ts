import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { SCHOOL_AUDIT_ACTIONS } from '@/lib/audit';

/**
 * GET /api/school-admin/audit-log — Paginated audit log viewer
 * Permission: school.manage_settings
 *
 * Query params:
 *   ?page=1        — Page number (1-based, default: 1)
 *   ?limit=25      — Items per page (max 100, default: 25)
 *   ?action=       — Filter by action type (e.g., 'teacher.invited')
 *   ?date_from=    — Filter from date (YYYY-MM-DD)
 *   ?date_to=      — Filter to date (YYYY-MM-DD)
 *
 * Returns: action, resource_type, resource_id, actor display name,
 *          created_at, metadata. Does NOT return actor email (P13).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_settings');
    if (!auth.authorized) return auth.errorResponse;

    const { searchParams } = new URL(request.url);

    // Parse pagination
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25));
    const offset = (page - 1) * limit;

    // Parse filters
    const actionFilter = searchParams.get('action') || null;
    const dateFrom = searchParams.get('date_from') || null;
    const dateTo = searchParams.get('date_to') || null;

    // Validate action filter against known types
    if (actionFilter && !(SCHOOL_AUDIT_ACTIONS as readonly string[]).includes(actionFilter)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid action filter. Must be one of: ${SCHOOL_AUDIT_ACTIONS.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Validate date filters
    if (dateFrom && isNaN(new Date(dateFrom).getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid date_from format. Use YYYY-MM-DD.' },
        { status: 400 }
      );
    }
    if (dateTo && isNaN(new Date(dateTo).getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid date_to format. Use YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Build query for audit log entries
    let query = supabase
      .from('school_audit_log')
      .select('id, actor_id, action, resource_type, resource_id, metadata, created_at', { count: 'exact' })
      .eq('school_id', auth.schoolId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (actionFilter) {
      query = query.eq('action', actionFilter);
    }
    if (dateFrom) {
      query = query.gte('created_at', new Date(dateFrom).toISOString());
    }
    if (dateTo) {
      // End of the date_to day
      const endDate = new Date(dateTo);
      endDate.setDate(endDate.getDate() + 1);
      query = query.lt('created_at', endDate.toISOString());
    }

    const { data: entries, error, count } = await query;

    if (error) {
      logger.error('school_audit_log_query_error', {
        error: new Error(error.message),
        route: '/api/school-admin/audit-log',
        schoolId: auth.schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch audit log' },
        { status: 500 }
      );
    }

    // Resolve actor display names from students, teachers, or school_admins tables.
    // P13: we return name only, never email/phone.
    const actorIds = [...new Set((entries ?? []).map((e) => e.actor_id))];
    const actorNameMap = new Map<string, string>();

    if (actorIds.length > 0) {
      // Try school_admins first (most likely actors for school admin audit logs)
      const { data: admins } = await supabase
        .from('school_admins')
        .select('auth_user_id, name')
        .in('auth_user_id', actorIds);

      for (const a of admins ?? []) {
        if (a.auth_user_id && a.name) {
          actorNameMap.set(a.auth_user_id, a.name);
        }
      }

      // Try teachers for any remaining
      const unresolvedIds = actorIds.filter((id) => !actorNameMap.has(id));
      if (unresolvedIds.length > 0) {
        const { data: teachers } = await supabase
          .from('teachers')
          .select('auth_user_id, name')
          .in('auth_user_id', unresolvedIds);

        for (const t of teachers ?? []) {
          if (t.auth_user_id && t.name) {
            actorNameMap.set(t.auth_user_id, t.name);
          }
        }
      }
    }

    // Format response entries
    const formattedEntries = (entries ?? []).map((e) => ({
      id: e.id,
      action: e.action,
      resource_type: e.resource_type,
      resource_id: e.resource_id,
      actor_name: actorNameMap.get(e.actor_id) || 'Unknown',
      metadata: e.metadata,
      created_at: e.created_at,
    }));

    return NextResponse.json({
      success: true,
      data: {
        entries: formattedEntries,
        pagination: {
          page,
          limit,
          total: count ?? 0,
          total_pages: count ? Math.ceil(count / limit) : 0,
        },
        filters: {
          action: actionFilter,
          date_from: dateFrom,
          date_to: dateTo,
        },
      },
    });
  } catch (err) {
    logger.error('school_audit_log_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/audit-log',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
