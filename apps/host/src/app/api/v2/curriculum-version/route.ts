/**
 * GET /api/v2/curriculum-version — cheap curriculum-freshness poll.
 *
 * Called on app-start and learn-session-start. The client caches curriculum
 * content locally and uses this endpoint to decide whether any subject-grade
 * scope has newer content than what it holds — a lightweight (<1 KB) version
 * check, NOT a content fetch.
 *
 * FROZEN CONTRACT (architect design, STEP 4b):
 *   RPC: get_curriculum_versions(p_grade text, p_subject_codes text[] DEFAULT NULL)
 *        RETURNS jsonb
 *          { "as_of": "<ISO-8601 UTC>",
 *            "scopes": { "<subject_code>-<grade>": <monotonic_int>, ... } }
 *   - scope value = unix-epoch seconds (higher = newer); 0 = "never had content".
 *   - p_subject_codes NULL (default) → all subjects-with-content for the grade,
 *     empties omitted (keeps this poll <1 KB).
 *
 * This route resolves the caller's grade (P5 string) and calls the RPC with
 * p_subject_codes = NULL (omitted → SQL DEFAULT). The RPC jsonb is returned
 * VERBATIM inside the /v2 envelope — no schemaVersion is injected, because the
 * contract is frozen and this is a version poll, not a versioned payload.
 *
 * Resilience: a version poll MUST NEVER break the client. A bad/absent grade,
 * an out-of-range grade, or an RPC failure all degrade to `{ as_of, scopes: {} }`
 * (HTTP 200) rather than a 5xx. Only the auth boundary can reject the request.
 *
 * P5: grade is a string. P9: server RBAC (authorizeRequest) is the boundary;
 * this route re-checks. P13: no PII logged (opaque event names + error messages
 * only — never student identifiers or the grade value).
 *
 * Auth: study_plan.view (student-scoped read; same as /api/v2/learn/curriculum).
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { v2Success } from '@alfanumrik/lib/api/v2/envelope';

/** Verbatim shape of the get_curriculum_versions RPC jsonb. */
interface CurriculumVersions {
  as_of: string;
  scopes: Record<string, number>;
}

/**
 * Short, per-user cache for a successful poll. Grade-scoped data → `private`
 * (never a shared/CDN cache). Mirrors the read siblings (parent/children,
 * student/progress). Degraded responses use `no-store` so the next
 * app-start / learn-session-start poll re-attempts immediately.
 */
const OK_CACHE = 'private, max-age=30, stale-while-revalidate=60';
const DEGRADED_CACHE = 'no-store';

/** The contract's empty answer: current UTC timestamp + no scopes. */
function emptyVersions(): CurriculumVersions {
  return { as_of: new Date().toISOString(), scopes: {} };
}

function degraded() {
  return v2Success(emptyVersions(), { headers: { 'Cache-Control': DEGRADED_CACHE } });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, 'study_plan.view', {
      requireStudentId: true,
    });
    if (!auth.authorized || !auth.userId) return auth.errorResponse!;

    // No resolved student profile (e.g. a non-student caller, or a profile that
    // is still mid-onboarding) → degrade to empty scopes. Never break the poll.
    if (!auth.studentId) return degraded();

    const admin = getSupabaseAdmin();

    // Resolve the caller's grade (P5 string). Same source/shape as the sibling
    // /api/v2/learn/curriculum. A missing grade degrades to empty scopes.
    const { data: student } = await admin
      .from('students')
      .select('grade')
      .eq('id', auth.studentId)
      .maybeSingle();
    if (!student?.grade) return degraded();
    const grade = String(student.grade);

    // Call the frozen RPC with p_subject_codes = NULL (omitted → SQL DEFAULT):
    // returns every subject-with-content for this grade, empties omitted (<1 KB).
    // An out-of-range grade returns `{ as_of, scopes: {} }` from the RPC itself.
    const { data: versions, error } = await admin.rpc('get_curriculum_versions', {
      p_grade: grade,
    });
    if (error || !versions) {
      // Log the opaque RPC error (message only — no PII, no grade) and degrade.
      logger.error('v2_curriculum_version_rpc_failed', {
        error: error?.message ?? 'empty_rpc_result',
        route: '/api/v2/curriculum-version',
      });
      return degraded();
    }

    // Return the RPC jsonb VERBATIM inside the standard /v2 envelope.
    return v2Success(versions as CurriculumVersions, {
      headers: { 'Cache-Control': OK_CACHE },
    });
  } catch (err) {
    // Never break the poll: log opaquely (P13) and degrade to empty scopes.
    logger.error('v2_curriculum_version_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/curriculum-version',
    });
    return degraded();
  }
}
