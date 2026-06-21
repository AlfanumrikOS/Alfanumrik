import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { resolveEffectiveEntitlementForUser } from '@/lib/entitlements/effective-plan';
import { logger } from '@/lib/logger';

/**
 * GET /api/billing/coverage — Track A.5 B2C ↔ B2B coverage signal for checkout.
 *
 * Tells the checkout/pricing UI whether the AUTHENTICATED student is ALREADY
 * covered by their school's (B2B) plan and at what consumer tier, so the UI can
 * render "covered by your school" instead of a redundant buy button — while
 * still surfacing whether a genuine personal UPGRADE remains available.
 *
 * AUTH (P9): authorizeRequest(request, 'payments.subscribe') — the same grant
 * the subscribe/create-order routes require. super_admin/admin bypass
 * automatically.
 *
 * TENANT SAFETY (P13/P8): the student is resolved STRICTLY from the caller's own
 * auth user id (resolveEffectiveEntitlementForUser → students.auth_user_id =
 * caller). A caller can ONLY ever read their OWN coverage; no studentId/schoolId
 * is accepted from the request. The response carries tiers/codes + the caller's
 * own school_id only — no names, emails, phones, roster, or other-student data.
 *
 * Response shape: { success, data } | { success: false, error }
 *   data = {
 *     covered_by_school: boolean,
 *     school_plan: 'free'|'starter'|'pro'|'unlimited' | null,   // null when not covered
 *     effective_plan: 'free'|'starter'|'pro'|'unlimited',
 *     source: 'school'|'personal'|'free',
 *     personal_plan: <code> | null,
 *     can_upgrade: boolean,
 *   }
 *
 * A non-student authenticated caller (no students row) gets a safe free/no-
 * coverage payload (the UI simply shows normal pricing).
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'payments.subscribe');
  if (!auth.authorized) return auth.errorResponse!;

  try {
    // Resolve STRICTLY from the caller's own auth user id — no request input.
    const resolved = auth.userId
      ? await resolveEffectiveEntitlementForUser(auth.userId)
      : null;

    if (!resolved) {
      // Not a student (or no profile yet) → no school coverage; normal pricing.
      return NextResponse.json({
        success: true,
        data: {
          covered_by_school: false,
          school_plan: null,
          effective_plan: 'free',
          source: 'free',
          personal_plan: null,
          can_upgrade: true,
        },
      });
    }

    const e = resolved.entitlement;
    return NextResponse.json({
      success: true,
      data: {
        covered_by_school: !!e.schoolCoverage,
        school_plan: e.schoolCoverage?.plan ?? null,
        effective_plan: e.effectivePlan,
        source: e.source,
        personal_plan: e.personalPlan ?? null,
        can_upgrade: e.canUpgrade,
      },
    });
  } catch (err) {
    logger.error('billing_coverage_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/billing/coverage',
    });
    return NextResponse.json({ success: false, error: 'Failed to resolve coverage' }, { status: 500 });
  }
}
