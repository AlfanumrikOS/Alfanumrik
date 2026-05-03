/**
 * Alfanumrik — Goal-Adaptive Learning Layers / Phase 0
 * Read-only API: list the in-code Goal Profile table.
 *
 * Owner: backend (per ops). Frontend renders /super-admin/goal-profiles using
 * this response. Pure read — no DB writes, no PII, no per-student data.
 *
 * Auth: super_admin.access — same permission code used across the
 * super-admin/* surface (see oracle-health, misconceptions, grounding/* etc).
 *
 * Why an API for in-code data?
 *  - Future programmatic admin tools (e.g. an MCP server, a runbook script,
 *    or the eventual mobile internal-tools build) shouldn't have to parse
 *    TypeScript to introspect the goal table.
 *  - Pinning the response shape lets us evolve the in-code table later
 *    without breaking those callers (we add fields, never break shape).
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: {
 *       flagEnabled: boolean,    // ff_goal_profiles eval (cached)
 *       profiles: GoalProfile[]  // frozen in-code table, deterministic order
 *     }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { isFeatureEnabled } from '@/lib/feature-flags';
import {
  GOAL_PROFILES,
  type GoalCode,
  type GoalProfile,
} from '@/lib/goals/goal-profile';

export const runtime = 'nodejs';

/**
 * Deterministic display order (matches the page UI). Ascending by ambition /
 * difficulty mix so reviewers see the spectrum from "improve_basics" to
 * "olympiad" the same way every time.
 */
const DISPLAY_ORDER: GoalCode[] = [
  'improve_basics',
  'pass_comfortably',
  'school_topper',
  'board_topper',
  'competitive_exam',
  'olympiad',
];

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    // The flag may be off in staging/prod (architect-owned migration seeds
    // it disabled). The page uses this to render a "feature disabled" notice
    // without hiding the data — admins can still preview the resolved table.
    const flagEnabled = await isFeatureEnabled('ff_goal_profiles', {
      role: 'super_admin',
      userId: auth.userId ?? undefined,
    });

    const profiles: GoalProfile[] = DISPLAY_ORDER.map(
      code => GOAL_PROFILES[code],
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          flagEnabled,
          profiles,
        },
      },
      {
        headers: {
          // Cache briefly — the table only changes when assessment edits
          // goal-profile.ts and we redeploy. 60s is a comfortable margin.
          'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
