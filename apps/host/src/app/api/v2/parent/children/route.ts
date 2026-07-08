/**
 * GET /api/v2/parent/children — the authenticated guardian's linked children.
 *
 * Thin read. Reuses the relationship domain `listChildrenForGuardian` — the
 * SAME guardian_student_links ∩ students read the web parent child-selector
 * uses (status IN active/approved). No new join written here.
 *
 * Auth (mirrors /api/v2/parent/encourage + /api/parent/report):
 *   authorizeRequest(request, 'child.view_progress')  → RBAC gate (P9).
 *   getGuardianByAuthUserId(auth.userId)               → 403 if no guardian profile.
 * listChildrenForGuardian internally resolves the guardian from the auth user
 * and only returns children in an active link status (P13: parent sees their
 * linked children only).
 *
 * P5: grade is a string. P13: only name + grade are returned (the helper maps a
 * narrow column set; no email / phone / other PII crosses the wire). No raw
 * error text is leaked to the client.
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getGuardianByAuthUserId } from '@alfanumrik/lib/domains/identity';
import { listChildrenForGuardian } from '@alfanumrik/lib/domains/relationship';
import { logger } from '@alfanumrik/lib/logger';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';

export async function GET(request: NextRequest) {
  try {
    // ── 1. AuthZ (RBAC permission gate, P9) ──
    const auth = await authorizeRequest(request, 'child.view_progress');
    if (!auth.authorized) return auth.errorResponse!;

    // ── 2. Resolve guardian from the auth user (same helper as the encourage
    //       + report routes). No guardian profile → 403. ──
    const guardianResult = await getGuardianByAuthUserId(auth.userId!);
    if (!guardianResult.ok || !guardianResult.data) {
      return v2Error('No parent profile found', 403, 'NO_GUARDIAN_PROFILE');
    }

    // ── 3. Reuse the relationship-domain read (guardian_student_links ∩ students,
    //       active/approved only). The helper resolves the guardian from the
    //       auth user id again, so we pass the JWT-resolved auth.userId. ──
    const childrenRes = await listChildrenForGuardian(auth.userId!);
    if (!childrenRes.ok) {
      logger.error('v2_parent_children_lookup_failed', {
        route: '/api/v2/parent/children',
        guardianId: guardianResult.data.id,
      });
      return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
    }

    // ── 4. Project to the contract shape. P13: name + grade(P5) only. ──
    const children = childrenRes.data.map((c) => ({
      student_id: c.studentId,
      name: c.name,
      grade: c.grade, // already coerced to a string|null by the domain (P5)
    }));

    return v2Success(
      {
        schemaVersion: 1 as const,
        children,
      },
      { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } },
    );
  } catch (err) {
    logger.error('v2_parent_children_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/parent/children',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
