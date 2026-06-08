/**
 * Phase 3B — School Command Center (Wave A)
 * GET /api/school-admin/teacher-engagement?limit&offset
 *
 * Per-teacher activity (class_count, remediation_assigned_count,
 * remediation_resolved_count), ordered most-assigned first. Paginated.
 *
 * Thin handler: authorize (P9 institution.view_analytics) → resolve caller's
 * school server-side → parse+clamp pagination (default 20, max 100) → call the
 * SECURITY DEFINER read model through the USER-CONTEXT client → echo the page.
 *
 * Optional `?school_id=` is honored only when it matches one of the caller's
 * active school_admin memberships (else 403).
 *
 * Contract: src/lib/school-admin/command-center-types.ts (TeacherEngagementResponse).
 * RPC:      get_teacher_engagement(p_school_id, p_limit, p_offset) in 20260614000000.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  resolveCommandCenterContext,
  rpcErrorResponse,
  parsePagination,
  COMMAND_CENTER_CACHE_CONTROL,
} from '@/lib/school-admin/command-center-context';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  type TeacherEngagementResponse,
  type TeacherEngagementRow,
} from '@/lib/school-admin/command-center-types';
import { logger } from '@/lib/logger';

const ROUTE = '/api/school-admin/teacher-engagement';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveCommandCenterContext(request, ROUTE);
    if (!resolved.ok) return resolved.response;

    const { supabase, schoolId } = resolved.ctx;
    const { limit, offset } = parsePagination(request, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);

    const { data, error } = await supabase.rpc('get_teacher_engagement', {
      p_school_id: schoolId,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      return rpcErrorResponse(error, ROUTE);
    }

    // Empty result → normal 200 with an empty array.
    const rows = (data ?? []) as TeacherEngagementRow[];

    const body: TeacherEngagementResponse = {
      data: rows,
      limit,
      offset,
      count: rows.length,
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': COMMAND_CENTER_CACHE_CONTROL },
    });
  } catch (err) {
    logger.error('command_center_teacher_engagement_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: ROUTE,
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
