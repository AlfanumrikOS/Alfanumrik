/**
 * GET /api/v2/student/profile — authenticated student profile (mobile + web).
 *
 * COMPOSITION ROOT for the `learners` module: this file is the only place that
 * wires a concrete Supabase client into the repository port. All business logic
 * lives in `@/modules/learners/*`; this handler only does auth, composition and
 * error → HTTP mapping.
 *
 * Reads the caller's OWN `students` row through the RLS-scoped request client
 * (`createSupabaseRouteClient` — Bearer-aware for mobile, cookie-aware for web).
 * The read is served by the `students_select_merged` SELECT policy
 * (`auth_user_id = auth.uid()`), so no service-role client is involved (P8).
 * This also collapses the previous two round trips (identity domain read +
 * second `students` query) into ONE query.
 *
 * P5: grade is returned as a STRING (coerced defensively in the domain mapper).
 * P13: no PII logged.
 *
 * Auth: profile.view_own (same permission the oauth-manager profile read uses).
 *
 * ⚠️ Response shape is pinned by the Zod contract `StudentProfileResponse`
 * (packages/lib/src/api/v2/contract.ts) → openapi/v2.json → generated Flutter
 * client. Do not change fields, status codes or error codes.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseRouteClient } from '@alfanumrik/lib/supabase-route';
import { logger } from '@alfanumrik/lib/logger';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';
import { withRoute } from '@alfanumrik/lib/api/v2/with-route';
import type { Database } from '@/infrastructure/database';
import { SupabaseLearnerRepository } from '@/modules/learners/infrastructure/supabase-learner-repository';
import { GetLearnerProfile } from '@/modules/learners/application/get-learner-profile';
import { toLearnerProfileDto } from '@/modules/learners/presentation/learner-profile-dto';
import { LearnerNotFoundError, RepositoryError } from '@/shared/errors';

export const GET = withRoute(async (request: NextRequest) => {
  try {
    const auth = await authorizeRequest(request, 'profile.view_own', {
      requireStudentId: true,
    });
    if (!auth.authorized || !auth.userId) return auth.errorResponse as unknown as NextResponse;

    const supabase = await createSupabaseRouteClient(request);
    // Single typing seam: createSupabaseRouteClient() returns an UNTYPED
    // SupabaseClient (it is schema-agnostic by design). The repository requires
    // a schema-bound client so its column list and row shape are type-checked,
    // so the boundary is narrowed here — once, at the composition root — rather
    // than by loosening the repository's own types.
    const repo = new SupabaseLearnerRepository(supabase as SupabaseClient<Database>);
    const learner = await new GetLearnerProfile(repo).execute(auth.userId);

    return v2Success(toLearnerProfileDto(learner));
  } catch (err) {
    if (err instanceof LearnerNotFoundError) {
      return v2Error('No student profile found for this account', 404, 'NO_STUDENT_PROFILE');
    }
    logger.error('v2_student_profile_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/student/profile',
    });
    if (err instanceof RepositoryError) {
      return v2Error('Profile lookup failed', 500, 'INTERNAL_ERROR');
    }
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
});
