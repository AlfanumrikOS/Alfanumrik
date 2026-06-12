/**
 * GET /api/pulse/me — Student Pulse, SELF lens.
 *
 * The signed-in student's own Pulse: status + activity timeline + mastery
 * summary + the three derived signals. One route, one audience (the student
 * themselves).
 *
 * Auth contract:
 *   1. authorizeRequest(request, 'progress.view_own') — P9 RBAC gate. The
 *      student role carries progress.view_own; this is the matrix permission
 *      for the self lens per the design spec §5.
 *   2. The caller's OWN auth_user_id IS the subject — no cross-student access
 *      is possible from this route, so no canAccessStudent check is needed
 *      (the boundary is "yourself").
 *
 * Data access: assembled server-side via buildSingleStudentPulse() which uses
 * the service-role admin client AFTER the RBAC gate (P8: supabase-admin is
 * server-only; the gate is the boundary). P13: the response carries only the
 * viewer's own derived signals + non-PII timeline summaries.
 *
 * Returns: 401 unauth, 403 no-permission/no-profile, 500 on error.
 */

import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { buildSingleStudentPulse } from '@/lib/pulse/pulse-server';
import type { PulseResponse } from '@/lib/pulse/types';

const ROUTE = '/api/pulse/me';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // ── 1. RBAC gate (P9) ────────────────────────────────────────────
    const auth = await authorizeRequest(request, 'progress.view_own');
    if (!auth.authorized) return auth.errorResponse!;

    const authUserId = auth.userId!;

    // ── 2. Build the self Pulse ──────────────────────────────────────
    let pulse: PulseResponse;
    try {
      pulse = await buildSingleStudentPulse(supabaseAdmin, authUserId);
    } catch (e) {
      // buildStudentState throws when there is no students row for the caller
      // (e.g. a non-student role that somehow holds progress.view_own). Treat
      // as a 403 "no learner profile" rather than a 500.
      logger.warn('pulse_me_no_profile', { route: ROUTE });
      return NextResponse.json(
        { success: false, error: 'No learner profile for this account' },
        { status: 403 },
      );
    }

    return NextResponse.json(
      { success: true, data: pulse },
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
    );
  } catch (err) {
    logger.error('pulse_me_failed', {
      route: ROUTE,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
