/**
 * Phase 3B — School Command Center (Wave D)
 * GET /api/school-admin/reports/bloom
 *
 * Bloom's distribution across the school's active students' quiz_responses,
 * grouped by bloom_level (NULL/empty → 'unspecified' so the distribution is
 * exhaustive). Per bucket: response_count, correct_count, accuracy.
 *
 * Thin handler:
 *   1. Flag gate (ff_school_reports_depth) FIRST — 404 BEFORE auth when OFF, so
 *      the flag-OFF portal is byte-identical (this endpoint is not present today).
 *   2. Resolve caller's school + authorize (institution.view_analytics) and build
 *      the USER-CONTEXT client via resolveCommandCenterContext (so auth.uid()
 *      resolves and the SECURITY DEFINER RPC's internal scope guard passes).
 *   3. Call get_school_bloom_summary → echo `{ data }`.
 *
 * Error mapping: RPC 42501 (scope guard) → 403, empty → 200 with an empty array.
 *
 * Bloom's level names (remember→understand→…→create) are technical terms — NOT
 * translated even when isHi (P7 exception); the API only emits the raw level.
 *
 * Contract: src/lib/school-admin/reporting-types.ts (BloomSummaryResponse).
 * RPC:      get_school_bloom_summary(p_school_id) in 20260614000003.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  resolveCommandCenterContext,
  COMMAND_CENTER_REPORTS_CACHE_CONTROL,
} from '@alfanumrik/lib/school-admin/command-center-context';
import {
  reportingRpcErrorResponse,
  type BloomSummaryResponse,
  type BloomSummaryRow,
} from '@alfanumrik/lib/school-admin/reporting-types';
import { isFeatureEnabled, SCHOOL_REPORTS_DEPTH_FLAGS } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';

const ROUTE = '/api/school-admin/reports/bloom';

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
    // 2. Authorize (institution.view_analytics) + resolve school + user-context client.
    const resolved = await resolveCommandCenterContext(request, ROUTE);
    if (!resolved.ok) return resolved.response;

    const { supabase, schoolId } = resolved.ctx;

    // 3. Single RPC call through the user-context client.
    const { data, error } = await supabase.rpc('get_school_bloom_summary', {
      p_school_id: schoolId,
    });

    if (error) {
      return reportingRpcErrorResponse(error, ROUTE);
    }

    // Empty result → normal 200 with an empty array.
    const rows = (data ?? []) as BloomSummaryRow[];

    const body: BloomSummaryResponse = { data: rows };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': COMMAND_CENTER_REPORTS_CACHE_CONTROL },
    });
  } catch (err) {
    logger.error('school_reporting_bloom_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: ROUTE,
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
