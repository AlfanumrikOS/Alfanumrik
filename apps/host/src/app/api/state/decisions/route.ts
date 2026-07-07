/**
 * GET /api/state/decisions
 *
 * Phase 4 of the unified state architecture. Returns the rule-engine
 * decisions for the authenticated learner. Surfaces (sidebar nav,
 * dashboard cards, upsell banner) call this once per page render and
 * filter by slug.
 *
 * Behavior:
 *   - ff_rule_engine_v1 OFF (default) → `{ decisions: [], reason: 'flag_off' }`.
 *     Surfaces fall back to their legacy in-line checks.
 *   - Flag ON, evaluation succeeds → `{ decisions: Decision[], reason: 'ok' }`.
 *   - Evaluation error → `{ decisions: [], reason: 'error' }` (200; never
 *     500 — surfaces must not break on a transient state-build failure).
 *
 * Query parameters:
 *   - `slug` (repeatable, comma-separated): filter to these decision slugs.
 *     Example: `?slug=nav.module.hide,upsell.show`.
 *   - `minPriority` (int): only return decisions with priority >= this.
 *
 * Auth: requires a valid session. We resolve auth_user_id from the JWT
 * — never trust a client-supplied id. Rate-limited only via the
 * downstream supabase calls; the 30s per-process cache absorbs page-
 * level fan-out.
 *
 * Response shape:
 *   200 { success: true, data: { decisions: Decision[], reason } }
 *   401 { success: false, error: 'unauthorized' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';
import { getLearnerDecisions } from '@alfanumrik/lib/state/rules/service';

export async function GET(request: NextRequest) {
  // RBAC: any authenticated user can read their own decisions. We do
  // NOT use a permission gate because this endpoint is a read-only
  // projection of state the learner already owns. Auth is required
  // for the auth_user_id resolution.
  const auth = await authorizeRequest(request);
  if (!auth.authorized || !auth.userId) {
    return auth.errorResponse ??
      NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const slugParams = url.searchParams.getAll('slug').flatMap(s => s.split(',')).filter(Boolean);
  const decisionSlugs = slugParams.length > 0 ? slugParams : undefined;
  const minPriorityRaw = url.searchParams.get('minPriority');
  const minPriority = minPriorityRaw === null ? undefined : Number(minPriorityRaw);

  const result = await getLearnerDecisions({
    authUserId: auth.userId,
    decisionSlugs,
    minPriority: Number.isFinite(minPriority) ? minPriority : undefined,
  });

  if (result.reason === 'error') {
    logger.warn('api/state/decisions: eval failed (returning empty)', {
      authUserId: auth.userId,
      error: new Error(result.errorMessage ?? 'unknown'),
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      decisions: result.decisions,
      reason: result.reason,
    },
  });
}
