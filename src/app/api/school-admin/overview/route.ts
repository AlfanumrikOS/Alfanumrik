/**
 * Phase 3B — School Command Center (Wave A)
 * GET /api/school-admin/overview
 *
 * One-pass snapshot for the Command Center home: class/teacher/student counts,
 * seats, seat utilization, average BKT mastery, and a data_state hint.
 *
 * Thin handler: authorize (P9 institution.view_analytics) → resolve caller's
 * school server-side → call the SECURITY DEFINER read model through the
 * USER-CONTEXT client (so auth.uid() resolves and the RPC's internal
 * school-scope guard passes) → shape the response. No business logic.
 *
 * Optional `?school_id=` is honored only when it matches one of the caller's
 * active school_admin memberships (else 403).
 *
 * Contract: src/lib/school-admin/command-center-types.ts (OverviewResponse).
 * RPC:      get_school_overview(p_school_id) in migration 20260614000000.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  resolveCommandCenterContext,
  rpcErrorResponse,
  COMMAND_CENTER_CACHE_CONTROL,
} from '@/lib/school-admin/command-center-context';
import type {
  OverviewResponse,
  SchoolOverview,
  SchoolDataState,
} from '@/lib/school-admin/command-center-types';
import { logger } from '@/lib/logger';

const ROUTE = '/api/school-admin/overview';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveCommandCenterContext(request, ROUTE);
    if (!resolved.ok) return resolved.response;

    const { supabase, schoolId } = resolved.ctx;

    const { data, error } = await supabase.rpc('get_school_overview', {
      p_school_id: schoolId,
    });

    if (error) {
      return rpcErrorResponse(error, ROUTE);
    }

    // The RPC returns a single jsonb object; treat a null/empty result as an
    // empty-but-valid snapshot rather than 500ing the home screen.
    const overview = (data ?? null) as SchoolOverview | null;
    const dataState: SchoolDataState =
      overview?.data_state === 'live' ? 'live' : 'no_data';

    const body: OverviewResponse = {
      data:
        overview ??
        ({
          class_count: 0,
          teacher_count: 0,
          student_count: 0,
          seats_purchased: 0,
          active_students: 0,
          seat_utilization_pct: null,
          avg_mastery: null,
          data_state: 'no_data',
        } satisfies SchoolOverview),
      data_state: dataState,
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': COMMAND_CENTER_CACHE_CONTROL },
    });
  } catch (err) {
    logger.error('command_center_overview_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: ROUTE,
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
