/**
 * Phase 3B — School Command Center (Wave D)
 * GET /api/school-admin/reports/mastery?group_by=grade|subject|teacher
 *
 * School-wide mastery comparatives grouped by grade | subject | teacher.
 *
 * Thin handler:
 *   1. Flag gate (ff_school_reports_depth) FIRST — 404 BEFORE auth when OFF, so
 *      the flag-OFF portal is byte-identical (this endpoint is not present today).
 *   2. Validate ?group_by (default 'grade'; reject unknown with 400 BEFORE the RPC).
 *   3. Resolve caller's school + authorize (institution.view_analytics) and build
 *      the USER-CONTEXT client via resolveCommandCenterContext (so auth.uid()
 *      resolves and the SECURITY DEFINER RPC's internal scope guard passes).
 *   4. Call get_school_mastery_rollup → echo `{ data, group_by }`.
 *
 * Error mapping: RPC 22023 (bad group_by) → 400, 42501 (scope guard) → 403,
 * empty → 200 with an empty array.
 *
 * Contract: src/lib/school-admin/reporting-types.ts (MasteryRollupResponse).
 * RPC:      get_school_mastery_rollup(p_school_id, p_group_by) in 20260614000003.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  resolveCommandCenterContext,
  COMMAND_CENTER_REPORTS_CACHE_CONTROL,
} from '@alfanumrik/lib/school-admin/command-center-context';
import {
  reportingRpcErrorResponse,
  DEFAULT_MASTERY_GROUP_BY,
  VALID_MASTERY_GROUP_BY,
  type MasteryGroupBy,
  type MasteryRollupResponse,
  type MasteryRollupRow,
} from '@alfanumrik/lib/school-admin/reporting-types';
import { isFeatureEnabled, SCHOOL_REPORTS_DEPTH_FLAGS } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';

const ROUTE = '/api/school-admin/reports/mastery';

export const dynamic = 'force-dynamic';

/** Uniform "feature absent" response when the flag is OFF (404 before auth). */
function notPresent(): NextResponse {
  return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
}

export async function GET(request: NextRequest) {
  // 1. Flag OFF → endpoint behaves as not-present, BEFORE any auth work.
  const enabled = await isFeatureEnabled(SCHOOL_REPORTS_DEPTH_FLAGS.V1, {
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
  });
  if (!enabled) return notPresent();

  try {
    // 2. Validate ?group_by BEFORE calling the RPC. Default 'grade'; reject unknown.
    const rawGroupBy = new URL(request.url).searchParams.get('group_by')?.trim().toLowerCase();
    const groupBy: MasteryGroupBy = rawGroupBy
      ? VALID_MASTERY_GROUP_BY.has(rawGroupBy)
        ? (rawGroupBy as MasteryGroupBy)
        : ('__invalid__' as MasteryGroupBy)
      : DEFAULT_MASTERY_GROUP_BY;

    if (groupBy === ('__invalid__' as MasteryGroupBy)) {
      return NextResponse.json(
        { success: false, error: 'Invalid group_by (expected grade | subject | teacher)' },
        { status: 400 },
      );
    }

    // 3. Authorize (institution.view_analytics) + resolve school + user-context client.
    const resolved = await resolveCommandCenterContext(request, ROUTE);
    if (!resolved.ok) return resolved.response;

    const { supabase, schoolId } = resolved.ctx;

    // 4. Single RPC call through the user-context client.
    const { data, error } = await supabase.rpc('get_school_mastery_rollup', {
      p_school_id: schoolId,
      p_group_by: groupBy,
    });

    if (error) {
      return reportingRpcErrorResponse(error, ROUTE);
    }

    // Empty result → normal 200 with an empty array.
    const rows = (data ?? []) as MasteryRollupRow[];

    const body: MasteryRollupResponse = {
      data: rows,
      group_by: groupBy,
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': COMMAND_CENTER_REPORTS_CACHE_CONTROL },
    });
  } catch (err) {
    logger.error('school_reporting_mastery_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: ROUTE,
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
