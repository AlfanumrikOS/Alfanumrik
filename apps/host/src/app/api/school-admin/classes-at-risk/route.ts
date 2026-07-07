/**
 * Phase 3B — School Command Center (Wave A)
 * GET /api/school-admin/classes-at-risk?limit&offset
 *
 * Per-class risk rollup (student_count, at_risk_count where avg p_know < 0.4,
 * avg_mastery), ordered most-at-risk first. Paginated.
 *
 * Thin handler: authorize (P9 institution.view_analytics) → resolve caller's
 * school server-side → parse+clamp pagination (default 20, max 100) → call the
 * SECURITY DEFINER read model through the USER-CONTEXT client → echo the page.
 *
 * Optional `?school_id=` is honored only when it matches one of the caller's
 * active school_admin memberships (else 403).
 *
 * Contract: src/lib/school-admin/command-center-types.ts (ClassesAtRiskResponse).
 * RPC:      get_classes_at_risk(p_school_id, p_limit, p_offset) in 20260614000000.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  resolveCommandCenterContext,
  rpcErrorResponse,
  parsePagination,
  COMMAND_CENTER_CACHE_CONTROL,
} from '@alfanumrik/lib/school-admin/command-center-context';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  type ClassesAtRiskResponse,
  type ClassAtRiskRow,
} from '@alfanumrik/lib/school-admin/command-center-types';
import { logger } from '@alfanumrik/lib/logger';
import { assertModuleEnabledForSchool } from '@alfanumrik/lib/modules/route-guard';

const ROUTE = '/api/school-admin/classes-at-risk';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveCommandCenterContext(request, ROUTE);
    if (!resolved.ok) return resolved.response;

    const { supabase, schoolId } = resolved.ctx;

    // Module gate: this risk rollup belongs to the `analytics` module (registry
    // routePrefix `/reports`). Disabled → 404; flag OFF / unresolved → allowed.
    const gate = await assertModuleEnabledForSchool(schoolId, 'analytics');
    if (!gate.allowed) return gate.response;

    const { limit, offset } = parsePagination(request, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);

    const { data, error } = await supabase.rpc('get_classes_at_risk', {
      p_school_id: schoolId,
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      return rpcErrorResponse(error, ROUTE);
    }

    // Empty result → normal 200 with an empty array.
    const rows = (data ?? []) as ClassAtRiskRow[];

    const body: ClassesAtRiskResponse = {
      data: rows,
      limit,
      offset,
      count: rows.length,
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': COMMAND_CENTER_CACHE_CONTROL },
    });
  } catch (err) {
    logger.error('command_center_classes_at_risk_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: ROUTE,
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
